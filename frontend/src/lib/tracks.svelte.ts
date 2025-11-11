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

// like/unlike track functions
export async function likeTrack(trackId: number): Promise<boolean> {
	try {
		const sessionId = localStorage.getItem('session_id');
		const response = await fetch(`${API_URL}/tracks/${trackId}/like`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${sessionId}`
			}
		});

		if (!response.ok) {
			throw new Error(`failed to like track: ${response.statusText}`);
		}

		return true;
	} catch (e) {
		console.error('failed to like track:', e);
		return false;
	}
}

export async function unlikeTrack(trackId: number): Promise<boolean> {
	try {
		const sessionId = localStorage.getItem('session_id');
		const response = await fetch(`${API_URL}/tracks/${trackId}/like`, {
			method: 'DELETE',
			headers: {
				'Authorization': `Bearer ${sessionId}`
			}
		});

		if (!response.ok) {
			throw new Error(`failed to unlike track: ${response.statusText}`);
		}

		return true;
	} catch (e) {
		console.error('failed to unlike track:', e);
		return false;
	}
}

export async function fetchLikedTracks(): Promise<Track[]> {
	try {
		const sessionId = localStorage.getItem('session_id');
		const response = await fetch(`${API_URL}/tracks/liked`, {
			headers: {
				'Authorization': `Bearer ${sessionId}`
			}
		});

		if (!response.ok) {
			throw new Error(`failed to fetch liked tracks: ${response.statusText}`);
		}

		const data = await response.json();
		return data.tracks;
	} catch (e) {
		console.error('failed to fetch liked tracks:', e);
		return [];
	}
}
