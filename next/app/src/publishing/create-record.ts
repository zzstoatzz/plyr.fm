import { assertPublicCollection } from './track-reference.ts';
import { ok } from '@atcute/client';
import type { Auth } from '../auth-state';
import { sameRecord, type CreateOperation, type CreateStorage } from './create-operation.ts';

type Rpc = NonNullable<Auth['rpc']>;
type Nsid = `${string}.${string}.${string}`;
export type CreateResult = { state: 'accepted'; uri: string; cid: string } | { state: 'missing' | 'different'; uri: string };

export class CreateUnconfirmed extends Error {
  constructor() { super('could not confirm creation. check its status before trying again.'); }
}

export function recordCreator(rpc: Rpc, storage: CreateStorage, assertSession: () => void) {
  async function accepted(operation: CreateOperation, cid: string): Promise<CreateResult> {
    try { await storage.accept(operation, cid); } catch { /* The durable original intent can still reconcile this accepted record. */ }
    return { state: 'accepted', uri: operation.uri, cid };
  }

  async function check(operation: CreateOperation): Promise<CreateResult> {
    assertSession();
    if (operation.cid) return { state: 'accepted', uri: operation.uri, cid: operation.cid };
    const response = await rpc.get('com.atproto.repo.getRecord', {
      params: { repo: operation.owner, collection: operation.collection as Nsid, rkey: operation.rkey },
    });
    assertSession();
    if (!response.ok && response.data.error === 'RecordNotFound') return { state: 'missing', uri: operation.uri };
    const found = ok(response);
    if (found.uri !== operation.uri || !found.cid) throw new CreateUnconfirmed();
    if (!sameRecord(found.value, operation.record)) return { state: 'different', uri: operation.uri };
    return accepted(operation, found.cid);
  }

  async function send(operation: CreateOperation): Promise<CreateResult> {
    assertPublicCollection(operation.record);
    assertSession();
    try {
      const result = await ok(rpc.post('com.atproto.repo.createRecord', { input: {
        repo: operation.owner, collection: operation.collection as Nsid, rkey: operation.rkey, record: operation.record,
      } }));
      if (result.uri !== operation.uri || !result.cid) throw new CreateUnconfirmed();
      return accepted(operation, result.cid);
    } catch {
      const result = await check(operation).catch(() => { throw new CreateUnconfirmed(); });
      if (result.state !== 'missing') return result;
      throw new CreateUnconfirmed();
    }
  }

  return {
    check,
    async create(operation: CreateOperation) {
      await storage.put(operation);
      return send(operation);
    },
    async retry(operation: CreateOperation) {
      const result = await check(operation);
      return result.state === 'missing' ? send(operation) : result;
    },
  };
}
