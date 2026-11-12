import { ok } from '@atcute/client';
import type { Track, AwaitStatus } from '../api';
import type { Auth } from '../auth-state';
import type { CollectionItem, CollectionRevision } from './collection-order';
import type { collectionOrdering } from './collection-order-pds';
import { albumName, albumMembership, type AlbumEntry } from './album-membership';

export function albumPublishing({ rpc, did, trackCollection, assertSession, ordering, publish }: {
  rpc: NonNullable<Auth['rpc']>;
  did: `did:${string}:${string}`;
  trackCollection: `${string}.${string}.${string}`;
  assertSession: () => void;
  ordering: ReturnType<typeof collectionOrdering>;
  publish: (name: string, items: CollectionItem[]) => Promise<{ uri: string; status: AwaitStatus }>;
}) {
  async function verify(tracks: Track[]) {
    const items = new Map<Track, CollectionItem>();
    for (const track of tracks) {
      assertSession();
      const prefix = `at://${did}/${trackCollection}/`;
      const rkey = track.record.uri.startsWith(prefix) ? track.record.uri.slice(prefix.length) : '';
      if (track.artist.did !== did || !track.record.cid || !/^(?!\.{1,2}$)[a-zA-Z0-9._~:-]{1,512}$/.test(rkey)) throw new Error('choose one of your published tracks.');
      const result = await ok(rpc.get('com.atproto.repo.getRecord', { params: { repo: did, collection: trackCollection, rkey } }));
      assertSession();
      if (result.uri !== track.record.uri || result.cid !== track.record.cid) throw new Error('a selected track changed. remove it, reload your tracks, and add it again.');
      items.set(track, { subject: { uri: result.uri, cid: result.cid } });
    }
    return items;
  }
  async function create(name: string, tracks: Track[]) {
    const title = albumName(name);
    if (!tracks.length || tracks.length > 500 || new Set(tracks.map(track => track.record.uri)).size !== tracks.length) throw new Error('choose between 1 and 500 of your tracks.');
    const items = await verify(tracks);
    assertSession();
    return publish(title, [...items.values()]);
  }
  async function save(revision: CollectionRevision, entries: AlbumEntry[]) {
    if (revision.value.listType !== 'album') throw new Error('not an album.');
    const additions = await verify(entries.filter((entry): entry is Track => typeof entry !== 'number'));
    return ordering.write(revision, albumMembership(revision, entries, additions));
  }
  return { ...ordering, create, save };
}
