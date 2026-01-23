import { browser } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import { fetchLikedTracks } from '$lib/tracks.svelte';
import { auth } from '$lib/auth.svelte';
import type { Track } from '$lib/types';

export interface PageData {
	tracks: Track[];
}

export const ssr = false;

export async function load(): Promise<PageData> {
	if (!browser) {
		return { tracks: [] };
	}

	// ensure auth is initialized before checking
	await auth.initialize();
	if (!auth.isAuthenticated) {
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
