import { discoveryFilter } from '@plyr/next-core/hidden-tags';
import { api } from '$lib/api';
import { prefs } from '$lib/prefs.svelte';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url, depends }) => {
	depends('app:hidden-tags');
	const tags = url.searchParams.getAll('tag');
	const hidden = discoveryFilter(prefs.hiddenTags);
	return {
		tags,
		hidden,
		discovery: api.tags().then(result => result.data, () => []),
		latest: api.tracks({ limit: 24, tag: tags, hidden_tag: hidden }),
		chart: tags.length ? Promise.resolve(null) : api.chart('month', 10).then(value => value.data, () => null),
		featured: tags.length ? Promise.resolve([]) : api.chart('all_time', 24, undefined, { excludeAiArtists: true }).then(value => value.data.map(item => item.track), () => [])
	};
};
