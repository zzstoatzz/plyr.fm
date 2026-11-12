import { ok } from '@atcute/client';
import type { Auth } from '../auth-state';
import type { AwaitStatus } from '../api';
import { orderedCollection, collectionRecord, CollectionOrderConflict, CollectionOrderUnconfirmed, sameRecord, type CollectionRevision, type CollectionRecord, type CollectionItem } from './collection-order';

export function collectionOrdering({ rpc, did, collection, kind, assertSession, settle }: {
  rpc: NonNullable<Auth['rpc']>;
  did: `did:${string}:${string}`;
  collection: `${string}.${string}.${string}`;
  kind: CollectionRecord['listType'];
  assertSession: () => void;
  settle: (uri: string, cid: string) => Promise<AwaitStatus>;
}) {
  function rkey(uri: string) {
    const prefix = `at://${did}/${collection}/`;
    const key = uri.startsWith(prefix) ? uri.slice(prefix.length) : '';
    if (!/^(?!\.{1,2}$)[a-zA-Z0-9._~:-]{1,512}$/.test(key)) throw new Error(`not your ${kind}`);
    return key;
  }

  async function read(uri: string): Promise<CollectionRevision> {
    assertSession();
    const result = await ok(rpc.get('com.atproto.repo.getRecord', { params: { repo: did, collection, rkey: rkey(uri) } }));
    assertSession();
    if (result.uri !== uri || !result.cid) throw new Error(`could not verify this ${kind}.`);
    return { uri, cid: result.cid, value: collectionRecord(result.value, kind) };
  }

  async function save(revision: CollectionRevision, order: readonly number[]) {
    return write(revision, orderedCollection(revision.value, order).items);
  }

  async function write(revision: CollectionRevision, items: CollectionItem[]) {
    assertSession();
    const value = { ...collectionRecord({ ...revision.value, items }, kind), $type: collection, updatedAt: new Date().toISOString() };
    let saved: CollectionRevision;
    try {
      const result = await ok(rpc.post('com.atproto.repo.putRecord', { input: {
        repo: did, collection, rkey: rkey(revision.uri), swapRecord: revision.cid, record: value,
      } }));
      assertSession();
      if (result.uri !== revision.uri || !result.cid) throw new CollectionOrderUnconfirmed();
      saved = { uri: result.uri, cid: result.cid, value };
    } catch (error) {
      assertSession();
      let current: CollectionRevision;
      try { current = await read(revision.uri); }
      catch { assertSession(); throw new CollectionOrderUnconfirmed(); }
      if (sameRecord(current.value, value)) saved = current;
      else if (current.cid !== revision.cid) throw new CollectionOrderConflict();
      else throw error;
    }
    const status = await settle(saved.uri, saved.cid);
    assertSession();
    return { revision: saved, status };
  }

  return { read, save, write };
}
