import { api } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';
	return { query, results: query.length >= 2 ? api.search(query, { limit: 40 }).then(page => page.data) : Promise.resolve([]) };
};
