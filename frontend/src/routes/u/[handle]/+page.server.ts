import { API_URL } from '$lib/config';
import type { Artist, Track } from '$lib/types';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch }) => {
	try {
		// fetch artist info server-side for SEO/link previews
		const artistResponse = await fetch(`${API_URL}/artists/by-handle/${params.handle}`);

		if (!artistResponse.ok) {
			throw error(404, 'artist not found');
		}

		const artist: Artist = await artistResponse.json();

		// fetch artist's tracks
		const tracksResponse = await fetch(`${API_URL}/tracks/?artist_did=${artist.did}`);
		let tracks: Track[] = [];

		if (tracksResponse.ok) {
			const data = await tracksResponse.json();
			tracks = data.tracks || [];
		}

		return {
			artist,
			tracks
		};
	} catch (e) {
		console.error('failed to load artist:', e);
		throw error(404, 'artist not found');
	}
};
