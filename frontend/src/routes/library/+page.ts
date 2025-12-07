import { browser } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import { fetchLikedTracks } from '$lib/tracks.svelte';
import type { LoadEvent } from '@sveltejs/kit';
import type { Playlist } from '$lib/types';

export interface PageData {
	likedCount: number;
	playlists: Playlist[];
}

export const ssr = false;

async function fetchPlaylists(): Promise<Playlist[]> {
	const response = await fetch('/api/lists/playlists', {
		credentials: 'include'
	});
	if (!response.ok) {
		throw new Error('failed to fetch playlists');
	}
	return response.json();
}

export async function load({ parent }: LoadEvent): Promise<PageData> {
	if (!browser) {
		return { likedCount: 0, playlists: [] };
	}

	// check auth from parent layout data
	const { isAuthenticated } = await parent();
	if (!isAuthenticated) {
		throw redirect(302, '/');
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
