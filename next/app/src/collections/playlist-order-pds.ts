import { ok } from '@atcute/client';
import type { Auth } from '../auth-state';
import type { AwaitStatus } from '../api';
import { orderedPlaylist, playlistRecord, PlaylistOrderConflict, PlaylistOrderUnconfirmed, sameRecord, type PlaylistRevision } from './playlist-order';

export function playlistOrdering({ rpc, did, collection, assertSession, settle }: {
  rpc: NonNullable<Auth['rpc']>;
  did: `did:${string}:${string}`;
  collection: `${string}.${string}.${string}`;
  assertSession: () => void;
  settle: (uri: string, cid: string) => Promise<AwaitStatus>;
}) {
  function rkey(uri: string) {
    const prefix = `at://${did}/${collection}/`;
    const key = uri.startsWith(prefix) ? uri.slice(prefix.length) : '';
    if (!/^(?!\.{1,2}$)[a-zA-Z0-9._~:-]{1,512}$/.test(key)) throw new Error('not your playlist');
    return key;
  }

  async function read(uri: string): Promise<PlaylistRevision> {
    assertSession();
    const result = await ok(rpc.get('com.atproto.repo.getRecord', { params: { repo: did, collection, rkey: rkey(uri) } }));
    assertSession();
    if (result.uri !== uri || !result.cid) throw new Error('could not verify this playlist.');
    return { uri, cid: result.cid, value: playlistRecord(result.value) };
  }

  async function save(revision: PlaylistRevision, order: readonly number[]) {
    assertSession();
    const value = { ...orderedPlaylist(revision.value, order), $type: collection, updatedAt: new Date().toISOString() };
    let saved: PlaylistRevision;
    try {
      const result = await ok(rpc.post('com.atproto.repo.putRecord', { input: {
        repo: did, collection, rkey: rkey(revision.uri), swapRecord: revision.cid, record: value,
      } }));
      assertSession();
      if (result.uri !== revision.uri || !result.cid) throw new PlaylistOrderUnconfirmed();
      saved = { uri: result.uri, cid: result.cid, value };
    } catch (error) {
      assertSession();
      let current: PlaylistRevision;
      try { current = await read(revision.uri); }
      catch { assertSession(); throw new PlaylistOrderUnconfirmed(); }
      if (sameRecord(current.value, value)) saved = current;
      else if (current.cid !== revision.cid) throw new PlaylistOrderConflict();
      else throw error;
    }
    const status = await settle(saved.uri, saved.cid);
    assertSession();
    return { revision: saved, status };
  }

  return { read, save };
}
