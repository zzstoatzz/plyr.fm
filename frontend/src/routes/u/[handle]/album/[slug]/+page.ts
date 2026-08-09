import type { PageLoad } from './$types';
import type { AlbumResponse } from '$lib/types';
import { getZigAlbum } from '$lib/api/zig-v1-albums';
import { API_URL, IS_ZIG_V1 } from '$lib/config';
import { error } from '@sveltejs/kit';

export const load: PageLoad = async ({ params, fetch }) => {
	if (IS_ZIG_V1) {
		const album = await getZigAlbum(API_URL, params.slug, fetch);
		if (!album) throw error(404, 'album not found');
		return { album };
	}

	// resolve DID to handle if needed (albums endpoint expects handle)
	let handle = params.handle;
	if (handle.startsWith('did:')) {
		const res = await fetch(`${API_URL}/artists/${handle}`);
		if (res.ok) {
			const artist = await res.json();
			handle = artist.handle;
		}
	}

	const response = await fetch(`${API_URL}/albums/${handle}/${params.slug}`, {
		credentials: 'include'
	});

	if (!response.ok) {
		throw new Error(`failed to load album: ${response.statusText}`);
	}

	const album: AlbumResponse = await response.json();

	return {
		album
	};
};
