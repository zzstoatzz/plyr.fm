import { api } from '$lib/api';
import { loadOrError } from '$lib/load-error';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => ({
	list: await loadOrError(() => api.album(params.id), "we couldn't find that album")
});
