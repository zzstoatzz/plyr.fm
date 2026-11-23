import { useEffect, useSyncExternalStore } from 'react';
import { catalogRevision } from '@plyr/next-core/catalog/changes';
import { createOwnPlaylists } from '@plyr/next-core/collections/own-playlists';
import { api } from '../api-client';
import { getAuth, subscribeAuth } from '../auth-state';

/** One for the session, so "add to playlist" opens on your playlists instead of loading them each time. */
export const ownPlaylists = createOwnPlaylists({
  fetch: (did, cursor) => api.playlists({ owner_did: did, limit: 30, cursor }),
  revision: did => catalogRevision(did, 'collections')
});
let signedIn = getAuth().did;
subscribeAuth(() => {
  if (signedIn !== getAuth().did) { signedIn = getAuth().did; ownPlaylists.forget(); }
});

/** The account's playlists, checked again on open only when they changed elsewhere or have gone stale. */
export function useOwnPlaylists(did: string | null | undefined) {
  useEffect(() => { if (did) ownPlaylists.open(did); }, [did]);
  return useSyncExternalStore(ownPlaylists.subscribe, () => ownPlaylists.snapshot(did), () => ownPlaylists.snapshot(did));
}
