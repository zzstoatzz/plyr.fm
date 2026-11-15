import { api } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
	const artist = await api.artist(params.actor);
	return {
		artist,
		metrics: api.artistMetrics(artist.did).then(item => item.totals, () => null)
	};
};
