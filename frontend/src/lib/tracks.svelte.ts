import { API_URL } from './config';
import type { Track } from './types';

// load cached tracks from localStorage (no time check - trust invalidate() calls)
function loadCachedTracks(): Track[] {
	if (typeof window === 'undefined') return [];
	try {
		const cached = localStorage.getItem('tracks_cache');
		if (cached) {
			const { tracks } = JSON.parse(cached);
			return tracks;
		}
	} catch (e) {
		console.warn('failed to load cached tracks:', e);
	}
	return [];
}

// global tracks cache using Svelte 5 runes
class TracksCache {
	tracks = $state<Track[]>(loadCachedTracks());
	loading = $state(false);

	async fetch(force = false): Promise<void> {
		// always fetch in background to check for updates
		// unless we're already loading
		if (!force && this.loading) {
			return;
		}

		this.loading = true;
		try {
			const response = await fetch(`${API_URL}/tracks/`);
			const data = await response.json();
			this.tracks = data.tracks;

			// persist to localStorage
			if (typeof window !== 'undefined') {
				try {
					localStorage.setItem('tracks_cache', JSON.stringify({
						tracks: this.tracks
					}));
				} catch (e) {
					console.warn('failed to cache tracks:', e);
				}
			}
		} catch (e) {
			console.error('failed to fetch tracks:', e);
		} finally {
			this.loading = false;
		}
	}

	invalidate(): void {
		// clear cache - next fetch will get fresh data
		if (typeof window !== 'undefined') {
			localStorage.removeItem('tracks_cache');
		}
	}
}

export const tracksCache = new TracksCache();
