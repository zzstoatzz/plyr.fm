import type { RadioStation } from '@plyr/next-core/radio';
import type { Track } from '@plyr/next-core/api';
import { ListeningSession } from '@plyr/next-core/listening-session';
import { createPersonalPlayback, type PersonalPlaybackTarget } from '@plyr/next-core/personal-playback';
import { createQueueAdmission } from '@plyr/next-core/personal-queue-join';
import { PlayOutbox } from '@plyr/next-core/play-outbox';
import { playMetrics } from '@plyr/next-core/play-metrics';
import { trackArtwork } from '@plyr/next-core/artwork';
import { editPrivateQueue, withoutPrivateTrack } from '@plyr/next-core/publishing/private-music';
import { isPrivateTrack } from '@plyr/next-core/track-access';
import { privateLibrary } from './private-library';
import { api } from './api';
import { auth } from './auth';
import { authConfig } from './auth-config';
import { playbackSource } from './media/playback-source';
import type { AudioSource } from './media/gated-audio';
import { consumeQueueLogin, registerQueueLogin } from './storage/queue-login';
import { playOutboxStorage } from './storage/play-outbox-storage';
import { queueStorage } from './storage/queue-storage';

const admit = createQueueAdmission(authConfig);

class Player {
	queue = $state.raw<Track[]>([]);
	index = $state(-1);
	current = $derived(this.queue[this.index]);
	playing = $state(false);
	loading = $state(false);
	time = $state(0);
	length = $state(0);
	volume = $state(1);
	#lastAudibleVolume = 1;
	error = $state<string>();
	repeat = $state<PersonalPlaybackTarget['repeat']>('off');
	keepPlaying = $state(false);
	nowPlaying = $state(false);
	queueOpen = $state(false);
	privateMode = $state(false);
	liveStation = $state.raw<RadioStation>();
	liveListening = $state(false);
	get localMode() { return this.privateMode || !!this.liveStation; }
	#leaveRadio: (() => void) | undefined;
	#liveClock: (() => number) | undefined;
	#liveOccurrence: string | undefined;
	#liveSync = 0;
	#embedded = false;
	get outputElsewhere() { return !this.localMode && this.snapshot.outputElsewhere; }
	#publicRepeat: PersonalPlaybackTarget['repeat'] = 'off';
	#audio: HTMLAudioElement | undefined;
	#audioSource: AbortController | undefined;
	#releaseMedia: (() => void) | undefined;
	#mediaTrack: Track | undefined;
	#startAt: { uri: string; cid: string | null; seconds: number } | undefined;
	#listening = new ListeningSession();
	#token = 0;
	#outbox: PlayOutbox | undefined;
	#stop: (() => void) | undefined;
	#model = createPersonalPlayback({
		target: (): PersonalPlaybackTarget => ({
			current: this.current,
			ready: !!this.#audio && !!this.#mediaTrack && this.#audio.readyState >= 1,
			position: () => this.#audio?.currentTime ?? 0,
			playing: () => !!this.#audio && !this.#audio.paused,
			load: (tracks, index) => this.#load(tracks, index),
			loaded: () => this.#ready(),
			seek: seconds => this.#seekMedia(seconds),
			play: () => this.#playMedia(),
			pause: () => this.#audio?.pause(),
			setQueue: (tracks, index) => { if (!this.localMode && !this.#embedded) { this.queue = tracks; this.index = index; } },
			suspended: this.localMode,
			repeat: this.repeat,
			keepPlaying: this.keepPlaying,
			duration: () => this.length,
			setRepeat: value => { this.repeat = value; },
			error: message => { this.error = message; }
		}),
		account: () => {
			const account = auth.getAuth();
			return {
				ready: account.ready,
				did: account.did,
				accountSync: account.accountSync,
				join: account.agent ? (client, seed, resume) => admit(account, client, seed, resume) : undefined
			};
		},
		storage: queueStorage,
		id: () => crypto.randomUUID(),
		resolve: api.resolveTracks,
		recent: (cursor, signal) => api.tracks({ limit: 10, cursor }, signal),
		consumeLogin: consumeQueueLogin,
		socket: url => new WebSocket(url)
	});
	snapshot = $state.raw(this.#model.getSnapshot());

	mount(embedded = false) {
		this.#embedded = embedded;
		this.#outbox = new PlayOutbox({
			storage: playOutboxStorage,
			send: api.recordPlay,
			onReceipt: receipt => playMetrics.observe(receipt.track_id, receipt.play_count)
		});
		const update = () => {
			this.snapshot = this.#model.getSnapshot();
			if (!this.localMode && this.#model.hasRemoteClock()) this.time = this.#model.position();
		};
		const unsubscribe = this.#model.subscribe(update);
		let previous: ReturnType<typeof auth.getAuth> | undefined;
		const changeAccount = () => {
			const account = auth.getAuth();
			if (!account.ready || previous && account.did === previous.did && account.agent === previous.agent && account.accountSync === previous.accountSync) return;
			this.#stop?.();
			if (previous?.did && previous.agent !== account.agent) {
				this.#resetOutput();
				this.#setMediaSession();
			}
			previous = account;
			this.#stop = this.#model.start();
		};
		const unsubscribeAuth = embedded ? undefined : auth.subscribe(changeAccount);
		const unregisterLogin = embedded ? undefined : registerQueueLogin(this.#model.prepareLogin);
		if (!embedded) changeAccount();
		const progress = () => this.#model.checkpoint();
		const retry = () => this.#outbox?.retry();
		const sync = embedded ? undefined : setInterval(this.#model.tick, 5_000);
		const clock = embedded ? undefined : setInterval(() => {
			if (this.#model.hasRemoteClock()) this.time = this.#model.position();
		}, 250);
		window.addEventListener('pagehide', progress);
		window.addEventListener('online', retry);
		const clearMediaSession = this.#setMediaSession();
		return () => {
			progress();
			unsubscribe();
			unsubscribeAuth?.();
			unregisterLogin?.();
			this.#stop?.();
			this.#stop = undefined;
			this.#outbox?.dispose();
			this.#resetOutput();
			clearMediaSession?.();
			window.removeEventListener('pagehide', progress);
			window.removeEventListener('online', retry);
			clearInterval(sync);
			clearInterval(clock);
		};
	}

	play(track: Track, collection?: Track[], label?: string) {
		this.#startAt = undefined;
		this.#audioElement();
		if (this.#embedded) {
			if (isPrivateTrack(track)) return;
			if (this.liveStation) this.stopRadio();
			const available = collection?.filter(item => !isPrivateTrack(item)) ?? [track];
			const position = available.findIndex(item => item.id === track.id);
			this.#startLocal(position < 0 ? [track] : available, Math.max(0, position));
			return;
		}
		if (isPrivateTrack(track)) {
			const { did } = auth.getAuth();
			if (!privateLibrary.ownsPrivateTrack(track, did)) return;
			if (!this.privateMode) this.#holdQueue();
			this.privateMode = true;
			const tracks = collection?.filter(item => privateLibrary.ownsPrivateTrack(item, did)) ?? [track];
			const at = tracks.findIndex(item => item.record.uri === track.record.uri);
			this.#startLocal(at >= 0 ? tracks : [track], Math.max(0, at));
			return;
		}
		if (this.localMode) this.#leaveLocalMode();
		this.#model.play(track, collection?.filter(item => !isPrivateTrack(item)), label);
	}

	playFrom(track: Track, seconds: number) {
		if (!Number.isFinite(seconds) || seconds < 0 || isPrivateTrack(track)) return;
		const { uri, cid } = track.record;
		const current = !this.liveStation && this.current?.record.uri === uri && this.current.record.cid === cid;
		const waiting = this.loading || this.snapshot.waiting;
		if (current && this.playing && this.#mediaTrack?.record.uri === uri && this.#mediaTrack.record.cid === cid && this.#audio && this.#audio.readyState >= 1) {
			this.seek(seconds);
			return;
		}
		const start = { uri, cid, seconds };
		if (!current || (!waiting && !this.#mediaTrack && !this.snapshot.remote)) {
			this.play(track);
			this.#startAt = start;
		} else {
			this.#startAt = start;
			if (!waiting) this.toggle();
		}
	}

	#startLocal(tracks: Track[], at: number) {
		this.queue = tracks;
		this.index = at;
		void this.#load(tracks, at).then(ready => { if (ready) this.#playMedia(); });
	}

	#resetOutput() {
		this.#startAt = undefined;
		this.#dropRadio();
		this.#detachMedia();
		this.#mediaTrack = undefined;
		this.#listening.stop();
		this.privateMode = false;
		this.repeat = 'off';
		this.queueOpen = false;
		this.queue = [];
		this.index = -1;
		this.nowPlaying = false;
		this.time = 0;
		this.length = 0;
		this.playing = false;
		this.loading = false;
		this.error = undefined;
		this.#clearMediaSession();
	}

	#leaveLocalMode() {
		this.#resetOutput();
		this.repeat = this.#publicRepeat;
		if (!this.#embedded) this.#model.restore();
		this.#setMediaSession();
	}

	#holdQueue() {
		if (!this.localMode) {
			this.#publicRepeat = this.repeat;
			this.#model.suspend();
		}
		this.#dropRadio();
	}

	startRadio(station: RadioStation, leave: () => void) {
		if (this.liveStation?.slug === station.slug) return;
		this.#holdQueue();
		this.privateMode = false;
		this.#detachMedia();
		this.#audioElement();
		this.#mediaTrack = undefined;
		this.#listening.stop();
		this.liveStation = station;
		this.#leaveRadio = leave;
		this.liveListening = true;
		this.queueOpen = false;
		this.queue = [];
		this.index = -1;
		this.repeat = 'off';
		this.playing = false;
		this.loading = true;
		this.time = this.length = 0;
		this.error = undefined;
		this.#clearMediaSession();
		this.#setMediaSession(true);
	}

	livePosition() { return this.#liveClock?.() ?? 0; }

	stopRadio() {
		if (this.liveStation) this.#leaveLocalMode();
	}

	#dropRadio() {
		this.#leaveRadio?.();
		this.#leaveRadio = undefined;
		this.#liveClock = undefined;
		this.#liveOccurrence = undefined;
		this.liveStation = undefined;
		this.liveListening = false;
		this.#liveSync++;
	}

	async setRadioTrack(track: Track, url: string, occurrence: string, clock: () => number) {
		if (!this.liveStation) return;
		this.#liveClock = clock;
		if (this.#liveOccurrence === occurrence) return;
		this.#liveOccurrence = occurrence;
		this.queue = [track];
		this.index = 0;
		const ready = await this.#loadMedia(track, async () => ({ url }), track.id.startsWith('trk_'));
		if (ready) void this.#resumeRadio();
	}

	clearRadioTrack() {
		if (!this.liveStation || !this.current) return;
		this.#liveOccurrence = undefined;
		this.#liveClock = undefined;
		this.#detachMedia();
		this.#mediaTrack = undefined;
		this.#listening.stop();
		this.queue = [];
		this.index = -1;
		this.playing = false;
		this.loading = this.liveListening;
		this.#clearMediaSession();
	}

	setRadioListening(value: boolean) {
		if (!this.liveStation) return;
		this.liveListening = value;
		if (value) void this.#resumeRadio();
		else {
			this.#liveSync++;
			this.#audio?.pause();
			this.loading = false;
		}
	}

	async #resumeRadio() {
		const clock = this.#liveClock;
		const signal = this.#audioSource?.signal;
		if (!this.liveStation || !this.liveListening || !clock || !signal) return;
		const request = ++this.#liveSync;
		const current = () => !signal.aborted && request === this.#liveSync && this.liveListening;
		this.loading = true;
		this.error = undefined;
		try {
			await this.#ready();
			if (!current()) return;
			this.#setPosition(Math.min(clock(), this.duration));
			this.#playMedia();
		} catch {
			if (current()) {
				this.loading = false;
				this.liveListening = false;
				this.error = 'could not play this station';
			}
		}
	}

	forgetPrivateTrack(uri: string) {
		if (!this.privateMode) return;
		const remaining = withoutPrivateTrack(this.queue, this.index, uri);
		if (remaining.currentRemoved) this.#leaveLocalMode();
		else { this.queue = remaining.queue; this.index = remaining.index; }
	}

	toggle() {
		if (this.liveStation) { this.setRadioListening(!this.liveListening); return; }
		if (!this.current) return;
		const pause = this.playing && !this.outputElsewhere;
		if (this.privateMode || this.#embedded) {
			if (pause) this.#audio?.pause();
			else if (this.#mediaTrack && this.#audio?.src) this.#playMedia();
			else this.#startLocal(this.queue, this.index);
			return;
		}
		if (pause) { this.#model.checkpoint(); this.#audio?.pause(); }
		if (this.#model.command({ action: pause ? 'pause' : 'play' }) || pause) return;
		if (!this.#model.resume()) {
			const current = this.current;
			if (this.#mediaTrack?.id === current.id && this.#audio?.src) this.#playMedia();
			else this.play(current, this.queue);
		}
	}

	seek(seconds: number) {
		if (this.liveStation) return;
		const duration = this.duration;
		const position = Math.min(Math.max(0, seconds), duration);
		if (!Number.isFinite(position) || duration <= 0) return;
		if (this.privateMode || this.#embedded) { this.#setPosition(position); return; }
		if (this.snapshot.remote) {
			if (this.#model.ownsOutput()) this.#setPosition(position);
			this.#model.command({ action: 'seek', positionMs: Math.round(position * 1000) });
		} else if (!this.#model.defer(position)) this.#setPosition(position);
	}

	get position() {
		return this.localMode ? this.time : this.snapshot.restoredPosition ?? this.time;
	}
	get duration() {
		return !this.localMode && this.snapshot.remote ? this.#model.duration() : this.length || this.current?.metadata.duration_seconds || 0;
	}
	setVolume(value: number) {
		this.volume = Math.min(1, Math.max(0, value));
		if (this.volume > 0) this.#lastAudibleVolume = this.volume;
		if (this.#audio) this.#audio.volume = this.volume;
	}
	toggleMute() {
		this.setVolume(this.volume === 0 ? this.#lastAudibleVolume : 0);
	}
	previous() {
		if (this.liveStation) return;
		if (this.position > 3 || this.index === 0) this.seek(0);
		else this.jump(this.index - 1);
	}
	next() {
		this.#startAt = undefined;
		if (this.liveStation) return;
		if (!this.privateMode && !this.#embedded) return this.#model.next();
		if (this.index + 1 < this.queue.length) this.jump(this.index + 1);
		else if (this.repeat === 'all' && this.queue.length) this.jump(0);
	}
	jump(index: number) {
		this.#startAt = undefined;
		if (this.liveStation) return;
		if (!this.privateMode && !this.#embedded) this.#model.select(index);
		else if (this.queue[index]) this.#startLocal(this.queue, index);
	}
	enqueue(track: Track) {
		if (this.liveStation) return;
		if (isPrivateTrack(track)) {
			if (!privateLibrary.ownsPrivateTrack(track, auth.getAuth().did)) return;
			if (this.privateMode) this.queue = [...this.queue, track];
			else this.play(track);
		} else if (!this.privateMode) {
			if (this.current) this.#model.enqueue(track);
			else this.play(track);
		}
	}
	enqueueCollection(tracks: Track[]) {
		if (this.localMode) return;
		this.#model.enqueueCollection(tracks.filter(track => track.record.cid && !isPrivateTrack(track)));
	}
	remove(index: number) {
		if (this.liveStation) return;
		if (this.privateMode) this.queue = editPrivateQueue(this.queue, this.index, { action: 'remove', at: index });
		else this.#model.remove(index);
	}
	move(from: number, to: number) {
		if (this.liveStation) return;
		if (this.privateMode) this.queue = editPrivateQueue(this.queue, this.index, { action: 'move', from, to });
		else this.#model.move(from, to);
	}
	clear() {
		if (this.liveStation) return;
		if (this.privateMode) this.queue = editPrivateQueue(this.queue, this.index, { action: 'clear' });
		else this.#model.clear();
	}
	shuffle() {
		if (this.liveStation) return;
		if (this.privateMode) this.queue = editPrivateQueue(this.queue, this.index, { action: 'shuffle' });
		else this.#model.shuffle();
	}
	cycleRepeat() {
		if (this.liveStation) return;
		const repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
		if (this.privateMode) this.repeat = repeat;
		else { this.#model.setRepeat(repeat); this.#model.save(); }
	}
	save() {
		this.#model.save();
		void this.#model.ensureContinuation();
	}

	#audioElement() {
		if (this.#audio) return this.#audio;
		const audio = new Audio();
		audio.preload = 'auto';
		audio.volume = this.volume;
		const observe = () => {
			this.time = audio.currentTime;
			this.length = Number.isFinite(audio.duration) ? audio.duration : 0;
			this.playing = !audio.paused && !audio.ended;
			const play = this.#listening.observe(this.#token, {
				positionSeconds: audio.currentTime,
				durationSeconds: this.length,
				playing: this.playing,
				buffering: audio.readyState < 3,
				monotonicMs: performance.now(),
				playbackRate: audio.playbackRate
			});
			if (play) this.#outbox?.enqueue(play);
		};
		for (const event of ['timeupdate', 'durationchange', 'play', 'pause', 'playing', 'waiting', 'ended']) {
			audio.addEventListener(event, observe);
		}
		audio.addEventListener('playing', () => { this.#seekToStart(); this.loading = false; this.error = undefined; this.#updateMediaStatus(); });
		audio.addEventListener('pause', () => { this.#updateMediaStatus(); });
		audio.addEventListener('waiting', () => { if (!audio.paused) this.loading = true; });
		audio.addEventListener('timeupdate', () => this.#setMediaPosition(audio));
		audio.addEventListener('seeked', () => { this.#listening.settle(this.#token); this.#setMediaPosition(audio); });
		audio.addEventListener('error', () => { if (audio.src) this.error = 'could not load this audio'; this.loading = false; });
		audio.addEventListener('ended', () => {
			if (this.liveStation) { this.loading = this.liveListening; return; }
			if ((this.privateMode || !this.snapshot.remote) && this.repeat === 'one') { this.#repeatTrack(); return; }
			if (this.privateMode || this.#embedded) void this.next();
			else void this.#model.next(false);
		});
		this.#audio = audio;
		return audio;
	}

	#repeatTrack() {
		const track = this.#mediaTrack;
		if (!track) return;
		if (!this.privateMode) this.#token = this.#listening.begin(track.id, crypto.randomUUID(), track.metadata.duration_seconds);
		this.#setPosition(0);
		this.#playMedia();
	}

	#detachMedia() {
		this.#audioSource?.abort();
		if (this.#audio?.hasAttribute('src')) {
			this.#audio.pause();
			this.#audio.removeAttribute('src');
			this.#audio.load();
		}
		this.#releaseMedia?.();
		this.#releaseMedia = undefined;
	}

	async #load(tracks: Track[], index: number) {
		const track = tracks[index];
		if (!track || this.liveStation || this.privateMode !== isPrivateTrack(track)) return false;
		if (this.privateMode && !privateLibrary.ownsPrivateTrack(track, auth.getAuth().did)) return false;
		return this.#loadMedia(track, signal => playbackSource(track, signal), !this.privateMode);
	}

	async #loadMedia(track: Track, resolve: (signal: AbortSignal) => Promise<AudioSource>, count: boolean) {
		if (this.#startAt?.uri !== track.record.uri || this.#startAt.cid !== track.record.cid) this.#startAt = undefined;
		const audio = this.#audioElement();
		this.#detachMedia();
		const source = new AbortController();
		this.#audioSource = source;
		this.#mediaTrack = undefined;
		this.#listening.stop();
		this.time = 0;
		this.length = 0;
		this.loading = true;
		this.error = undefined;
		let media: AudioSource | undefined;
		try {
			media = await resolve(source.signal);
			source.signal.throwIfAborted();
			this.#releaseMedia = media.release;
			audio.src = media.url;
			this.#mediaTrack = track;
			if (count) this.#token = this.#listening.begin(track.id, crypto.randomUUID(), track.metadata.duration_seconds);
			this.#describeMedia(track);
			return true;
		} catch (error) {
			if (source.signal.aborted) media?.release?.();
			else {
				this.#startAt = undefined;
				this.#detachMedia();
				this.loading = false;
				this.error = error instanceof Error ? error.message : 'could not load this audio';
			}
			return false;
		}
	}

	#ready(): Promise<void> {
		const audio = this.#audio;
		const signal = this.#audioSource?.signal;
		if (!audio?.src || !signal || signal.aborted) return Promise.reject(new Error('audio changed while loading'));
		if (audio.readyState >= 1) return Promise.resolve();
		return new Promise((resolve, reject) => {
			const events = new AbortController();
			const finish = (error?: string) => {
				clearTimeout(timer);
				events.abort();
				if (error) reject(new Error(error));
				else resolve();
			};
			const timer = setTimeout(() => finish('audio took too long to load'), 15_000);
			audio.addEventListener('loadedmetadata', () => finish(), { signal: events.signal });
			audio.addEventListener('error', () => finish('could not load this audio'), { signal: events.signal });
			signal.addEventListener('abort', () => finish('audio changed while loading'), { signal: events.signal });
		});
	}

	#playMedia() {
		const audio = this.#audio;
		if (!audio?.src || !this.#mediaTrack) return;
		const source = this.#audioSource;
		const playing = this.#startAt ? this.#ready().then(() => {
			source?.signal.throwIfAborted();
			this.#seekToStart();
			return audio.play();
		}) : audio.play();
		void playing.catch(() => {
			if (source?.signal.aborted || (this.liveStation && !this.liveListening)) return;
			this.loading = false;
			if (this.liveStation) this.liveListening = false;
			this.error = 'could not start playback. press play to try again.';
		});
	}
	#seekToStart() {
		const at = this.#startAt;
		if (!at || at.uri !== this.#mediaTrack?.record.uri || at.cid !== this.#mediaTrack.record.cid) return;
		this.#startAt = undefined;
		this.seek(at.seconds);
	}
	async #seekMedia(position: number) {
		await this.#ready();
		this.#setPosition(position);
	}
	#setPosition(position: number) {
		if (!this.#audio?.src) return;
		if (Math.abs(this.#audio.currentTime - position) > 0.001) {
			this.#listening.discontinue(this.#token);
			this.#audio.currentTime = position;
		}
		this.time = position;
		this.#model.checkpoint(position);
	}
	#describeMedia(track: Track) {
		if (!navigator.mediaSession || typeof MediaMetadata === 'undefined') return;
		const artwork = trackArtwork(track);
		navigator.mediaSession.metadata = new MediaMetadata({
			title: track.metadata.title,
			artist: track.metadata.artist_name || track.artist.profile.display_name,
			album: this.liveStation ? `${this.liveStation.label} radio` : track.metadata.album ?? '',
			artwork: artwork ? [{ src: artwork }] : []
		});
	}
	#updateMediaStatus() {
		if (navigator.mediaSession) navigator.mediaSession.playbackState = this.playing ? 'playing' : 'paused';
	}
	#clearMediaSession() {
		const session = navigator.mediaSession;
		if (!session) return;
		session.metadata = null;
		session.playbackState = 'none';
		try { session.setPositionState(); } catch {}
	}

	#setMediaPosition(audio: HTMLAudioElement) {
		const duration = audio.duration;
		if (this.liveStation) return;
		if (!Number.isFinite(duration) || duration <= 0 || !navigator.mediaSession) return;
		try {
			navigator.mediaSession.setPositionState({
				duration,
				position: Math.max(0, Math.min(duration, audio.currentTime)),
				playbackRate: audio.playbackRate
			});
		} catch {}
	}
	#setMediaSession(liveOnly = false) {
		const session = navigator.mediaSession;
		if (!session) return;
		const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
			play: () => { if (!this.playing) this.toggle(); },
			pause: () => { if (this.playing) this.toggle(); },
			previoustrack: () => this.previous(),
			nexttrack: () => { void this.next(); },
			seekto: event => { if (event.seekTime !== undefined) this.seek(event.seekTime); },
			seekforward: event => this.seek(this.position + (event.seekOffset ?? 10)),
			seekbackward: event => this.seek(this.position - (event.seekOffset ?? 10))
		};
		const actions = Object.keys(handlers) as MediaSessionAction[];
		for (const action of actions) {
			try { session.setActionHandler(action, liveOnly && action !== 'play' && action !== 'pause' ? null : handlers[action] ?? null); } catch {}
		}
		return () => {
			for (const action of actions) {
				try { session.setActionHandler(action, null); } catch {}
			}
			session.metadata = null;
			session.playbackState = 'none';
			try { session.setPositionState(); } catch {}
		};
	}
}

export const player = new Player();
