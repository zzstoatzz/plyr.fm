import type { Track, TrackId } from './types';
import { API_URL, IS_ZIG_V1 } from './config';
import { recordZigPlay } from './api/zig-v1';

// radio is a distinct *source* on the same player: when set, the one <audio>
// element plays this stream instead of a queue track, and the normal player
// strip renders `track` (the on-air track) with a radioMode flag. no second
// audio element, no second strip.
export interface RadioNowPlaying {
	/** the on-air track, rendered in the normal player strip (TrackInfo) */
	track: Track;
	stream_url: string;
	/** station position to resume at (seconds) */
	start_at: number;
	/** a broadcast is airing: unbounded, no position to resume, no scrubbing */
	live?: boolean;
	/** transport for `stream_url` when live (currently only "hls") */
	streamKind?: string;
}

interface RadioPlaybackOptions {
	autoplay?: boolean;
}

/** the slice of hls.js's default export the player uses. */
type HlsModule = {
	isSupported(): boolean;
	new (config: { enableWorker: boolean }): {
		loadSource(url: string): void;
		attachMedia(el: HTMLMediaElement): void;
		destroy(): void;
	};
};

// natural timeupdate steps are sub-second; a larger jump is a seek, scrub, or a
// restored hydration position — none of which is listened time.
const PLAY_PROGRESS_SEEK_THRESHOLD_S = 5;

// global player state using Svelte 5 runes
class PlayerState {
	currentTrack = $state<Track | null>(null);
	// when non-null, the player is in radio mode (overrides currentTrack)
	radio = $state<RadioNowPlaying | null>(null);
	audioElement = $state<HTMLAudioElement | undefined>(undefined);
	/** live hls.js instance, when a broadcast needs one. not reactive — it is a
	 * teardown handle, never rendered. */
	private hls: { destroy(): void } | null = null;
	/** pending station-position seek, waiting on the radio source's metadata.
	 * tracked so it can be removed the moment the element points anywhere else —
	 * left attached, it fires on the NEXT source (a queue track after stopping
	 * radio) and seeks it to min(station position, duration): the end of the
	 * track, which then fires `ended` and eats the queue one track at a time. */
	private radioSeek: (() => void) | null = null;
	/** hls.js itself, once fetched, plus the in-flight fetch. cached so a tune-in
	 * can attach synchronously inside the tap that asked for it. */
	private hlsModule: HlsModule | null = null;
	private hlsLoad: Promise<HlsModule | null> | null = null;
	paused = $state(true);

	currentTime = $state(0);
	duration = $state(0);
	volume = $state(0.7);
	playCountedForTrack = $state<TrackId | null>(null);

	// share link tracking: ref code from ?ref= URL param
	ref = $state<string | null>(null);
	private _refTrackId: TrackId | null = null; // track the ref is associated with

	// synchronous guard to prevent duplicate play count requests
	// (reactive state updates are batched, so we need this to block rapid-fire calls)
	private _playCountPending: TrackId | null = null;

	// accumulated *listened* time for the current track (seconds). only advances
	// while playing and stepping forward naturally, so seeks and restored
	// hydration positions never trip the play-count threshold on their own.
	private _playedSeconds = 0;
	private _lastProgressTime: number | null = null;

	// lock play counting during track transitions to prevent spurious fires
	// from stale currentTime/duration values before new audio loads
	private _playCountLocked = $state(false);

	setRef(code: string | null, trackId: TrackId | null = null) {
		this.ref = code;
		this._refTrackId = trackId;
	}

	playTrack(track: Track) {
		if (this.currentTrack?.id === track.id) {
			// toggle play/pause for same track
			this.paused = !this.paused;
		} else {
			// switch tracks - clear ref if it's for a different track
			if (this._refTrackId !== null && this._refTrackId !== track.id) {
				this.ref = null;
				this._refTrackId = null;
			}
			this.currentTrack = track;
			this.paused = false;
		}
	}

	togglePlayPause() {
		this.paused = !this.paused;
	}

