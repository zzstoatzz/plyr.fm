import { createKeyedCache } from '@plyr/next-core/keyed-cache';
import { api } from './api';

// Kept for the session so now playing shows a track's tags and buy link the moment it opens again.

/** Lists carry no tags; the track read does. */
export const trackTags = createKeyedCache(async id => (await api.track(id)).metadata.tags ?? []);

// An artist can change their buy links, so look again after a few minutes.
export const sellers = createKeyedCache(did => api.artist(did), { freshFor: 5 * 60_000 });

/** The album a track names, when exactly one of its artist's albums has that title. Keyed `did title`. */
export const albumUris = createKeyedCache(async key => {
  const [did, ...rest] = key.split(' ');
  const title = rest.join(' ');
  const { data } = await api.search(title, { limit: 20, types: 'album' });
  const matches = data.filter(hit => hit.type === 'album' && hit.owner?.did === did && hit.title === title);
  return matches.length === 1 ? matches[0].record.uri : undefined;
});
