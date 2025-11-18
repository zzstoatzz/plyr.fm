import { API_URL } from '$lib/config';
import type { Artist, Track, ArtistAlbumSummary } from '$lib/types';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch, cookies }) => {
	try {
		// get session cookie to forward to API for liked state
		const sessionId = cookies.get('session_id');
		const headers: HeadersInit = {};
		if (sessionId) {
			headers['Cookie'] = `session_id=${sessionId}`;
		}

		// fetch artist info server-side for SEO/link previews
		const artistResponse = await fetch(`${API_URL}/artists/by-handle/${params.handle}`);

		if (!artistResponse.ok) {
			throw error(404, 'artist not found');
		}

		const artist: Artist = await artistResponse.json();

		// fetch artist's tracks with session cookie for liked state
		const tracksResponse = await fetch(`${API_URL}/tracks/?artist_did=${artist.did}`, {
			headers
		});
		let tracks: Track[] = [];

		if (tracksResponse.ok) {
			const data = await tracksResponse.json();
			tracks = data.tracks || [];
		}

		const albumsResponse = await fetch(`${API_URL}/albums/${params.handle}`, {
			headers
		});
		let albums: ArtistAlbumSummary[] = [];

		if (albumsResponse.ok) {
			const albumData = await albumsResponse.json();
			albums = albumData.albums ?? [];
		}

		return {
			artist,
			tracks,
			albums
		};
	} catch (e) {
		console.error('failed to load artist:', e);
		throw error(404, 'artist not found');
	}
};
