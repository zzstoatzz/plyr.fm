import { redirect } from '@sveltejs/kit';
import { canonicalId } from '@plyr/next-core/api';
import { api } from '$lib/api';
import { loadOrError } from '$lib/load-error';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, url }) => {
	if (canonicalId(params.id) !== params.id) redirect(308, `/album/${canonicalId(params.id)}` + url.search);
	return { list: await loadOrError(() => api.album(params.id), "we couldn't find that album") };
};
