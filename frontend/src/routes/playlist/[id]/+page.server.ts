import { API_URL } from '$lib/config';
import type { Playlist } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch }) => {
	try {
		// fetch public metadata for OG tags (no auth required)
		const response = await fetch(`${API_URL}/lists/playlists/${params.id}/meta`);

		if (!response.ok) {
			return { playlistMeta: null };
		}

		const playlistMeta: Playlist = await response.json();
		return { playlistMeta };
	} catch (e) {
		console.error('failed to load playlist meta:', e);
		return { playlistMeta: null };
	}
};
