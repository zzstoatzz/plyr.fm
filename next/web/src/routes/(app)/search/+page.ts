import { api } from '$lib/api';
import type { PageLoad } from './$types';

const resultTypes = ['track', 'artist', 'album', 'playlist'] as const;

export const load: PageLoad = ({ url, depends }) => {
	depends('plyr:catalog-search');
	const query = url.searchParams.get('q')?.trim() ?? '';
	const requested = url.searchParams.get('type');
	const type = resultTypes.find(value => value === requested);
	return { query, type, results: [...query].length >= 2 ? api.search(query, { limit: 40, types: type }).then(page => page.data) : Promise.resolve([]) };
};
