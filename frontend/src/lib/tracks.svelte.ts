import { API_URL } from './config';
import type { Track } from './types';
import { preferences } from './preferences.svelte';
import { downloadAudio, isDownloaded } from './storage';

interface TracksApiResponse {
	tracks: Track[];
	next_cursor: string | null;
	has_more: boolean;
}

interface CachedTracksData {
	tracks: Track[];
	nextCursor: string | null;
	hasMore: boolean;
}

// load cached tracks from localStorage (no time check - trust invalidate() calls)
function loadCachedTracks(): CachedTracksData {
	if (typeof window === 'undefined') {
		return { tracks: [], nextCursor: null, hasMore: true };
	}
	try {
		const cached = localStorage.getItem('tracks_cache');
		if (cached) {
			const data = JSON.parse(cached);
			// check if cache has the new is_liked field, if not invalidate
			if (data.tracks && data.tracks.length > 0 && !('is_liked' in data.tracks[0])) {
				localStorage.removeItem('tracks_cache');
				return { tracks: [], nextCursor: null, hasMore: true };
			}
			return {
				tracks: data.tracks || [],
				nextCursor: data.nextCursor ?? null,
				hasMore: data.hasMore ?? true
			};
		}
	} catch (e) {
		console.warn('failed to load cached tracks:', e);
	}
	return { tracks: [], nextCursor: null, hasMore: true };
}

// global tracks cache using Svelte 5 runes
class TracksCache {
	tracks = $state<Track[]>(loadCachedTracks().tracks);
	loading = $state(false);
	loadingMore = $state(false);
	nextCursor = $state<string | null>(loadCachedTracks().nextCursor);
	hasMore = $state(loadCachedTracks().hasMore);

	private persistToStorage(): void {
		if (typeof window !== 'undefined') {
			try {
				localStorage.setItem(
					'tracks_cache',
					JSON.stringify({
						tracks: this.tracks,
						nextCursor: this.nextCursor,
						hasMore: this.hasMore
					})
				);
			} catch (e) {
				console.warn('failed to cache tracks:', e);
			}
		}
	}

	async fetch(force = false): Promise<void> {
		// always fetch in background to check for updates
		// unless we're already loading
		if (!force && this.loading) {
			return;
		}

		this.loading = true;
		try {
			const response = await fetch(`${API_URL}/tracks/`, {
				credentials: 'include'
			});
			const data: TracksApiResponse = await response.json();
			this.tracks = data.tracks;
			this.nextCursor = data.next_cursor;
			this.hasMore = data.has_more;

			this.persistToStorage();
		} catch (e) {
			console.error('failed to fetch tracks:', e);
		} finally {
			this.loading = false;
		}
	}

	async fetchMore(): Promise<void> {
		// don't fetch if already loading or no more results
		if (this.loadingMore || this.loading || !this.hasMore || !this.nextCursor) {
			return;
		}

		this.loadingMore = true;
		try {
			const url = new URL(`${API_URL}/tracks/`);
			url.searchParams.set('cursor', this.nextCursor);

			const response = await fetch(url.toString(), {
				credentials: 'include'
			});
			const data: TracksApiResponse = await response.json();

			// append new tracks to existing list
			this.tracks = [...this.tracks, ...data.tracks];
			this.nextCursor = data.next_cursor;
			this.hasMore = data.has_more;

			this.persistToStorage();
		} catch (e) {
			console.error('failed to fetch more tracks:', e);
		} finally {
			this.loadingMore = false;
		}
	}

	invalidate(): void {
		// clear cache and reset pagination state - next fetch will get fresh data
		if (typeof window !== 'undefined') {
			localStorage.removeItem('tracks_cache');
		}
		this.nextCursor = null;
		this.hasMore = true;
	}
}

export const tracksCache = new TracksCache();

// like/unlike track functions
export async function likeTrack(trackId: number, fileId?: string): Promise<boolean> {
	try {
		const response = await fetch(`${API_URL}/tracks/${trackId}/like`, {
			method: 'POST',
			credentials: 'include'
		});

		if (!response.ok) {
			throw new Error(`failed to like track: ${response.statusText}`);
		}

		// invalidate cache so next fetch gets updated like status
		tracksCache.invalidate();

		// auto-download if preference is enabled and file_id provided
		if (fileId && preferences.autoDownloadLiked) {
			try {
				const alreadyDownloaded = await isDownloaded(fileId);
				if (!alreadyDownloaded) {
					// download in background, don't await
					downloadAudio(fileId).catch((err) => {
						console.error('auto-download failed:', err);
					});
				}
			} catch (err) {
				console.error('failed to check/download:', err);
			}
		}

		return true;
	} catch (e) {
		console.error('failed to like track:', e);
		return false;
	}
}

export async function unlikeTrack(trackId: number): Promise<boolean> {
	try {
		const response = await fetch(`${API_URL}/tracks/${trackId}/like`, {
			method: 'DELETE',
			credentials: 'include'
		});

		if (!response.ok) {
			throw new Error(`failed to unlike track: ${response.statusText}`);
		}

		// invalidate cache so next fetch gets updated like status
		tracksCache.invalidate();

		return true;
	} catch (e) {
		console.error('failed to unlike track:', e);
		return false;
	}
}

export async function fetchLikedTracks(): Promise<Track[]> {
	try {
		const response = await fetch(`${API_URL}/tracks/liked`, {
			credentials: 'include'
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

export interface UserLikesResponse {
	user: {
		did: string;
		handle: string;
		display_name: string | null;
		avatar_url: string | null;
	};
	tracks: Track[];
	count: number;
}

export async function fetchUserLikes(handle: string): Promise<UserLikesResponse | null> {
	try {
		const response = await fetch(`${API_URL}/users/${handle}/likes`, {
			credentials: 'include'
		});

		if (response.status === 404) {
			return null;
		}

		if (!response.ok) {
			throw new Error(`failed to fetch user likes: ${response.statusText}`);
		}

		return await response.json();
	} catch (e) {
		console.error('failed to fetch user likes:', e);
		return null;
	}
}
