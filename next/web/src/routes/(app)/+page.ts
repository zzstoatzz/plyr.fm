import { api } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	const tags = url.searchParams.getAll('tag');
	return {
		tags,
		discovery: api.tags().then(result => result.data, () => []),
		latest: api.tracks({ limit: 24, tag: tags }),
		chart: tags.length ? Promise.resolve(null) : api.chart('month', 10).then(value => value.data, () => null),
		featured: tags.length ? Promise.resolve([]) : api.chart('all_time', 24).then(value => value.data.map(item => item.track), () => [])
	};
};
