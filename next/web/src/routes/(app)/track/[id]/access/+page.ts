import { api } from '$lib/api';
import { loadOrError } from '$lib/load-error';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => ({
	track: await loadOrError(() => api.track(params.id), "we couldn't find that track")
});
