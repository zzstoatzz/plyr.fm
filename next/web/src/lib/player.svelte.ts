import { api, type Playback, type Track } from './api';
import { auth } from './auth.svelte';
import { blobUrl } from './identity';
import { prefs } from './prefs.svelte';

export type Repeat = 'off' | 'all' | 'one';

/**
 * the one audio element and its queue. it lives here, not in the layout, so
 * any screen can drive it and the media session sees one source of truth.
 */
class Player {
	queue = $state<Track[]>([]);
	index = $state(-1);
	playing = $state(false);
	loading = $state(false);
	error = $state<string | null>(null);
	time = $state(0);
	duration = $state(0);
	volume = $state(1);
	shuffle = $state(false);
	repeat = $state<Repeat>('off');
	/** the order before shuffle, so turning it off restores it */
	#unshuffled: Track[] | null = null;
	#audio: HTMLAudioElement | null = null;
	#objectUrl: string | null = null;
	#loadSeq = 0;

	current = $derived(this.index >= 0 ? (this.queue[this.index] ?? null) : null);
	upcoming = $derived(this.queue.slice(this.index + 1));

	#el(): HTMLAudioElement {
		if (this.#audio) return this.#audio;
		const a = new Audio();
		a.preload = 'auto';
		a.volume = this.volume = prefs.volume;
		a.addEventListener('timeupdate', () => (this.time = a.currentTime));
		a.addEventListener('durationchange', () => (this.duration = Number.isFinite(a.duration) ? a.duration : 0));
		a.addEventListener('play', () => (this.playing = true));
		a.addEventListener('pause', () => (this.playing = false));
		a.addEventListener('waiting', () => (this.loading = true));
		a.addEventListener('playing', () => (this.loading = false));
		a.addEventListener('ended', () => this.#ended());
		a.addEventListener('error', () => {
			if (a.src) this.error = "couldn't load this audio";
			this.loading = false;
		});
		this.#audio = a;
		this.#mediaSession();
		return a;
	}

	/** play `tracks` starting at `start`. with play-through off, only that one track is queued. */
	async play(tracks: Track[], start = 0) {
		const list = prefs.playThrough ? tracks.slice() : [tracks[start]];
		const at = prefs.playThrough ? start : 0;
		this.#unshuffled = null;
		if (this.shuffle) {
			const [first] = list.splice(at, 1);
			this.#unshuffled = tracks.slice();
			this.queue = [first, ...shuffled(list)];
			await this.#load(0);
		} else {
			this.queue = list;
			await this.#load(at);
		}
	}

	toggle() {
		const a = this.#el();
		if (!this.current) return;
		if (a.paused) a.play().catch((e) => (this.error = (e as Error).message));
		else a.pause();
	}

	async next() {
		if (this.index + 1 < this.queue.length) await this.#load(this.index + 1);
		else if (this.repeat === 'all' && this.queue.length) await this.#load(0);
		else if (prefs.keepPlaying && (await this.#extend())) await this.#load(this.index + 1);
		else this.#el().pause();
	}

	async prev() {
		const a = this.#el();
		// like every player: early in a track, go back; later, restart it
		if (a.currentTime > 3 || this.index <= 0) a.currentTime = 0;
		else await this.#load(this.index - 1);
	}

	seek(seconds: number) {
		const a = this.#el();
		a.currentTime = Math.max(0, Math.min(seconds, this.duration || seconds));
	}

	setVolume(v: number) {
		this.volume = Math.min(1, Math.max(0, v));
		this.#el().volume = this.volume;
		prefs.volume = this.volume;
	}

	jump(i: number) {
		if (i >= 0 && i < this.queue.length) this.#load(i);
	}

	addToQueue(track: Track) {
		if (!this.current) return this.play([track]);
		this.queue = [...this.queue, track];
	}

	playNext(track: Track) {
		if (!this.current) return this.play([track]);
		const q = this.queue.slice();
		q.splice(this.index + 1, 0, track);
		this.queue = q;
	}

	removeAt(i: number) {
		if (i <= this.index) return;
		this.queue = this.queue.filter((_, j) => j !== i);
	}

	clearUpcoming() {
		this.queue = this.queue.slice(0, this.index + 1);
	}

	toggleShuffle() {
		this.shuffle = !this.shuffle;
		const done = this.queue.slice(0, this.index + 1);
		if (this.shuffle) {
			this.#unshuffled = this.queue.slice();
			this.queue = [...done, ...shuffled(this.queue.slice(this.index + 1))];
		} else if (this.#unshuffled && this.current) {
			// restore the original order after the current track
			const original = this.#unshuffled;
			const doneIds = new Set(done.map((t) => t.id));
			const originalIds = new Set(original.map((t) => t.id));
			const rest = original.filter((t) => !doneIds.has(t.id));
			// anything queued while shuffled keeps its place at the end
			const added = this.queue.slice(this.index + 1).filter((t) => !originalIds.has(t.id));
			this.queue = [...done, ...rest, ...added];
			this.#unshuffled = null;
		}
	}

	cycleRepeat() {
		this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
	}

	async #ended() {
		if (this.repeat === 'one') {
			const a = this.#el();
			a.currentTime = 0;
			a.play().catch(() => {});
			return;
		}
		await this.next();
	}

	/** keep playing: append recent tracks that aren't queued yet. */
	async #extend(): Promise<boolean> {
		try {
			const seen = new Set(this.queue.map((t) => t.id));
			const page = await api.tracks({ limit: 30 });
			const more = page.data.filter((t) => !seen.has(t.id));
			if (!more.length) return false;
			this.queue = [...this.queue, ...more];
			return true;
		} catch {
			return false;
		}
	}

	async #load(i: number) {
		const seq = ++this.#loadSeq;
		const a = this.#el();
		this.index = i;
		this.error = null;
		this.time = 0;
		this.duration = this.queue[i]?.metadata.duration_seconds ?? 0;
		this.loading = true;
		const track = this.queue[i];
		this.#updateMetadata(track);
		try {
			const playback = await api.playback(track.id);
			const src = await playableUrl(playback);
			if (seq !== this.#loadSeq) return; // a newer pick won
			if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
			this.#objectUrl = src.startsWith('blob:') ? src : null;
			a.src = src;
			await a.play();
		} catch (e) {
			if (seq !== this.#loadSeq) return;
			this.loading = false;
			this.playing = false;
			const err = e as Error;
			// autoplay blocked isn't an error the listener can fix; they just press play
			this.error = err.name === 'NotAllowedError' ? null : `can't play "${track.metadata.title}": ${err.message}`;
		}
	}

	#updateMetadata(track: Track | undefined) {
		if (!track || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
		const art = track.media.artwork?.url;
		navigator.mediaSession.metadata = new MediaMetadata({
			title: track.metadata.title,
			artist: track.artist.profile.display_name || track.artist.profile.handle,
			album: track.metadata.album ?? '',
			artwork: art ? [{ src: art, sizes: '512x512' }] : []
		});
	}

	#mediaSession() {
		if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
		const ms = navigator.mediaSession;
		const set = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
			try {
				ms.setActionHandler(action, fn);
			} catch {
				/* unsupported action */
			}
		};
		set('play', () => this.toggle());
		set('pause', () => this.toggle());
		set('previoustrack', () => this.prev());
		set('nexttrack', () => this.next());
		set('seekto', (d) => d.seekTime != null && this.seek(d.seekTime));
	}
}