	/** start (or switch) radio playback through the shared audio element.
	 * call from a user gesture so the play() isn't blocked by autoplay policy. */
	playRadio(np: RadioNowPlaying, options: RadioPlaybackOptions = {}) {
		const autoplay = options.autoplay ?? true;
		const wasActive = this.radio !== null;
		const previousTrack = this.currentTrack;
		this.radio = np;
		// $state proxies the assigned object, so capture the proxy for the
		// is-this-tune-in-still-current check in the catch below
		const assigned = this.radio;
		this.currentTrack = null; // exit track mode; the track loader bails on null
		this.paused = !autoplay;
		// arm play counting for the on-air track. reset BEFORE the src swap so a
		// stale near-end currentTime from the previous source can't fire, then
		// unlock immediately — radio bypasses the queue loader whose `loadeddata`
		// listener normally unlocks, which is why radio never counted or scrobbled.
		this.resetPlayCount();
		this.unlockPlayCount();
		const el = this.audioElement;
		if (!el) return;
		this.clearRadioSeek(el);
		void this.attachRadioSource(el, np, assigned, autoplay);
		if (autoplay) {
			// play immediately (preserve the gesture), then align to station position
			el.play().catch((err: unknown) => {
				// a rapid station flip supersedes this load before its play() settles;
				// the rejection belongs to the DEAD load and must not touch state —
				// unguarded, it flipped `paused` under the successor and left the
				// radio on-air but silent (firehose → deep-cuts report, 2026-08-04)
				if (this.radio !== assigned) return;
				// the element aborting this play() because a new load started means
				// a successor owns playback now — nothing to record here either
				if ((err as { name?: string })?.name === 'AbortError') return;
				this.paused = true;
				// autoplay policy blocked a fresh tune-in: roll back to the pre-tune
				// state so the ui reads "tune in" again instead of a silent on-air
				// state ("stop" + LIVE). mid-session failures (station flips, track
				// boundaries) keep radio mode — only the entry is rolled back.
				if (!wasActive && (err as { name?: string })?.name === 'NotAllowedError') {
					this.radio = null;
					this.currentTrack = previousTrack;
				}
			});
		} else {
			el.pause();
		}
		// a broadcast has no position to resume — it is wherever it is.
		if (np.live) return;
		const seek = () => {
			this.radioSeek = null;
			// tuned away or stopped while metadata loaded — this seek belongs to a
			// source the element no longer plays.
			if (this.radio !== assigned) return;
			if (np.start_at > 0 && Number.isFinite(el.duration)) {
				el.currentTime = Math.min(np.start_at, el.duration);
			}
		};
		if (el.readyState >= 1) seek();
		else {
			this.radioSeek = seek;
			el.addEventListener('loadedmetadata', seek, { once: true });
		}
	}

	/** drop any pending station-position seek so it can't fire against a source
	 * it wasn't meant for. */
	private clearRadioSeek(el: HTMLAudioElement) {
		if (!this.radioSeek) return;
		el.removeEventListener('loadedmetadata', this.radioSeek);
		this.radioSeek = null;
	}

	/** fetch hls.js ahead of a tune-in, so attaching can happen synchronously.
	 *
	 * Mobile autoplay policy only honours a play() that runs in the same task as
	 * the tap. Awaiting the dynamic import inside the tap handler spends that
	 * permission, so the module is warmed as soon as the station's state says a
	 * broadcast is live — long before anyone taps. Idempotent; the in-flight
	 * promise is shared. Callers that don't have a live HLS source never call
	 * this and never download the chunk.
	 */
	preloadHls(): Promise<HlsModule | null> {
		this.hlsLoad ??= import('hls.js')
			.then(({ default: Hls }) => (this.hlsModule = Hls as unknown as HlsModule))
			.catch((e: unknown) => {
				console.error('failed to load hls.js for live radio:', e);
				this.hlsLoad = null; // let a later tune-in retry
				return null;
			});
		return this.hlsLoad;
	}

