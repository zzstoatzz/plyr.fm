import { ApiError, type Artist, type ListSummary, type Track } from '@plyr/next-core/api';
import { loadAll, type OwnedFilter } from '@plyr/next-core/catalog/owned';
import { api } from '$lib/api';
import { auth } from '$lib/auth';
import { privateMusic } from '$lib/private-library';

type Account = ReturnType<typeof auth.getAuth>;

export interface Portal {
  profile?: Artist | null;
  tracks?: Track[];
  privateTracks: Track[];
  albums?: ListSummary[];
  tab: 'tracks' | 'albums';
  filter: OwnedFilter;
}

/** The whole catalog plus what you last searched, kept for the session so coming back is instant. */
let current: { rpc: Account['rpc']; portal: Portal } | undefined;

auth.subscribe(() => {
  if (current && auth.getAuth().rpc !== current.rpc) current = undefined;
});

export function portalFor(account: Account): Portal {
  if (current && current.rpc === account.rpc) return current.portal;
  const portal: Portal = { privateTracks: [], tab: 'tracks', filter: { query: '', sort: 'recent' } };
  current = { rpc: account.rpc, portal };
  return portal;
}

export const loadProfile = (did: string) => api.artist(did).catch(failure => {
  if (failure instanceof ApiError && failure.status === 404) return null;
  throw failure;
});

export const loadTracks = (did: string) => loadAll(cursor => api.tracks({ artist_did: did, limit: 100, cursor }));
export const loadAlbums = (did: string) => loadAll(cursor => api.albums(did, { limit: 100, cursor }));

/** Tracks that live only on your own PDS (private or space uploads), which the catalog can't list. */
export async function loadPrivateTracks(account: Account) {
  if (!account.privatePublishing && !account.privateDeleting) return [];
  const library = privateMusic(account);
  const tracks: Track[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 40; page++) {
    const result = await library.list(cursor);
    tracks.push(...result.tracks);
    cursor = result.cursor;
    if (!cursor) break;
  }
  return tracks;
}
