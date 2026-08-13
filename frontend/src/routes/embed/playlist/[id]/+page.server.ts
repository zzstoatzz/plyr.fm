import { getZigPlaylist } from '$lib/api/zig-v1-playlists';
import { APP_CANONICAL_URL } from '$lib/branding';
import { API_URL, IS_ZIG_V1 } from '$lib/config';
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
		if (IS_ZIG_V1) {
			const playlist = await getZigPlaylist(API_URL, params.id, fetch);
			if (!playlist) throw error(404, 'playlist not found');
			return {
				collection: {
					title: playlist.name,
					subtitle: playlist.owner_handle,
					subtitleUrl: `${APP_CANONICAL_URL}/u/${playlist.owner_handle}`,
					collectionUrl: `${APP_CANONICAL_URL}/playlist/${playlist.id}`,
					imageUrl: playlist.image_url ?? null,
					tracks: playlist.tracks
				} satisfies CollectionData
			};
		}

		const response = await fetch(`${API_URL}/lists/playlists/${params.id}`);

		if (!response.ok) {
			throw error(404, 'playlist not found');
		}

		const playlist: PlaylistResponse = await response.json();

		return {
			collection: {
				title: playlist.name,
				subtitle: playlist.owner_handle,
				subtitleUrl: `${APP_CANONICAL_URL}/u/${playlist.owner_handle}`,
				collectionUrl: `${APP_CANONICAL_URL}/playlist/${playlist.id}`,
				imageUrl: playlist.image_url ?? null,
				tracks: playlist.tracks
			} satisfies CollectionData
		};
	} catch (e) {
		console.error('failed to load playlist:', e);
		throw error(404, 'playlist not found');
	}
};
