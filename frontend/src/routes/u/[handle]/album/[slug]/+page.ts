import type { PageLoad } from './$types';
import type { AlbumResponse } from '$lib/types';
import { API_URL } from '$lib/config';

export const load: PageLoad = async ({ params, fetch }) => {
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
