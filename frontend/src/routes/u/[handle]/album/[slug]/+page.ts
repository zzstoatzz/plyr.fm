import type { PageLoad } from './$types';
import type { AlbumResponse } from '$lib/types';
import { API_URL } from '$lib/config';

export const load: PageLoad = async ({ params, fetch }) => {
	const response = await fetch(`${API_URL}/albums/${params.handle}/${params.slug}`, {
		credentials: 'include'
	});

	if (!response.ok) {
		throw new Error(`failed to load album: ${response.statusText}`);
	}

	const album: AlbumResponse = await response.json();

	return {
		album
	};
};
