import { resolveHandle } from '../auth-state.ts';
import { pdsEndpoint } from '../identity.ts';
import { parsePolicy, type Policy } from './policy.ts';

type Config = { policyCollection: string; audioSpaceType: string };
const PAGES = 5;

/** every valid policy `author` wrote for `space`, read from their public repo */
export async function listPolicies(config: Config, author: string, space: string, signal?: AbortSignal): Promise<Policy[]> {
  const pds = await pdsEndpoint(author);
  const found: Policy[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < PAGES; page++) {
    const params = new URLSearchParams({ repo: author, collection: config.policyCollection, limit: '100', ...(cursor ? { cursor } : {}) });
    const response = await fetch(`${pds}/xrpc/com.atproto.repo.listRecords?${params}`, { signal });
    if (!response.ok) throw new Error('could not read who can listen.');
    const body: unknown = await response.json();
    const records = body && typeof body === 'object' && 'records' in body && Array.isArray(body.records) ? body.records : [];
    for (const item of records) {
      const policy = parsePolicy(item, author, config);
      if (policy?.space === space) found.push(policy);
    }
    cursor = body && typeof body === 'object' && 'cursor' in body && typeof body.cursor === 'string' && records.length ? body.cursor : undefined;
    if (!cursor) return found;
  }
  throw new Error('too many access records to read.');
}

/** a handle or DID typed by the artist, as a DID */
export async function memberDid(text: string): Promise<string> {
  const value = text.trim().replace(/^@/, '');
  if (/^did:(plc|web):[a-zA-Z0-9._:%-]+$/.test(value)) return value;
  const did = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value) ? await resolveHandle(value).catch(() => null) : null;
  if (typeof did !== 'string') throw new Error(`could not find ${value || 'that account'}.`);
  return did;
}
