import { api } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	const tags = url.searchParams.getAll('tag');
	return {
		tags,
		latest: api.tracks({ limit: 24, tag: tags }),
		chart: api.chart('month', 10).then(value => value.data, () => []),
		featured: api.chart('all_time', 24).then(value => value.data.map(item => item.track), () => [])
	};
};
