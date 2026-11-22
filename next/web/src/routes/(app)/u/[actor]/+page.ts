import { api } from '$lib/api';
import { loadOrError } from '$lib/load-error';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
	const artist = await loadOrError(() => api.artist(params.actor), "we couldn't find that artist");
	return {
		artist,
		metrics: api.artistMetrics(artist.did).catch(() => null)
	};
};
