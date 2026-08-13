import { getZigArtist, listZigTracks } from '$lib/api/zig-v1';
import { listZigAlbums } from '$lib/api/zig-v1-albums';
import { listZigPlaylists } from '$lib/api/zig-v1-playlists';
import { API_URL, IS_ZIG_V1 } from '$lib/config';
import type { Artist, Track, ArtistAlbumSummary } from '$lib/types';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch }) => {
	try {
		if (IS_ZIG_V1) {
			const artist = await getZigArtist(API_URL, params.handle, fetch);
			if (!artist) throw error(404, 'artist not found');
			const [page, albumPage, playlistPage] = await Promise.all([
				listZigTracks(API_URL, { artistDid: artist.did, limit: 5 }, fetch),
				listZigAlbums(API_URL, artist.did, { limit: 100 }, fetch),
				listZigPlaylists(API_URL, artist.did, { limit: 100 }, fetch)
			]);
			return {
				artist,
				tracks: page.tracks,
				albums: albumPage.albums,
				playlists: playlistPage.playlists,
				hasMoreTracks: page.has_more,
				nextCursor: page.next_cursor,
				hasMorePlaylists: playlistPage.has_more,
				nextPlaylistCursor: playlistPage.next_cursor
			};
		}

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

		// The session cookie is host-only on the API origin, so the browser never
		// sends it here and there is nothing to forward -- #284 tried exactly that
		// and abandoned it. This render is therefore always the anonymous view.
		//
		// That is fine now only because an artist-scoped listing no longer filters
		// on viewer preference: SSR and the hydrated client agree, so there is no
		// flash of a shorter list.
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
