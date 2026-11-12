import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ListDetail } from '../api';
import { useAuth } from '../auth';
import { createPds } from '../pds';
import type { PlaylistRevision } from './playlist-order';

export function usePlaylistOrder(indexed: ListDetail | undefined) {
  const { did, rpc } = useAuth();
  const ordering = useMemo(() => did && rpc ? createPds({ did, rpc }).playlistOrder() : undefined, [did, rpc]);
  const [pending, setPending] = useState<{ revision: PlaylistRevision; baseline?: string; rpc: typeof rpc }>();
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
  const saved = useCallback((revision: PlaylistRevision) => {
    setPending({ revision, baseline: indexed?.record.cid, rpc });
  }, [indexed?.record.cid, rpc]);
  const list = indexed && revision ? { ...indexed, members: revision.value.items.map((item, position): ListDetail['members'][number] => {
    const track = indexed.members.find(member => member.subject.uri === item.subject.uri)?.track ?? null;
    return { position, subject: item.subject, track, availability: track ? 'available' : 'unavailable' };
  }), metrics: { ...indexed.metrics, member_count: revision.value.items.length } } : indexed;
  return { list, saved };
}
