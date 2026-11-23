import { loadAtlas as load } from '@plyr/next-core/atlas/load';
import { api } from '$lib/api';

export { atlasSummary } from '@plyr/next-core/atlas/load';

export const loadAtlas = () => load(api.atlas);
