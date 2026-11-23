import { api } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, url }) => ({
  track: await api.track(params.id),
  autoplay: url.searchParams.get('autoplay') === '1'
});
