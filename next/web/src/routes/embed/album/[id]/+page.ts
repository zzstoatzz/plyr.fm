import { catalogEmbed } from '$lib/embed/catalog';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => ({ catalog: await catalogEmbed('album', params.id, fetch) });
