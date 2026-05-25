import type { Track } from './types';
import { API_URL } from './config';

// natural timeupdate steps are sub-second; a larger jump is a seek, scrub, or a
// restored hydration position — none of which is listened time.
const PLAY_PROGRESS_SEEK_THRESHOLD_S = 5;

// global player state using Svelte 5 runes
class PlayerState {
	currentTrack = $state<Track | null>(null);
	audioElement = $state<HTMLAudioElement | undefined>(undefined);
	paused = $state(true);

	currentTime = $state(0);
	duration = $state(0);
	volume = $state(0.7);
	playCountedForTrack = $state<number | null>(null);

	// share link tracking: ref code from ?ref= URL param
	ref = $state<string | null>(null);
	private _refTrackId: number | null = null; // track the ref is associated with

	// synchronous guard to prevent duplicate play count requests
	// (reactive state updates are batched, so we need this to block rapid-fire calls)
	private _playCountPending: number | null = null;

	// accumulated *listened* time for the current track (seconds). only advances
	// while playing and stepping forward naturally, so seeks and restored
	// hydration positions never trip the play-count threshold on their own.
	private _playedSeconds = 0;
	private _lastProgressTime: number | null = null;

	// lock play counting during track transitions to prevent spurious fires
	// from stale currentTime/duration values before new audio loads
	private _playCountLocked = $state(false);

	setRef(code: string | null, trackId: number | null = null) {
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

	incrementPlayCount() {
		if (this._playCountLocked) return;
		if (!this.currentTrack || this.playCountedForTrack === this.currentTrack.id || !this.duration) {
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
		if (this._playCountPending === this.currentTrack.id) {
			return;
		}

		// threshold: minimum of 30 seconds or 50% of track duration
		const threshold = Math.min(30, this.duration * 0.5);

		if (this._playedSeconds >= threshold) {
			// set synchronous guard immediately (before async fetch)
			this._playCountPending = this.currentTrack.id;
			this.playCountedForTrack = this.currentTrack.id;

			// include ref if it's for this track (for share link tracking)
			const refForTrack = this._refTrackId === this.currentTrack.id ? this.ref : null;

			fetch(`${API_URL}/tracks/${this.currentTrack.id}/play`, {
				method: 'POST',
				credentials: 'include',
				headers: refForTrack ? { 'Content-Type': 'application/json' } : undefined,
				body: refForTrack ? JSON.stringify({ ref: refForTrack }) : undefined
			}).catch(err => {
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
