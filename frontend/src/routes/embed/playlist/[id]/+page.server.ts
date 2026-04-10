import { API_URL } from '$lib/config';
import type { CollectionData, Track } from '$lib/types';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

interface PlaylistResponse {
	id: string;
	name: string;
	owner_handle: string;
	image_url?: string;
	tracks: Track[];
}

export const load: PageServerLoad = async ({ params, fetch }) => {
	try {
		const response = await fetch(`${API_URL}/lists/playlists/${params.id}`);

		if (!response.ok) {
			throw error(404, 'playlist not found');
		}

		const playlist: PlaylistResponse = await response.json();

		return {
			collection: {
				title: playlist.name,
				subtitle: playlist.owner_handle,
				subtitleUrl: `https://plyr.fm/u/${playlist.owner_handle}`,
				collectionUrl: `https://plyr.fm/playlist/${playlist.id}`,
				imageUrl: playlist.image_url ?? null,
				tracks: playlist.tracks
			} satisfies CollectionData
		};
	} catch (e) {
		console.error('failed to load playlist:', e);
		throw error(404, 'playlist not found');
	}
};
