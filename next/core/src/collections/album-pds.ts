import { publicTrackReference } from '../publishing/track-reference';
import { repoOk as ok, getRecord, type RepoRpc } from '../publishing/repo-rpc';
import type { MediaFile } from '../publishing/private-music';
import type { Track, AwaitStatus } from '../api';
import type { CollectionItem, CollectionRevision } from './collection-order';
import type { collectionOrdering } from './collection-order-pds';
import { albumName, albumMembership, type AlbumEntry } from './album-membership';

export function albumPublishing({ rpc, did, trackCollection, assertSession, ordering, publish, uploadCover }: {
  rpc: RepoRpc;
  did: `did:${string}:${string}`;
  trackCollection: `${string}.${string}.${string}`;
  assertSession: () => void;
  ordering: ReturnType<typeof collectionOrdering>;
  uploadCover: (file: MediaFile) => Promise<{ imageBlob: unknown }>;
  publish: (name: string, items: CollectionItem[], cover?: { imageBlob: unknown }) => Promise<{ uri: string; status: AwaitStatus }>;
}) {
  async function verify(tracks: Track[]) {
    const items = new Map<Track, CollectionItem>();
    for (const track of tracks) {
      publicTrackReference(track);
      assertSession();
      const prefix = `at://${did}/${trackCollection}/`;
      const rkey = track.record.uri.startsWith(prefix) ? track.record.uri.slice(prefix.length) : '';
      if (track.artist.did !== did || !track.record.cid || !/^(?!\.{1,2}$)[a-zA-Z0-9._~:-]{1,512}$/.test(rkey)) throw new Error('choose one of your published tracks.');
      const result = await ok(getRecord(rpc, { params: { repo: did, collection: trackCollection, rkey } }));
      assertSession();
      if (result.uri !== track.record.uri || result.cid !== track.record.cid) throw new Error('a selected track changed. remove it, reload your tracks, and add it again.');
      items.set(track, { subject: { uri: result.uri, cid: result.cid } });
    }
    return items;
  }
  async function prepareCover(artwork?: MediaFile) {
    if (!artwork) return;
    try { return await uploadCover(artwork); }
    catch {
      assertSession();
      throw new Error('could not upload the cover. try saving again.');
    }
  }

  async function create(name: string, tracks: Track[], artwork?: MediaFile) {
    const title = albumName(name);
    if (!tracks.length || tracks.length > 500 || new Set(tracks.map(track => track.record.uri)).size !== tracks.length) throw new Error('choose between 1 and 500 of your tracks.');
    const cover = await prepareCover(artwork);
    const items = await verify(tracks);
    assertSession();
    return publish(title, [...items.values()], cover);
  }
  async function save(revision: CollectionRevision, entries: AlbumEntry[], name?: string, artwork?: MediaFile) {
    if (revision.value.listType !== 'album') throw new Error('not an album.');
    const cover = await prepareCover(artwork);
    const additions = await verify(entries.filter((entry): entry is Track => typeof entry !== 'number'));
    const items = albumMembership(revision, entries, additions);
    return ordering.write(revision, items, name, cover);
  }
  return { ...ordering, create, save };
}