	/** point the shared element at a radio source, via hls.js when required.
	 *
	 * hls.js comes first wherever it works, and native `src` is the fallback —
	 * not the other way round. `canPlayType('application/vnd.apple.mpegurl')`
	 * answers "maybe" in Chrome, which cannot actually demux MPEG-TS, so
	 * trusting it hands the element a playlist it will never decode: on air,
	 * cover showing, silent. Where hls.js is unsupported native playback is
	 * real, and that is exactly the fallback.
	 *
	 * Synchronous whenever `preloadHls()` has already resolved, which is what
	 * keeps the tap's autoplay permission intact on mobile.
	 */
	private attachRadioSource(
		el: HTMLAudioElement,
		np: RadioNowPlaying,
		assigned: RadioNowPlaying | null,
		autoplay: boolean
	): void {
		this.detachHls();
		const playNative = () => {
			el.src = np.stream_url;
			el.load();
		};

		if (!np.live || np.streamKind !== 'hls') {
			playNative();
			return;
		}

		if (this.hlsModule) {
			this.attachHls(this.hlsModule, el, np, playNative);
			return;
		}

		// cold module: the tap's own play() will have failed against a sourceless
		// element, so replay it once media exists.
		void this.preloadHls().then((Hls) => {
			// compare against the $state proxy captured at tune-in — `np` is the
			// raw object and never equals `this.radio`.
			if (this.radio !== assigned) return; // tuned away while the chunk loaded
			if (!Hls) return void (this.paused = true);
			this.attachHls(Hls, el, np, playNative);
			if (autoplay) {
				el.play().catch(() => {
					// same staleness rule as the main play path: only the load that
					// still owns the element may record its failure
					if (this.radio === assigned) this.paused = true;
				});
			}
		});
	}

	private attachHls(
		Hls: HlsModule,
		el: HTMLAudioElement,
		np: RadioNowPlaying,
		playNative: () => void
	): void {
		if (!Hls.isSupported()) {
			playNative();
			return;
		}
		// iOS drives HLS through ManagedMediaSource, which the platform refuses to
		// hand to an element that still advertises AirPlay.
		el.disableRemotePlayback = true;
		const hls = new Hls({ enableWorker: true });
		this.hls = hls;
		hls.loadSource(np.stream_url);
		hls.attachMedia(el);
	}

	/** tear down any hls.js instance so its buffers and timers stop. */
	private detachHls() {
		if (!this.hls) return;
		try {
			this.hls.destroy();
		} catch (e) {
			console.error('failed to destroy hls instance:', e);
		}
		this.hls = null;
	}

	stopRadio() {
		this.radio = null;
		this.paused = true;
		if (this.audioElement) {
			this.audioElement.pause();
			this.clearRadioSeek(this.audioElement);
		}
		this.detachHls();
	}

	incrementPlayCount() {
		if (this._playCountLocked) return;
		// radio plays through the same element — count the on-air track so radio
		// listening feeds play counts and teal scrobbles like queue playback does
		const track = this.radio?.track ?? this.currentTrack;
		if (!track || this.playCountedForTrack === track.id || !this.duration) {
			return;
		}

		// accumulate real listened time from forward playback only. a seek or a
		// hydration position-restore jumps currentTime with nothing listened, so
		// large or backward steps (and any step while paused) are ignored.
		const now = this.currentTime;
		if (this._lastProgressTime !== null) {
			const delta = now - this._lastProgressTime;
			if (!this.paused && delta > 0 && delta <= PLAY_PROGRESS_SEEK_THRESHOLD_S) {
				this._playedSeconds += delta;
			}
		}
		this._lastProgressTime = now;

		// synchronous check to prevent race condition from batched reactive updates
		if (this._playCountPending === track.id) {
			return;
		}

		// threshold: minimum of 30 seconds or 50% of track duration
		const threshold = Math.min(30, this.duration * 0.5);

		if (this._playedSeconds >= threshold) {
			// set synchronous guard immediately (before async fetch)
			this._playCountPending = track.id;
			this.playCountedForTrack = track.id;

			// include ref if it's for this track (for share link tracking)
			const refForTrack = this._refTrackId === track.id ? this.ref : null;
			const playRequest = IS_ZIG_V1
				? recordZigPlay(API_URL, String(track.id), refForTrack)
				: fetch(`${API_URL}/tracks/${track.id}/play`, {
						method: 'POST',
						credentials: 'include',
						headers: refForTrack ? { 'Content-Type': 'application/json' } : undefined,
						body: refForTrack ? JSON.stringify({ ref: refForTrack }) : undefined
					});
			playRequest.catch((err) => {
				console.error('failed to increment play count:', err);
			});
		}
	}

	resetPlayCount() {
		this.playCountedForTrack = null;
		this._playCountPending = null;
		this._playCountLocked = true;
		this._playedSeconds = 0;
		this._lastProgressTime = null;
	}

	unlockPlayCount() {
		this._playCountLocked = false;
	}

	reset() {
		this.currentTime = 0;
		this.paused = true;
	}
}

export const player = new PlayerState();
