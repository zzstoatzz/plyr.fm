import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ListDetail, Track } from '../../../core/src/api';
import { useAuth } from '../auth';
import { createPds } from '../pds';
import { applyCollectionRevision } from '../../../core/src/collections/projected-collection';
import type { CollectionRevision } from '../../../core/src/collections/collection-order';

export function useCollectionOrder(indexed: ListDetail | undefined) {
  const { did, rpc } = useAuth();
  const ordering = useMemo(() => did && rpc ? createPds({ did, rpc }).collectionOrder(indexed?.object ?? 'playlist') : undefined, [did, rpc, indexed?.object]);
  const [pending, setPending] = useState<{ revision: CollectionRevision; baseline?: string; tracks: Track[]; rpc: typeof rpc }>();
  const revision = pending?.rpc === rpc && pending.revision.uri === indexed?.record.uri ? pending.revision : undefined;
  useEffect(() => {
    if (!revision || !indexed) return;
    let current = true;
    const clear = () => { if (current) setPending(value => value === pending ? undefined : value); };
    if (indexed.record.cid === revision.cid) clear();
    else if (indexed.record.cid !== pending?.baseline && ordering && did === indexed.owner.did) {
      void ordering.read(indexed.record.uri).then(latest => {
        if (latest.cid === indexed.record.cid) clear();
      }).catch(() => undefined);
    }
    return () => { current = false; };
  }, [indexed, pending, revision, ordering, did]);
  const saved = useCallback((revision: CollectionRevision, tracks: Track[] = []) => {
    setPending({ revision, baseline: indexed?.record.cid, tracks, rpc });
  }, [indexed?.record.cid, rpc]);
  const list = indexed && revision ? applyCollectionRevision(indexed, revision, pending?.tracks) : indexed;
  return { list, saved };
}
