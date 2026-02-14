import { API_URL } from '$lib/config';
import type { AlbumResponse, Track } from '$lib/types';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export interface CollectionData {
	title: string;
	subtitle: string;
	subtitleUrl: string;
	collectionUrl: string;
	imageUrl: string | null;
	tracks: Track[];
}

export const load: PageServerLoad = async ({ params, fetch }) => {
	try {
		const response = await fetch(`${API_URL}/albums/${params.handle}/${params.slug}`);

		if (!response.ok) {
			throw error(404, 'album not found');
		}

		const album: AlbumResponse = await response.json();

		return {
			collection: {
				title: album.metadata.title,
				subtitle: album.metadata.artist_handle,
				subtitleUrl: `https://plyr.fm/u/${album.metadata.artist_handle}`,
				collectionUrl: `https://plyr.fm/u/${params.handle}/album/${params.slug}`,
				imageUrl: album.metadata.image_url ?? null,
				tracks: album.tracks
			} satisfies CollectionData
		};
	} catch (e) {
		console.error('failed to load album:', e);
		throw error(404, 'album not found');
	}
};
