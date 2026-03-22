import { browser } from '$app/environment';
import { error } from '@sveltejs/kit';
import { fetchUserLikes, type UserLikesResponse } from '$lib/tracks.svelte';
import { API_URL } from '$lib/config';
import type { PageLoad } from './$types';

export interface PageData {
	userLikes: UserLikesResponse;
}

export const ssr = false;

export const load: PageLoad = async ({ params, fetch }) => {
	if (!browser) {
		return { userLikes: null };
	}

	// resolve DID to handle if needed (likes endpoint expects handle)
	let handle = params.handle;
	if (handle.startsWith('did:')) {
		const res = await fetch(`${API_URL}/artists/${handle}`);
		if (!res.ok) throw error(404, 'user not found');
		const artist = await res.json();
		handle = artist.handle;
	}

	const userLikes = await fetchUserLikes(handle);

	if (!userLikes) {
		throw error(404, 'user not found');
	}

	return { userLikes };
};
