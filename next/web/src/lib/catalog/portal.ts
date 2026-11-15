import { catalogRevision } from '@plyr/next-core/catalog/changes';
import { createCatalogPages } from '@plyr/next-core/catalog/pages';
import { api } from '$lib/api';
import { auth } from '$lib/auth';

function createPortal(did: string) {
  return {
    active: 'tracks' as 'tracks' | 'albums',
    scroll: { tracks: 0, albums: 0 },
    tracks: createCatalogPages(cursor => api.tracks({ artist_did: did, limit: 25, cursor }), () => catalogRevision(did, 'tracks')),
    albums: createCatalogPages(cursor => api.albums(did, { limit: 25, cursor }), () => catalogRevision(did, 'albums'))
  };
}

let current: { rpc: NonNullable<ReturnType<typeof auth.getAuth>['rpc']>; portal: ReturnType<typeof createPortal> } | undefined;

auth.subscribe(() => {
  if (current && auth.getAuth().rpc !== current.rpc) current = undefined;
});

export function portalFor(did: string, rpc: NonNullable<ReturnType<typeof auth.getAuth>['rpc']>) {
  if (current?.rpc === rpc) return current.portal;
  const portal = createPortal(did);
  if (auth.getAuth().rpc === rpc) current = { rpc, portal };
  return portal;
}
