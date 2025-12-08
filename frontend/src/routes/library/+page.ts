import { browser } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import { API_URL } from '$lib/config';
import type { LoadEvent } from '@sveltejs/kit';
import type { Playlist, Track } from '$lib/types';

export interface PageData {
	likedCount: number;
	playlists: Playlist[];
}

export const ssr = false;

export async function load({ parent, fetch }: LoadEvent): Promise<PageData> {
	if (!browser) {
		return { likedCount: 0, playlists: [] };
	}

	// check auth from parent layout data
	const { isAuthenticated } = await parent();
	if (!isAuthenticated) {
		throw redirect(302, '/');
	}

	async function fetchLikedTracks(): Promise<Track[]> {
		const response = await fetch(`${API_URL}/tracks/liked`, {
			credentials: 'include'
		});
		if (!response.ok) {
			throw new Error('failed to fetch liked tracks');
		}
		return response.json();
	}

	async function fetchPlaylists(): Promise<Playlist[]> {
		const response = await fetch(`${API_URL}/lists/playlists`, {
			credentials: 'include'
		});
		if (!response.ok) {
			throw new Error('failed to fetch playlists');
		}
		return response.json();
	}

	try {
		const [tracks, playlists] = await Promise.all([
			fetchLikedTracks(),
			fetchPlaylists().catch(() => [] as Playlist[])
		]);
		return { likedCount: tracks.length, playlists };
	} catch (e) {
		console.error('failed to load library data:', e);
		return { likedCount: 0, playlists: [] };
	}
}
