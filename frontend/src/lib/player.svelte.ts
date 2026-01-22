import type { Track } from './types';
import { API_URL } from './config';

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
		if (!this.currentTrack || this.playCountedForTrack === this.currentTrack.id || !this.duration) {
			return;
		}

		// synchronous check to prevent race condition from batched reactive updates
		if (this._playCountPending === this.currentTrack.id) {
			return;
		}

		// threshold: minimum of 30 seconds or 50% of track duration
		const threshold = Math.min(30, this.duration * 0.5);

		if (this.currentTime >= threshold) {
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
	}

	reset() {
		this.currentTime = 0;
		this.paused = true;
	}
}

export const player = new PlayerState();
