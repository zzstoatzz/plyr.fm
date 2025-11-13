import { browser } from '$app/environment';
import { fetchLikedTracks } from '$lib/tracks.svelte';
import type { Track } from '$lib/types';

export interface PageData {
	tracks: Track[];
}

export const ssr = false;

export async function load(): Promise<PageData> {
	if (!browser) {
		return { tracks: [] };
	}

	try {
		const tracks = await fetchLikedTracks();
		return { tracks };
	} catch (e) {
		console.error('failed to load liked tracks:', e);
		return { tracks: [] };
	}
}
