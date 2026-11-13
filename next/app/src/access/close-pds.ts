import { ClientResponseError, ok } from '@atcute/client';
import { TID } from '@atproto/common-web';
import type { Auth } from '../auth-state';
import { getAuth } from '../auth-state';
import { NSID } from '../auth-config';
import { closedRecords, managedPolicy, reopenedRecord, requireManagedSpace, spaceFor } from './close';
import { spaceParts } from './policy';

type Nsid = `${string}.${string}.${string}`;
type Value = Record<string, unknown>;
class SpaceRequestError extends Error {
  readonly code: string;
  constructor(code: string) { super('could not change who can listen. try again.'); this.code = code; }
}
const object = (value: unknown): value is Value => !!value && typeof value === 'object' && !Array.isArray(value);

/** close public tracks into one space, or open closed ones again, on the signed-in artist's PDS */
export function trackAccess(auth: Auth) {
  function session() {
    const { did, agent, rpc } = auth;
    if (!did || !agent || !rpc) throw new Error('sign in to change who can listen.');
    if (getAuth().did !== did || getAuth().rpc !== rpc) throw new Error('account changed. return to the original account.');
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
    const result = await ok(rpc.get('com.atproto.repo.getRecord', { params: { repo: did, collection: NSID.track as Nsid, rkey } }));
    if (!result.cid || !object(result.value)) throw new Error('could not read your track.');
    return { cid: result.cid, value: result.value };
  }
  async function writePublic(rkey: string, record: Value, swap: string) {
    const { did, rpc } = session();
    await ok(rpc.post('com.atproto.repo.putRecord', { input: { repo: did, collection: NSID.track as Nsid, rkey, record, swapRecord: swap } }))
      .catch((error: unknown) => {
        if (error instanceof ClientResponseError && error.error === 'InvalidSwap') throw new Error('this track changed elsewhere. reload and try again.');
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
