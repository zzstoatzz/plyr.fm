import type { Track } from '../api.ts';
import type { AuthConfig } from '../auth-config.ts';
import type { Auth } from '../auth-state.ts';
import * as queue from '../queue-state.ts';
import { isPrivateTrack } from '../track-access.ts';
import { sameRecord } from './create-operation.ts';
import { normalizeTrackTags } from './track-tags.ts';
import { ARTWORK_TYPES, MAX_ARTWORK_BYTES } from './artwork-model.ts';

export interface MediaFile {
  name: string;
  uri?: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type PrivateCreate = { owner: string; rkey: string; uri: string; record: Record<string, unknown>; archived?: boolean };
export interface PrivateCreateStorage {
  load(owner: string): Promise<PrivateCreate[]>;
  put(operation: PrivateCreate): Promise<void>;
  archive(operation: PrivateCreate, archived: boolean): Promise<void>;
  delete(operation: PrivateCreate): Promise<void>;
}
export type PrivateDeletionResult = 'deleted' | 'present';
class PrivateRequestError extends Error {
  readonly code: string;
  constructor(code: string) { super('could not load all your tracks. try again.'); this.code = code; }
}
export type PrivateResult = { state: 'accepted' | 'different' | 'missing'; uri: string; cid?: string };
/** The cover blob of a private track, read back only through the owner's space credential. */
export type PrivateArtwork = { space: string; repo: string; cid: string; mimeType: string };
export type PrivateArtworkUrl = (artwork: PrivateArtwork) => Promise<string>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function editPrivateQueue(tracks: Track[], index: number, edit: { action: 'remove'; at: number } | { action: 'move'; from: number; to: number } | { action: 'clear' | 'shuffle' }): Track[] {
  const state = { entries: tracks.map((track, at) => ({ key: String(at), track })), index };
  const next = edit.action === 'remove' ? queue.removeEntry(state, edit.at)
    : edit.action === 'move' ? queue.moveEntry(state, edit.from, edit.to)
      : edit.action === 'clear' ? queue.clearPicks(state) : queue.shufflePicks(state);
  return next.entries.map(entry => entry.track);
}

export function withoutPrivateTrack(tracks: Track[], index: number, uri: string) {
  const currentRemoved = tracks[index]?.record.uri === uri;
  const before = tracks.slice(0, index).filter(track => track.record.uri === uri).length;
  const queue = tracks.filter(track => track.record.uri !== uri);
  return { queue, index: queue.length ? Math.min(Math.max(0, index - before), queue.length - 1) : -1, currentRemoved };
}

export function createPrivateLibrary({ NSID, PRIVATE_SPACE_TYPE }: Pick<AuthConfig, 'NSID' | 'PRIVATE_SPACE_TYPE'>) {
  function privateSpace(owner: string) { return `at://${owner}/space/${PRIVATE_SPACE_TYPE}/self`; }

  function privateTrack(owner: string, rkey: string, cid: string, value: unknown): Track {
    if (!/^did:(plc|web):[^/?#]+$/.test(owner) || !/^[a-zA-Z0-9._~:-]{1,512}$/.test(rkey) || rkey === '.' || rkey === '..' || !cid || !value || typeof value !== 'object'
      || !('$type' in value) || value.$type !== NSID.track || !('title' in value) || typeof value.title !== 'string'
      || !('artist' in value) || typeof value.artist !== 'string' || !('createdAt' in value) || typeof value.createdAt !== 'string') {
      throw new Error('could not read this track.');
    }
    const uri = `${privateSpace(owner)}/${owner}/${NSID.track}/${rkey}`;
    return {
      object: 'track', id: `${owner}|${rkey}`,
      record: { uri, cid, revision: cid, collection: NSID.track, rkey },
      metadata: { title: value.title, artist_name: value.artist, created_at: value.createdAt,
        album: 'album' in value && typeof value.album === 'string' ? value.album : null,
        description: 'description' in value && typeof value.description === 'string' ? value.description : null,
        duration_seconds: 'duration' in value && typeof value.duration === 'number' && Number.isFinite(value.duration) && value.duration >= 0 ? value.duration : null },
      artist: { did: owner, profile: { handle: '', display_name: value.artist, avatar_url: null } },
      media: {}, access: { visibility: 'private' }, metrics: { play_count: 0, like_count: 0 },
    };
  }

  function privateArtwork(owner: string, value: unknown): PrivateArtwork | undefined {
    if (!object(value) || !object(value.imageBlob)) return;
    const blob = value.imageBlob, ref = object(blob.ref) ? blob.ref.$link : undefined;
    if (typeof ref !== 'string' || !/^b[a-z2-7]{20,}$/.test(ref) || typeof blob.mimeType !== 'string' || !blob.mimeType.startsWith('image/')) return;
    return { space: privateSpace(owner), repo: owner, cid: ref, mimeType: blob.mimeType };
  }

  function privateCreate(value: unknown, owner: string): PrivateCreate {
    if (!value || typeof value !== 'object' || !('owner' in value) || value.owner !== owner
      || !('rkey' in value) || typeof value.rkey !== 'string' || !/^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/.test(value.rkey)
      || !('uri' in value) || value.uri !== `${privateSpace(owner)}/${owner}/${NSID.track}/${value.rkey}`
      || !('record' in value) || !value.record || typeof value.record !== 'object' || Array.isArray(value.record)
      || !('$type' in value.record) || value.record.$type !== NSID.track
      || 'audioUrl' in value.record || 'audioSpace' in value.record || 'supportGate' in value.record || 'imageUrl' in value.record
      || !('audioBlob' in value.record) || !value.record.audioBlob || typeof value.record.audioBlob !== 'object'
      || ('archived' in value && typeof value.archived !== 'boolean')) throw new Error('could not read an earlier upload.');
    return { owner, rkey: value.rkey, uri: value.uri, record: value.record as Record<string, unknown>, ...('archived' in value ? { archived: value.archived as boolean } : {}) };
  }
  function samePrivateCreate(left: PrivateCreate, right: PrivateCreate) {
    return left.owner === right.owner && left.uri === right.uri && left.rkey === right.rkey && sameRecord(left.record, right.record);
  }
  function requirePrivatePolicy(value: unknown, owner: string): void {
    if (!value || typeof value !== 'object' || !('space' in value) || value.space !== privateSpace(owner)
      || !('policy' in value) || !value.policy || typeof value.policy !== 'object' || !('$type' in value.policy)
      || value.policy.$type !== 'com.atproto.memberspace.policy') throw new Error('this account can’t use the selected visibility setting.');
    const policy = value.policy;
    for (const key of ['publicRead', 'publicWrite', 'publishPolicy', 'publishMembers']) {
      if (key in policy && Reflect.get(policy, key) !== false) throw new Error('this account can’t save tracks with this visibility setting.');
    }
    if ('allowedApps' in policy) throw new Error('this account doesn’t allow plyr.fm to use this visibility setting.');
  }

  function privateDeletion({ owner, current, policy, allowed, pending, read, send }: {
    owner: string | null; current: () => string; policy: () => Promise<void>; allowed: boolean;
    pending: () => Promise<{ uri: string }[]>; read: (rkey: string) => Promise<unknown>; send: (rkey: string) => Promise<unknown>;
  }) {
    function owned(track: Track) {
      const did = current();
      if (did !== owner || !ownsPrivateTrack(track, did)) throw new Error('this track belongs to another account.');
      return track.record.rkey;
    }
    async function check(track: Track): Promise<PrivateDeletionResult> {
      const rkey = owned(track);
      await policy();
      const record = await read(rkey);
      current();
      if (record === undefined) return 'deleted';
      if (!record || typeof record !== 'object' || !('uri' in record) || record.uri !== track.record.uri
        || !('cid' in record) || typeof record.cid !== 'string') throw new Error('could not confirm deletion. check again.');
      return 'present';
    }
    return {
      check,
      async remove(track: Track): Promise<PrivateDeletionResult> {
        const rkey = owned(track);
        if (!allowed) throw new Error('sign in again to delete this track.');
        if ((await pending()).some(operation => operation.uri === track.record.uri)) throw new Error('finish this upload before deleting the track.');
        current();
        await policy();
        current();
        try { await send(rkey); } catch { current(); }
        try { return await check(track); }
        catch { current(); throw new Error('could not confirm deletion. check again before retrying.'); }
      },
    };
  }

  function privatePds(auth: Auth<unknown>, getAuth: () => Auth<unknown>, privateCreateStorage: PrivateCreateStorage, nextRecordKey: () => string, artworkUrl?: PrivateArtworkUrl) {
    const owner = auth.did;
    // a cover that can't be read leaves the track without art rather than hiding the track
    async function withArtwork(track: Track, value: unknown): Promise<Track> {
      const artwork = artworkUrl && privateArtwork(track.artist.did, value);
      if (!artwork) return track;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('cover timed out')), 5_000); });
      try { return { ...track, media: { ...track.media, artwork: { url: await Promise.race([artworkUrl(artwork), late]) } } }; }
      catch { return track; }
      finally { clearTimeout(timer); }
    }
    function current() {
      if (!owner || !auth.agent || getAuth().did !== owner || getAuth().rpc !== auth.rpc) throw new Error('account changed. return to the original account.');
      return owner;
    }
    async function request(method: string, params?: Record<string, string>, body?: object | ArrayBuffer, mimeType?: string) {
      current();
      const { agent } = auth;
      if (!agent) throw new Error('sign in to access this track.');
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await agent.handle(`/xrpc/${method}${params ? '?' + new URLSearchParams(params) : ''}`, {
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
        if (!object(value) || value.uri !== intent.uri || typeof value.cid !== 'string') throw new Error('could not check whether the track was saved.');
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
      if (!auth.privatePublishing) throw new Error('sign in again to upload with this setting.');
      const stored = (await privateCreateStorage.load(intent.owner)).find(item => item.rkey === intent.rkey);
      current();
      if (!stored || !sameRecord(stored.record, intent.record)) throw new Error('this upload has changed. reopen Upload and try again.');
      try {
        const result = await request('com.atproto.space.createRecord', undefined, {
          space: privateSpace(intent.owner), repo: intent.owner, collection: NSID.track, rkey: intent.rkey, record: intent.record,
        });
        if (!object(result) || result.uri !== intent.uri || typeof result.cid !== 'string') throw new Error('could not check whether the track was saved.');
        return { state: 'accepted', uri: intent.uri, cid: result.cid };
      } catch {
        current();
        const result = await check(intent).catch(() => undefined);
        if (result && result.state !== 'missing') return result;
        throw new Error('could not check whether the track was saved. check its status before trying again.');
      }
    }
    async function upload(input: { file: MediaFile; artwork?: MediaFile | null; title: string; artist: string; description: string; tags: string[]; duration?: number }, prepared: (operation: PrivateCreate) => void) {
      const did = current();
      if (!auth.privatePublishing) throw new Error('sign in again to upload with this setting.');
      if (!input.title.trim() || !input.artist.trim()) throw new Error('a track needs a title and artist.');
      for (const [value, limit] of [[input.title.trim(), 256], [input.artist.trim(), 256], [input.description.trim(), 5000]] as const) {
        if (new TextEncoder().encode(value).length > limit) throw new Error('that text is too long. try a shorter version.');
      }
      if (!/^audio\/[a-z0-9.+-]+$/i.test(input.file.type) || !Number.isSafeInteger(input.file.size) || input.file.size <= 0 || input.file.size > 104_857_600) throw new Error('choose audio up to 100 MiB.');
      const fileType = (input.file.name.includes('.') ? input.file.name.split('.').at(-1) : input.file.type.slice(6))?.toLowerCase();
      if (!fileType || new TextEncoder().encode(fileType).length > 16) throw new Error('choose a file with a supported audio extension.');
      const tags = normalizeTrackTags(input.tags);
      const artwork = input.artwork ?? undefined;
      if (artwork && (!(ARTWORK_TYPES as readonly string[]).includes(artwork.type) || !Number.isSafeInteger(artwork.size) || artwork.size <= 0 || artwork.size > MAX_ARTWORK_BYTES)) throw new Error('choose a PNG, JPEG, WebP, or GIF cover up to 10 MB.');
      if ((await privateCreateStorage.load(did)).some(item => !item.archived)) throw new Error('finish or set aside your earlier upload first.');
      await policy(true);
      const bytes = await input.file.arrayBuffer();
      current();
      if (bytes.byteLength !== input.file.size) throw new Error('the selected audio changed. choose it again.');
      const uploaded = await request('com.atproto.repo.uploadBlob', undefined, bytes, input.file.type);
      if (!object(uploaded) || !object(uploaded.blob)) throw new Error('could not confirm the audio upload.');
      let imageBlob: Record<string, unknown> | undefined;
      if (artwork) {
        const image = await artwork.arrayBuffer();
        current();
        if (image.byteLength !== artwork.size) throw new Error('the selected cover changed. choose it again.');
        const cover = await request('com.atproto.repo.uploadBlob', undefined, image, artwork.type);
        if (!object(cover) || !object(cover.blob)) throw new Error('could not confirm the cover upload.');
        imageBlob = cover.blob;
      }
      const rkey = nextRecordKey();
      const record = { $type: NSID.track, title: input.title.trim(), artist: input.artist.trim(), description: input.description.trim(), tags,
        fileType, audioBlob: uploaded.blob, ...(imageBlob ? { imageBlob } : {}),
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
        if (!object(result) || !Array.isArray(result.records) || (result.cursor !== undefined && typeof result.cursor !== 'string')) throw new Error('could not load all your tracks.');
        const tracks = await Promise.all(result.records.map((item: unknown) => {
          if (!object(item) || item.collection !== NSID.track || typeof item.rkey !== 'string' || typeof item.cid !== 'string') throw new Error('invalid private record.');
          return withArtwork(privateTrack(did, item.rkey, item.cid, item.value), item.value);
        }));
        return { tracks, cursor: result.cursor };
      } catch (error) {
        if (error instanceof PrivateRequestError && ['SpaceNotFound', 'RepoNotFound'].includes(error.code)) return { tracks: [], cursor: undefined };
        throw error;
      }
    }
    async function read(rkey: string) {
      const did = current();
      try {
        return await request('com.atproto.space.getRecord', { space: privateSpace(did), repo: did, collection: NSID.track, rkey });
      } catch (error) {
        if (error instanceof PrivateRequestError && ['RecordNotFound', 'SpaceNotFound', 'RepoNotFound'].includes(error.code)) return undefined;
        throw error;
      }
    }
    async function track(rkey: string): Promise<Track | undefined> {
      const did = current();
      const uri = `${privateSpace(did)}/${did}/${NSID.track}/${rkey}`;
      try {
        await policy();
        const record = await read(rkey);
        if (record === undefined) return;
        if (!object(record) || record.uri !== uri || typeof record.cid !== 'string') throw new Error('could not load this track.');
        return await withArtwork(privateTrack(did, rkey, record.cid, record.value), record.value);
      } catch (error) {
        if (error instanceof PrivateRequestError && ['SpaceNotFound', 'RepoNotFound'].includes(error.code)) return;
        throw error;
      }
    }
    const deletion = privateDeletion({ owner, current, policy, allowed: auth.privateDeleting,
      pending: () => privateCreateStorage.load(current()),
      read,
      send: rkey => request('com.atproto.space.deleteRecord', undefined, { space: privateSpace(current()), repo: current(), collection: NSID.track, rkey }),
    });
    return { upload, recover, list, track, deletion,
      pending: async () => privateCreateStorage.load(current()),
      archive: async (operation: PrivateCreate, archived: boolean) => { owned(operation); await privateCreateStorage.archive(operation, archived); },
      dismiss: async (operation: PrivateCreate, keepExisting = false) => {
        const result = await recover(operation);
        if (result.state !== 'accepted' && !(keepExisting && result.state === 'different')) throw new Error('check this attempt before dismissing it.');
        current(); await privateCreateStorage.delete(operation);
      },
    };
  }

  function ownsPrivateTrack(track: Track, did: string | null) {
    return !!did && track.artist.did === did && isPrivateTrack(track)
      && track.record.uri === `${privateSpace(did)}/${did}/${NSID.track}/${track.record.rkey}`;
  }

  return { privateSpace, privateTrack, privateArtwork, ownsPrivateTrack, privateCreate, samePrivateCreate, requirePrivatePolicy, privateDeletion, privatePds };
}
