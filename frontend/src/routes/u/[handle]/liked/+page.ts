import { browser } from '$app/environment';
import { error } from '@sveltejs/kit';
import { fetchUserLikes, type UserLikesResponse } from '$lib/tracks.svelte';
import type { PageLoad } from './$types';

export interface PageData {
	userLikes: UserLikesResponse;
}

export const ssr = false;

export const load: PageLoad = async ({ params }) => {
	if (!browser) {
		return { userLikes: null };
	}

	const userLikes = await fetchUserLikes(params.handle);

	if (!userLikes) {
		throw error(404, 'user not found');
	}

	return { userLikes };
};
