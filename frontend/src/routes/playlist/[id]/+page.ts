import { browser } from '$app/environment';
import { redirect, error } from '@sveltejs/kit';
import type { LoadEvent } from '@sveltejs/kit';
import type { PlaylistWithTracks } from '$lib/types';

export interface PageData {
	playlist: PlaylistWithTracks;
}

export const ssr = false;

export async function load({ params, parent }: LoadEvent): Promise<PageData> {
	if (!browser) {
		throw redirect(302, '/library');
	}

	// check auth from parent layout data
	const { isAuthenticated } = await parent();
	if (!isAuthenticated) {
		throw redirect(302, '/');
	}

	const response = await fetch(`/api/lists/playlists/${params.id}`, {
		credentials: 'include'
	});

	if (!response.ok) {
		if (response.status === 404) {
			throw error(404, 'playlist not found');
		}
		throw error(500, 'failed to load playlist');
	}

	const playlist = await response.json();
	return { playlist };
}
