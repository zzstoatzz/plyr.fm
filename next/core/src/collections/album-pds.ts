import { publicTrackReference } from '../publishing/track-reference.ts';
import { repoOk as ok, getRecord, type RepoRpc } from '../publishing/repo-rpc.ts';
import type { CreateHandoff } from '../publishing/create-operation';
import type { MediaFile } from '../publishing/private-music';
import type { Track, AwaitStatus } from '../api';
import { CollectionOrderConflict, type CollectionItem, type CollectionRevision } from './collection-order.ts';
import type { collectionOrdering } from './collection-order-pds';
import { albumName, albumMembership, type AlbumEntry } from './album-membership.ts';

type AlbumHandoff = CreateHandoff & { reservedRkey: string };

export function albumPublishing({ rpc, did, trackCollection, assertSession, ordering, publish, uploadCover }: {
  rpc: RepoRpc;
  did: `did:${string}:${string}`;
  trackCollection: `${string}.${string}.${string}`;
  assertSession: () => void;
  ordering: ReturnType<typeof collectionOrdering>;
  uploadCover: (file: MediaFile) => Promise<{ imageBlob: unknown }>;
  publish: (name: string, items: CollectionItem[], cover?: { imageBlob: unknown }, draft?: AlbumHandoff) => Promise<{ uri: string; status: AwaitStatus }>;
}) {
  async function readTrack(uri: string) {
    assertSession();
    const prefix = `at://${did}/${trackCollection}/`;
    const rkey = uri.startsWith(prefix) ? uri.slice(prefix.length) : '';
    if (!/^(?!\.{1,2}$)[a-zA-Z0-9._~:-]{1,512}$/.test(rkey)) throw new Error('choose one of your published tracks.');
    const response = await getRecord(rpc, { params: { repo: did, collection: trackCollection, rkey } });
    assertSession();
    if (!response.ok && response.data.error === 'RecordNotFound') return null;
    const result = ok(response);
    if (result.uri !== uri || !result.cid) throw new Error('could not read your track revision.');
    return { uri: result.uri, cid: result.cid, value: result.value };
  }
  async function readUpload(uri: string) {
    const result = await readTrack(uri);
    if (!result) return null;
    const { value, cid } = result;
    if (value.$type !== trackCollection || (value.visibility !== undefined && value.visibility !== 'public' && value.visibility !== 'unlisted')
      || value.audioSpace || value.supportGate) {
      throw new Error('choose one of your published tracks.');
    }
    return { uri, cid };
  }
  async function verify(tracks: Track[]) {
    const items = new Map<Track, CollectionItem>();
    for (const track of tracks) {
      publicTrackReference(track);
      if (track.artist.did !== did) throw new Error('choose one of your published tracks.');
      const result = await readTrack(track.record.uri);
      if (!result || result.cid !== track.record.cid) throw new Error('a selected track changed. remove it, reload your tracks, and add it again.');
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

  function assertTrackCount(uris: readonly string[]) {
    if (!uris.length || uris.length > 500 || new Set(uris).size !== uris.length) throw new Error('choose between 1 and 500 of your tracks.');
  }
  async function create(name: string, tracks: Track[], artwork?: MediaFile) {
    const title = albumName(name);
    assertTrackCount(tracks.map(track => track.record.uri));
    const cover = await prepareCover(artwork);
    const items = await verify(tracks);
    assertSession();
    return publish(title, [...items.values()], cover);
  }
  async function createFromUploads(name: string, tracks: readonly { uri: string; cid: string }[], artwork: MediaFile | undefined, draft: AlbumHandoff) {
    const title = albumName(name);
    assertTrackCount(tracks.map(track => track.uri));
    const cover = await prepareCover(artwork);
    const items: CollectionItem[] = [];
    for (const track of tracks) {
      const subject = await readUpload(track.uri);
      if (!subject || subject.cid !== track.cid) throw new Error('a song changed. refresh the album before trying again.');
      items.push({ subject });
    }
    assertSession();
    return publish(title, items, cover, draft);
  }
  async function save(revision: CollectionRevision, entries: AlbumEntry[], name?: string, artwork?: MediaFile) {
    if (revision.value.listType !== 'album') throw new Error('not an album.');
    const cover = await prepareCover(artwork);
    const additions = await verify(entries.filter((entry): entry is Track => typeof entry !== 'number'));
    const items = albumMembership(revision, entries, additions);
    return ordering.write(revision, items, name, cover);
  }
  /** put a just-published track at the end of one of the artist's albums; a second call changes nothing */
  async function appendUpload(albumUri: string, trackUri: string) {
    for (let attempt = 0; ; attempt++) {
      const revision = await ordering.read(albumUri);
      if (revision.value.items.some(item => item.subject.uri === trackUri)) return;
      if (revision.value.items.length >= 500) throw new Error('albums hold at most 500 tracks.');
      const subject = await readUpload(trackUri);
      if (!subject) throw new Error('could not find the new track.');
      try { return await ordering.write(revision, [...revision.value.items, { subject }]); }
      catch (failure) { if (!(failure instanceof CollectionOrderConflict) || attempt) throw failure; }
    }
  }
  return { ...ordering, create, createFromUploads, readUpload, save, appendUpload };
}
