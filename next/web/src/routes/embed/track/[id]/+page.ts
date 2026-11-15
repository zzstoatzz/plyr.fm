import { trackEmbed } from '$lib/embed/catalog';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, url, fetch }) => ({
  track: await trackEmbed(params.id, fetch),
  autoplay: url.searchParams.get('autoplay') === '1'
});
