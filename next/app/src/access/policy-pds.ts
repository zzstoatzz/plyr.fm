import { ok } from '@atcute/client';
import type { Auth } from '../auth-state';
import { resolveHandle } from '../auth-state';
import { NSID } from '../auth-config';
import { pdsEndpoint } from '../identity';
import { parsePolicy, policyRecord, type Policy, type Rule } from './policy';

const PAGES = 5;
const collection = () => NSID.policy as `${string}.${string}.${string}`;

/** every valid policy `author` wrote for `space`, read from their public repo */
export async function listPolicies(author: string, space: string, signal?: AbortSignal): Promise<Policy[]> {
  const pds = await pdsEndpoint(author);
  const found: Policy[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < PAGES; page++) {
    const params = new URLSearchParams({ repo: author, collection: NSID.policy, limit: '100', ...(cursor ? { cursor } : {}) });
    const response = await fetch(`${pds}/xrpc/com.atproto.repo.listRecords?${params}`, { signal });
    if (!response.ok) throw new Error('could not read who can listen.');
    const body: unknown = await response.json();
    const records = body && typeof body === 'object' && 'records' in body && Array.isArray(body.records) ? body.records : [];
    for (const item of records) {
      const policy = parsePolicy(item, author);
      if (policy?.spaces.includes(space)) found.push(policy);
    }
    cursor = body && typeof body === 'object' && 'cursor' in body && typeof body.cursor === 'string' && records.length ? body.cursor : undefined;
    if (!cursor) return found;
  }
  throw new Error('too many access records to read.');
}

function session(auth: Auth) {
  if (!auth.did || !auth.rpc) throw new Error('sign in to change who can listen.');
  if (!auth.policyEditing) throw new Error('sign in again to allow changing who can listen.');
  return { did: auth.did, rpc: auth.rpc };
}

export async function addPolicy(auth: Auth, space: string, rule: Rule, title?: string): Promise<void> {
  const { did, rpc } = session(auth);
  if (!space.startsWith(`at://${did}/space/`)) throw new Error('you can only open your own music.');
  await ok(rpc.post('com.atproto.repo.createRecord', { input: { repo: did, collection: collection(), record: policyRecord([space], rule, title) } }));
}

export async function removePolicy(auth: Auth, policy: Policy): Promise<void> {
  const { did, rpc } = session(auth);
  if (!policy.uri.startsWith(`at://${did}/`)) throw new Error('you can only change your own music.');
  await ok(rpc.post('com.atproto.repo.deleteRecord', { input: { repo: did, collection: collection(), rkey: policy.rkey, swapRecord: policy.cid } }));
}

/** a handle or DID typed by the artist, as a DID */
export async function memberDid(text: string): Promise<string> {
  const value = text.trim().replace(/^@/, '');
  if (/^did:(plc|web):[a-zA-Z0-9._:%-]+$/.test(value)) return value;
  const did = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value) ? await resolveHandle(value).catch(() => null) : null;
  if (typeof did !== 'string') throw new Error(`could not find ${value || 'that account'}.`);
  return did;
}
