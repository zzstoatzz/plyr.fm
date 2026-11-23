import { catalogRevision } from '@plyr/next-core/catalog/changes';
import { createOwnPlaylists } from '@plyr/next-core/collections/own-playlists';
import { api } from '$lib/api';
import { auth } from '$lib/auth';

/** One for the session, so "add to playlist" opens on your playlists instead of loading them each time. */
export const ownPlaylists = createOwnPlaylists({
  fetch: (did, cursor) => api.playlists({ owner_did: did, limit: 30, cursor }),
  revision: did => catalogRevision(did, 'collections')
});
let signedIn = auth.getAuth().did;
auth.subscribe(() => {
  if (signedIn !== auth.getAuth().did) { signedIn = auth.getAuth().did; ownPlaylists.forget(); }
});
