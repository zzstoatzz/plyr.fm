import { API_URL } from '$lib/config';
import type { Artist, Track } from '$lib/types';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { CollectionData } from '../../album/[handle]/[slug]/+page.server';

export const load: PageServerLoad = async ({ params, fetch }) => {
	try {
		const isDid = params.handle.startsWith('did:');
		const artistUrl = isDid
			? `${API_URL}/artists/${params.handle}`
			: `${API_URL}/artists/by-handle/${params.handle}`;
		const artistResponse = await fetch(artistUrl);

		if (!artistResponse.ok) {
			throw error(404, 'artist not found');
		}

		const artist: Artist = await artistResponse.json();

		const tracksResponse = await fetch(
			`${API_URL}/tracks/?artist_did=${artist.did}&limit=10`
		);
		let tracks: Track[] = [];

		if (tracksResponse.ok) {
			const data = await tracksResponse.json();
			tracks = data.tracks || [];
		}

		return {
			collection: {
				title: artist.display_name,
				subtitle: `@${artist.handle}`,
				subtitleUrl: `https://plyr.fm/u/${artist.handle}`,
				collectionUrl: `https://plyr.fm/u/${artist.handle}`,
				imageUrl: artist.avatar_url ?? null,
				tracks
			} satisfies CollectionData
		};
	} catch (e) {
		console.error('failed to load artist:', e);
		throw error(404, 'artist not found');
	}
};
