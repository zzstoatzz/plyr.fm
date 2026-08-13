import { API_URL, IS_ZIG_V1 } from '$lib/config';
import type { Playlist } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch }) => {
	// The universal load reads the full verified Zig resource during SSR.
	if (IS_ZIG_V1) return { playlistMeta: null };

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
