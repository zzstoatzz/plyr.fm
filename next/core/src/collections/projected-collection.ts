import type { ListDetail, Track } from '../api.ts';
import type { CollectionRevision } from './collection-order.ts';

export function applyCollectionRevision(indexed: ListDetail, revision: CollectionRevision, additions: Track[] = []): ListDetail {
  if (revision.uri !== indexed.record.uri) return indexed;
  const tracks = new Map<string, Map<string, Track>>();
  for (const track of [...indexed.members.flatMap(member => member.track ? [member.track] : []), ...additions]) {
    const { uri, cid } = track.record;
    if (!cid) continue;
    const versions = tracks.get(uri) ?? new Map<string, Track>();
    versions.set(cid, track);
    tracks.set(uri, versions);
  }
  const members = revision.value.items.map(({ subject }, position): ListDetail['members'][number] => {
    const track = tracks.get(subject.uri)?.get(subject.cid) ?? null;
    return { position, subject, track, availability: track ? 'available' : 'unavailable' };
  });
  const available = members.flatMap(member => member.track ? [member.track] : []);
  return {
    ...indexed, members,
    metadata: { ...indexed.metadata, name: typeof revision.value.name === 'string' ? revision.value.name : indexed.metadata.name },
    metrics: { member_count: members.length, available_count: available.length, total_plays: available.reduce((sum, track) => sum + track.metrics.play_count, 0) }
  };
}
