import { createKeyedCache } from '@plyr/next-core/keyed-cache';
import { api } from './api-client';

/** Lists carry no tags; the track read does. Kept for the session so now playing shows them the moment it opens again. */
export const trackTags = createKeyedCache(async id => (await api.track(id)).metadata.tags ?? [], { freshFor: 10 * 60_000 });

/** An artist's public profile, for buy and support links. An artist can change those, so look again after a few minutes. */
export const sellers = createKeyedCache(did => api.artist(did), { freshFor: 5 * 60_000 });
