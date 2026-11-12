import { TID } from '@atproto/common-web';
import type { Auth } from '../auth-state';
import { getAuth } from '../auth-state';
import { NSID } from '../auth-config';
import type { MediaFile } from '../pds';
import { normalizeTrackTags } from './track-tags';
import { sameRecord } from './create-operation';
import { privateSpace, privateTrack, PRIVATE_SPACE_TYPE } from './private-track';
import { privateCreate, requirePrivatePolicy, type PrivateCreate } from './private-create';
import { privateCreateStorage } from './private-create-storage';

class PrivateRequestError extends Error {
  readonly code: string;
  constructor(code: string) { super('could not access your private music. try again.'); this.code = code; }
}
export type PrivateResult = { state: 'accepted' | 'different' | 'missing'; uri: string; cid?: string };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function privatePds(auth: Auth) {
  const owner = auth.did;
  function current() {
    if (!owner || !auth.agent || getAuth().did !== owner || getAuth().rpc !== auth.rpc) throw new Error('account changed. return to the original account.');
    return owner;
  }
  async function request(method: string, params?: Record<string, string>, body?: object | ArrayBuffer, mimeType?: string) {
    current();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await auth.agent!.handle(`/xrpc/${method}${params ? '?' + new URLSearchParams(params) : ''}`, {
        method: body ? 'POST' : 'GET', signal: controller.signal,
        ...(body ? { headers: { 'content-type': mimeType ?? 'application/json' }, body: body instanceof ArrayBuffer ? body : JSON.stringify(body) } : {}),
      });
      const value: unknown = await response.json();
      current();
      if (!response.ok) throw new PrivateRequestError(object(value) && typeof value.error === 'string' ? value.error : 'Unavailable');
      return value;
    } finally { clearTimeout(timer); }
  }
  async function policy(create = false) {
    const did = current(), space = privateSpace(did);
    if (create) {
      try { await request('com.atproto.space.createSpace', undefined, { spaceType: PRIVATE_SPACE_TYPE, skey: 'self', policy: {
        $type: 'com.atproto.memberspace.policy', publicRead: false, publicWrite: false, publishPolicy: false, publishMembers: false,
      } }); } catch (error) { if (!(error instanceof PrivateRequestError) || error.code !== 'SpaceAlreadyExists') throw error; }
    }
    requirePrivatePolicy(await request('com.atproto.space.getSpace', { space }), did);
  }
  function owned(operation: PrivateCreate) { return privateCreate(operation, current()); }
  async function check(operation: PrivateCreate): Promise<PrivateResult> {
    const intent = owned(operation);
    try {
      const value = await request('com.atproto.space.getRecord', { space: privateSpace(intent.owner), repo: intent.owner, collection: NSID.track, rkey: intent.rkey });
      if (!object(value) || value.uri !== intent.uri || typeof value.cid !== 'string') throw new Error('could not confirm the private track.');
      return { state: sameRecord(value.value, intent.record) ? 'accepted' : 'different', uri: intent.uri, cid: value.cid };
    } catch (error) {
      if (error instanceof PrivateRequestError && error.code === 'RecordNotFound') return { state: 'missing', uri: intent.uri };
      throw error;
    }
  }
  async function recover(operation: PrivateCreate, retry = false): Promise<PrivateResult> {
    const intent = owned(operation);
    await policy();
    const found = await check(intent);
    if (found.state !== 'missing' || !retry) return found;
    if (!auth.privatePublishing) throw new Error('sign in again to allow private uploads.');
    const stored = (await privateCreateStorage.load(intent.owner)).find(item => item.rkey === intent.rkey);
    current();
    if (!stored || !sameRecord(stored.record, intent.record)) throw new Error('this private attempt was dismissed or changed.');
    try {
      const result = await request('com.atproto.space.createRecord', undefined, {
        space: privateSpace(intent.owner), repo: intent.owner, collection: NSID.track, rkey: intent.rkey, record: intent.record,
      });
      if (!object(result) || result.uri !== intent.uri || typeof result.cid !== 'string') throw new Error('invalid private creation response.');
      return { state: 'accepted', uri: intent.uri, cid: result.cid };
    } catch {
      current();
      const result = await check(intent).catch(() => undefined);
      if (result && result.state !== 'missing') return result;
      throw new Error('could not confirm creation. check this private attempt before trying again.');
    }
  }
  async function upload(input: { file: MediaFile; title: string; artist: string; description: string; tags: string[]; duration?: number }, prepared: (operation: PrivateCreate) => void) {
    const did = current();
    if (!auth.privatePublishing) throw new Error('sign in again to allow private uploads.');
    if (!input.title.trim() || !input.artist.trim()) throw new Error('a track needs a title and artist.');
    for (const [value, limit] of [[input.title.trim(), 256], [input.artist.trim(), 256], [input.description.trim(), 5000]] as const) {
      if (new TextEncoder().encode(value).length > limit) throw new Error('that text is too long. try a shorter version.');
    }
    if (!/^audio\/[a-z0-9.+-]+$/i.test(input.file.type) || !Number.isSafeInteger(input.file.size) || input.file.size <= 0 || input.file.size > 104_857_600) throw new Error('choose audio up to 100 MiB.');
    const fileType = (input.file.name.includes('.') ? input.file.name.split('.').at(-1) : input.file.type.slice(6))?.toLowerCase();
    if (!fileType || new TextEncoder().encode(fileType).length > 16) throw new Error('choose a file with a supported audio extension.');
    const tags = normalizeTrackTags(input.tags);
    if ((await privateCreateStorage.load(did)).some(item => !item.archived)) throw new Error('finish or set aside your earlier private creation first.');
    await policy(true);
    const bytes = await input.file.arrayBuffer();
    current();
    if (bytes.byteLength !== input.file.size) throw new Error('the selected audio changed. choose it again.');
    const uploaded = await request('com.atproto.repo.uploadBlob', undefined, bytes, input.file.type);
    if (!object(uploaded) || !object(uploaded.blob)) throw new Error('could not confirm the audio upload.');
    const rkey = TID.nextStr();
    const record = { $type: NSID.track, title: input.title.trim(), artist: input.artist.trim(), description: input.description.trim(), tags,
      fileType, audioBlob: uploaded.blob,
      createdAt: new Date().toISOString(), ...(input.duration && Number.isFinite(input.duration) ? { duration: Math.round(input.duration) } : {}) };
    const operation = privateCreate({ owner: did, rkey, uri: `${privateSpace(did)}/${did}/${NSID.track}/${rkey}`, record }, did);
    await privateCreateStorage.put(operation);
    current();
    prepared(operation);
    return { operation, result: await recover(operation, true) };
  }
  async function list(cursor?: string) {
    const did = current();
    try {
      await policy();
      const result = await request('com.atproto.space.listRecords', { space: privateSpace(did), repo: did, collection: NSID.track, limit: '20', ...(cursor ? { cursor } : {}) });
      if (!object(result) || !Array.isArray(result.records) || (result.cursor !== undefined && typeof result.cursor !== 'string')) throw new Error('could not read your private music.');
      const tracks = result.records.map((item: unknown) => {
        if (!object(item) || item.collection !== NSID.track || typeof item.rkey !== 'string' || typeof item.cid !== 'string') throw new Error('invalid private record.');
        return privateTrack(did, item.rkey, item.cid, item.value);
      });
      return { tracks, cursor: result.cursor };
    } catch (error) {
      if (error instanceof PrivateRequestError && ['SpaceNotFound', 'RepoNotFound'].includes(error.code)) return { tracks: [], cursor: undefined };
      throw error;
    }
  }
  return { upload, recover, list,
    pending: async () => privateCreateStorage.load(current()),
    archive: async (operation: PrivateCreate, archived: boolean) => { owned(operation); await privateCreateStorage.archive(operation, archived); },
    dismiss: async (operation: PrivateCreate, keepExisting = false) => {
      const result = await recover(operation);
      if (result.state !== 'accepted' && !(keepExisting && result.state === 'different')) throw new Error('check this attempt before dismissing it.');
      current(); await privateCreateStorage.delete(operation);
    },
  };
}
