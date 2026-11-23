import { catalogEmbed } from '$lib/embed/catalog';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => ({ catalog: await catalogEmbed('playlist', params.id) });
