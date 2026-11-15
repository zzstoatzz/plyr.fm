import { api } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
	const artist = await api.artist(params.actor);
	return {
		artist,
		tracks: api.tracks({ artist_did: artist.did, limit: 30 }).then(page => page.data),
		metrics: api.artistMetrics(artist.did).then(item => item.totals, () => null)
	};
};
