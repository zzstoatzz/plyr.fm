import type { Track } from '$core/api';
import { ListeningSession } from '$core/listening-session';
import { createPersonalPlayback, type PersonalPlaybackTarget } from '$core/personal-playback';
import { createQueueAdmission } from '$core/personal-queue-join';
import { PlayOutbox } from '$core/play-outbox';
import { playMetrics } from '$core/play-metrics';
import { trackArtwork } from '$core/artwork';
import { api } from './api';
import { auth } from './auth';
import { authConfig } from './auth-config';
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
	error = $state<string>();
	repeat = $state<PersonalPlaybackTarget['repeat']>('off');
	keepPlaying = $state(false);
	nowPlaying = $state(false);
	queueOpen = $state(false);
	#audio: HTMLAudioElement | undefined;
	#audioSource: AbortController | undefined;
	#mediaTrack: Track | undefined;
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
			setQueue: (tracks, index) => { this.queue = tracks; this.index = index; },
			suspended: false,
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

	mount() {
		this.#outbox = new PlayOutbox({
			storage: playOutboxStorage,
			send: api.recordPlay,
			onReceipt: receipt => playMetrics.observe(receipt.track_id, receipt.play_count)
		});
		const update = () => {
			this.snapshot = this.#model.getSnapshot();
			if (this.#model.hasRemoteClock()) this.time = this.#model.position();
		};
		const unsubscribe = this.#model.subscribe(update);
		let previous: ReturnType<typeof auth.getAuth> | undefined;
		const changeAccount = () => {
			const account = auth.getAuth();
			if (!account.ready || previous && account.did === previous.did && account.agent === previous.agent && account.accountSync === previous.accountSync) return;
			this.#stop?.();
			if (previous?.did && previous.did !== account.did) {
				this.#audioSource?.abort();
				if (this.#audio) {
					this.#audio.pause();
					this.#audio.removeAttribute('src');
					this.#audio.load();
				}
				this.#mediaTrack = undefined;
				this.#listening.stop();
				this.queue = [];
				this.index = -1;
				this.nowPlaying = false;
				this.time = 0;
				this.length = 0;
				this.loading = false;
				this.error = undefined;
				if (navigator.mediaSession) navigator.mediaSession.metadata = null;
			}
			previous = account;
			this.#stop = this.#model.start();
		};
		const unsubscribeAuth = auth.subscribe(changeAccount);
		const unregisterLogin = registerQueueLogin(this.#model.prepareLogin);
		changeAccount();
		const progress = () => this.#model.checkpoint();
		const retry = () => this.#outbox?.retry();
		const sync = setInterval(this.#model.tick, 5_000);
		const clock = setInterval(() => {
			if (this.#model.hasRemoteClock()) this.time = this.#model.position();
		}, 250);
		window.addEventListener('pagehide', progress);
		window.addEventListener('online', retry);
		const clearMediaSession = this.#setMediaSession();
		return () => {
			progress();
			unsubscribe();
			unsubscribeAuth();
			unregisterLogin();
			this.#stop?.();
			this.#outbox?.dispose();
			this.#audioSource?.abort();
			this.#audio?.pause();
			clearMediaSession?.();
			window.removeEventListener('pagehide', progress);
			window.removeEventListener('online', retry);
			clearInterval(sync);
			clearInterval(clock);
		};
	}

	play(track: Track, collection?: Track[], label?: string) {
		this.#audioElement();
		this.#model.play(track, collection, label);
	}

	toggle() {
		if (!this.current) return;
		const pause = this.playing && !this.snapshot.outputElsewhere;
		if (pause) { this.#model.checkpoint(); this.#audio?.pause(); }
		if (this.#model.command({ action: pause ? 'pause' : 'play' }) || pause) return;
		if (!this.#model.resume()) {
			const current = this.current;
			if (this.#mediaTrack?.id === current.id && this.#audio?.src) this.#playMedia();
			else this.play(current, this.queue);
		}
	}

	seek(seconds: number) {
		const duration = this.duration;
		const position = Math.min(Math.max(0, seconds), duration);
		if (!Number.isFinite(position) || duration <= 0) return;
		if (this.snapshot.remote) {
			if (this.#model.ownsOutput()) this.#setPosition(position);
			this.#model.command({ action: 'seek', positionMs: Math.round(position * 1000) });
		} else if (!this.#model.defer(position)) this.#setPosition(position);
	}

	get position() {
		return this.snapshot.restoredPosition ?? this.time;
	}
	get duration() {
		return this.snapshot.remote ? this.#model.duration() : this.length || this.current?.metadata.duration_seconds || 0;
	}
	setVolume(value: number) {
		this.volume = Math.min(1, Math.max(0, value));
		if (this.#audio) this.#audio.volume = this.volume;
	}
	previous() {
		if (this.position > 3 || this.index === 0) this.seek(0);
		else this.#model.select(this.index - 1);
	}
	next = () => this.#model.next();
	jump = (index: number) => this.#model.select(index);
	enqueue = (track: Track) => this.current ? this.#model.enqueue(track) : this.play(track);
	remove = (index: number) => this.#model.remove(index);
	move = (from: number, to: number) => this.#model.move(from, to);
	clear = () => this.#model.clear();
	shuffle = () => this.#model.shuffle();
	cycleRepeat() {
		this.#model.setRepeat(this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off');
		this.#model.save();
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
		audio.addEventListener('playing', () => { this.loading = false; this.error = undefined; this.#updateMediaStatus(); });
		audio.addEventListener('pause', () => { this.#updateMediaStatus(); });
		audio.addEventListener('waiting', () => { if (!audio.paused) this.loading = true; });
		audio.addEventListener('timeupdate', () => this.#setMediaPosition(audio));
		audio.addEventListener('seeked', () => { this.#listening.settle(this.#token); this.#setMediaPosition(audio); });
		audio.addEventListener('error', () => { if (audio.src) this.error = 'could not load this audio'; this.loading = false; });
		audio.addEventListener('ended', () => {
			if (!this.snapshot.remote && this.repeat === 'one') { this.#repeatTrack(); return; }
			void this.#model.next(false);
		});
		this.#audio = audio;
		return audio;
	}

	#repeatTrack() {
		const track = this.#mediaTrack;
		if (!track) return;
		this.#token = this.#listening.begin(track.id, crypto.randomUUID(), track.metadata.duration_seconds);
		this.#setPosition(0);
		this.#playMedia();
	}

	async #load(tracks: Track[], index: number) {
		const track = tracks[index];
		if (!track) return false;
		const audio = this.#audioElement();
		this.#audioSource?.abort();
		const source = new AbortController();
		this.#audioSource = source;
		this.#mediaTrack = undefined;
		this.#listening.stop();
		audio.pause();
		this.time = 0;
		this.length = 0;
		this.loading = true;
		this.error = undefined;
		try {
			const playback = await api.playback(track.id);
			if (source.signal.aborted) return false;
			const url = playback.availability.delivery?.url;
			if (playback.availability.status !== 'available' || !url) throw new Error('this track is unavailable');
			this.#mediaTrack = track;
			this.#token = this.#listening.begin(track.id, crypto.randomUUID(), track.metadata.duration_seconds);
			audio.src = url;
			this.#describeMedia(track);
			return true;
		} catch {
			if (!source.signal.aborted) { this.loading = false; this.error = 'could not load this audio'; }
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
		void audio.play().catch(() => {
			if (source?.signal.aborted) return;
			this.loading = false;
			this.error = 'could not start playback. press play to try again.';
		});
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
			album: track.metadata.album ?? '',
			artwork: artwork ? [{ src: artwork }] : []
		});
	}
	#updateMediaStatus() {
		if (navigator.mediaSession) navigator.mediaSession.playbackState = this.playing ? 'playing' : 'paused';
	}
	#setMediaPosition(audio: HTMLAudioElement) {
		const duration = audio.duration;
		if (!Number.isFinite(duration) || duration <= 0 || !navigator.mediaSession) return;
		try {
			navigator.mediaSession.setPositionState({
				duration,
				position: Math.max(0, Math.min(duration, audio.currentTime)),
				playbackRate: audio.playbackRate
			});
		} catch {}
	}
	#setMediaSession() {
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
			try { session.setActionHandler(action, handlers[action] ?? null); } catch {}
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