export const player = new Player();

function shuffled<T>(xs: T[]): T[] {
	const a = xs.slice();
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

/**
 * prefer the appview's delivery (verified mirror or authored url); otherwise
 * stream the record's audio blob straight from the owner's PDS.
 */
async function playableUrl(playback: Playback): Promise<string> {
	const { delivery, artifact, space } = playback.availability;
	if (playback.availability.status === 'gated' && space) {
		if (!auth.did) throw new Error(space.gate === 'supporters' ? 'sign in to hear supporter tracks' : 'sign in to hear this track');
		if (!auth.spaces) throw new Error("your PDS doesn't support spaces yet, so gated tracks can't play here");
		const { gatedAudioUrl, NotAuthorized, SpacesUnsupported } = await import('./spaces');
		try {
			return await gatedAudioUrl(space.record);
		} catch (e) {
			if (e instanceof NotAuthorized) throw new Error('this track is for supporters of the artist');
			if (e instanceof SpacesUnsupported) throw new Error(e.message);
			throw e;
		}
	}
	if (playback.availability.status === 'available' && delivery?.url) return delivery.url;
	if (artifact?.cid) return blobUrl(playback.record.uri.slice('at://'.length).split('/')[0], artifact.cid);
	throw new Error('unavailable');
}

export function formatDuration(seconds: number | null | undefined) {
	if (!seconds || seconds < 0 || !Number.isFinite(seconds)) return '0:00';
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, '0')}`;
}

export const artistName = (t: Track) => t.artist.profile.display_name || t.artist.profile.handle;

/** "1 track", "2 tracks" */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
