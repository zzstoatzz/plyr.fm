import { browser } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import { fetchLikedTracks } from '$lib/tracks.svelte';
import type { LoadEvent } from '@sveltejs/kit';

export interface PageData {
	likedCount: number;
}

export const ssr = false;

export async function load({ parent }: LoadEvent): Promise<PageData> {
	if (!browser) {
		return { likedCount: 0 };
	}

	// check auth from parent layout data
	const { isAuthenticated } = await parent();
	if (!isAuthenticated) {
		throw redirect(302, '/');
	}

	try {
		const tracks = await fetchLikedTracks();
		return { likedCount: tracks.length };
	} catch (e) {
		console.error('failed to load library data:', e);
		return { likedCount: 0 };
	}
}
