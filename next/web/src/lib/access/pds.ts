import { RepoResponseError, repoOk as ok, createRecord, getRecord, putRecord, type RepoRpc } from '@plyr/next-core/publishing/repo-rpc';
import { policyRecord, type Policy, type Rule } from '@plyr/next-core/access/policy';
import { TID } from '@atproto/common-web';
import type { Auth } from '@plyr/next-core/auth-state';
import { createClosing } from '@plyr/next-core/access/close';
import { spaceParts } from '@plyr/next-core/access/policy';
import { auth as authState } from '$lib/auth';
import { authConfig } from '$lib/auth-config';

const { NSID } = authConfig;
const { closedRecords, managedPolicy, reopenedRecord, requireManagedSpace, spaceFor } = createClosing(authConfig);

type Nsid = `${string}.${string}.${string}`;
type Value = Record<string, unknown>;
class SpaceRequestError extends Error {
  readonly code: string;
  constructor(code: string) { super('could not change who can listen. try again.'); this.code = code; }
}
const object = (value: unknown): value is Value => !!value && typeof value === 'object' && !Array.isArray(value);

/** close public tracks into one space, or open closed ones again, on the signed-in artist's PDS */
export function trackAccess(auth: Auth<RepoRpc>) {
  function session() {
    const { did, agent, rpc } = auth;
    if (!did || !agent || !rpc) throw new Error('sign in to change who can listen.');
    if (authState.getAuth().did !== did || authState.getAuth().rpc !== rpc) throw new Error('account changed. return to the original account.');
    if (!auth.closing) throw new Error('sign in again to allow closing your music.');
    return { did, agent, rpc };
  }
  async function space(method: string, params?: Record<string, string>, body?: object) {
    const { agent } = session();
    const response = await agent.handle(`/xrpc/${method}${params ? `?${new URLSearchParams(params)}` : ''}`, {
      method: body ? 'POST' : 'GET', ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const value: unknown = await response.json().catch(() => ({}));
    session();
    if (!response.ok) throw new SpaceRequestError(object(value) && typeof value.error === 'string' ? value.error : 'Unavailable');
    return value;
  }
  async function ensureSpace(uri: string) {
    const skey = spaceParts(uri)!.skey;
    try { await space('com.atproto.space.createSpace', undefined, { spaceType: spaceParts(uri)!.type, skey, policy: managedPolicy() }); }
    catch (error) { if (!(error instanceof SpaceRequestError) || error.code !== 'SpaceAlreadyExists') throw error; }
    requireManagedSpace(await space('com.atproto.space.getSpace', { space: uri }), uri);
  }
  async function readPublic(rkey: string) {
    const { did, rpc } = session();
    const result = await ok(getRecord(rpc, { params: { repo: did, collection: NSID.track as Nsid, rkey } }));
    if (!result.cid || !object(result.value)) throw new Error('could not read your track.');
    return { cid: result.cid, value: result.value };
  }
  async function writePublic(rkey: string, record: Value, swap: string) {
    const { did, rpc } = session();
    await ok(putRecord(rpc, { input: { repo: did, collection: NSID.track as Nsid, rkey, record, swapRecord: swap } }))
      .catch((error: unknown) => {
        if (error instanceof RepoResponseError && error.error === 'InvalidSwap') throw new Error('this track changed elsewhere. reload and try again.');
        throw error;
      });
  }
  function ownRkey(uri: string, did: string) {
    const prefix = `at://${did}/${NSID.track}/`;
    if (!uri.startsWith(prefix)) throw new Error('you can only change your own tracks.');
    return uri.slice(prefix.length);
  }

  /** move each track's audio into `skey`'s space (a new one when omitted); returns the space */
  async function close(trackUris: string[], skey = TID.nextStr()): Promise<string> {
    const { did } = session();
    const target = spaceFor(did, skey);
    await ensureSpace(target);
    for (const uri of trackUris) {
      const rkey = ownRkey(uri, did);
      const current = await readPublic(rkey);
      const records = closedRecords(current.value, target, did, rkey);
      try {
        await space('com.atproto.space.createRecord', undefined, { space: target, repo: did, collection: NSID.track, rkey, record: records.protected });
      } catch (error) { if (!(error instanceof SpaceRequestError) || error.code !== 'RecordAlreadyExists') throw error; }
      await writePublic(rkey, records.public, current.cid);
    }
    return target;
  }

  /** give each closed track its audio back on the public record */
  async function reopen(trackUris: string[]): Promise<void> {
    const { did } = session();
    for (const uri of trackUris) {
      const rkey = ownRkey(uri, did);
      const current = await readPublic(rkey);
      const location = typeof current.value.audioSpace === 'string' ? current.value.audioSpace : '';
      const match = /^(at:\/\/[^/]+\/space\/[^/]+\/[^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(location);
      if (!match || match[2] !== did || match[3] !== NSID.track) throw new Error('this track is not closed in your own space.');
      const copy = await space('com.atproto.space.getRecord', { space: match[1], repo: did, collection: NSID.track, rkey: match[4] });
      if (!object(copy) || !object(copy.value)) throw new Error('could not find the audio for this track.');
      await writePublic(rkey, reopenedRecord(current.value, copy.value), current.cid);
      await space('com.atproto.space.deleteRecord', undefined, { space: match[1], repo: did, collection: NSID.track, rkey: match[4] }).catch(() => undefined);
    }
  }
  return { close, reopen };
}

const collection = () => NSID.policy as `${string}.${string}.${string}`;

function policySession(auth: Auth<RepoRpc>) {
  if (!auth.did || !auth.rpc) throw new Error('sign in to change who can listen.');
  if (!auth.policyEditing) throw new Error('sign in again to allow changing who can listen.');
  return { did: auth.did, rpc: auth.rpc };
}

export async function addPolicy(auth: Auth<RepoRpc>, space: string, rule: Rule, title?: string): Promise<void> {
  const { did, rpc } = policySession(auth);
  if (!space.startsWith(`at://${did}/space/`)) throw new Error('you can only open your own music.');
  await ok(createRecord(rpc, { input: { repo: did, collection: collection(), record: policyRecord(NSID.policy, [space], rule, title) } }));
}

export async function removePolicy(auth: Auth<RepoRpc>, policy: Policy): Promise<void> {
  const { did, rpc } = policySession(auth);
  if (!policy.uri.startsWith(`at://${did}/`)) throw new Error('you can only change your own music.');
  await ok(rpc.post('com.atproto.repo.deleteRecord', { input: { repo: did, collection: collection(), rkey: policy.rkey, swapRecord: policy.cid } }));
}
