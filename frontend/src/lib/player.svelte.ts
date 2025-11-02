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

	playTrack(track: Track) {
		if (this.currentTrack?.id === track.id) {
			// toggle play/pause for same track
			this.paused = !this.paused;
		} else {
			// switch tracks
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

		// threshold: minimum of 30 seconds or 50% of track duration
		const threshold = Math.min(30, this.duration * 0.5);

		if (this.currentTime >= threshold) {
			this.playCountedForTrack = this.currentTrack.id;

			fetch(`${API_URL}/tracks/${this.currentTrack.id}/play`, {
				method: 'POST'
			}).catch(err => {
				console.error('failed to increment play count:', err);
			});
		}
	}

	reset() {
		this.currentTime = 0;
		this.paused = true;
	}
}

export const player = new PlayerState();
