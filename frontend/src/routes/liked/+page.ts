import { browser } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import { fetchLikedTracks } from '$lib/tracks.svelte';
import type { Track } from '$lib/types';
import type { LoadEvent } from '@sveltejs/kit';

export interface PageData {
	tracks: Track[];
}

export const ssr = false;

export async function load({ parent }: LoadEvent): Promise<PageData> {
	if (!browser) {
		return { tracks: [] };
	}

	// check auth from parent layout data
	const { isAuthenticated } = await parent();
	if (!isAuthenticated) {
		throw redirect(302, '/');
	}

	try {
		const tracks = await fetchLikedTracks();
		return { tracks };
	} catch (e) {
		console.error('failed to load liked tracks:', e);
		return { tracks: [] };
	}
}
