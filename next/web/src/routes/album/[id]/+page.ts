import { api } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => ({ list: await api.album(params.id) });
