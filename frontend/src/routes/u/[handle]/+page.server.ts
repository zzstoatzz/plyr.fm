import { API_URL } from '$lib/config';
import type { Artist, Track, ArtistAlbumSummary } from '$lib/types';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch }) => {
	try {
		// fetch artist info server-side for SEO/link previews
		// support both handle and DID in the URL for permalinks
		const isDid = params.handle.startsWith('did:');
		const artistUrl = isDid
			? `${API_URL}/artists/${params.handle}`
			: `${API_URL}/artists/by-handle/${params.handle}`;
		const artistResponse = await fetch(artistUrl);

		if (!artistResponse.ok) {
			throw error(404, 'artist not found');
		}

		const artist: Artist = await artistResponse.json();

		// fetch artist's tracks server-side (no cookie available on frontend host)
		const tracksResponse = await fetch(`${API_URL}/tracks/?artist_did=${artist.did}&limit=5`);
		let tracks: Track[] = [];
		let hasMoreTracks = false;
		let nextCursor: string | null = null;

		if (tracksResponse.ok) {
			const data = await tracksResponse.json();
			tracks = data.tracks || [];
			hasMoreTracks = data.has_more || false;
			nextCursor = data.next_cursor || null;
		}

		const albumsResponse = await fetch(`${API_URL}/albums/${artist.handle}`);
		let albums: ArtistAlbumSummary[] = [];

		if (albumsResponse.ok) {
			const albumData = await albumsResponse.json();
			albums = albumData.albums ?? [];
		}

		return {
			artist,
			tracks,
			albums,
			hasMoreTracks,
			nextCursor
		};
	} catch (e) {
		console.error('failed to load artist:', e);
		throw error(404, 'artist not found');
	}
};
