import type { Did } from '../auth-state.ts';
import { audioOrigin, serviceMediaUrl } from '../downloads/manifest.ts';
import { rawCidDigest } from './audio-delivery.ts';
import { RepoResponseError, getRecord, listRecords, putRecord, repoOk, uploadRepoBlob, type RepoRpc } from './repo-rpc.ts';
import { MAX_AUDIO_BYTES, canReplaceTrackAudio } from './track-audio.ts';

/**
 * Tracks whose audio should be on the artist's PDS but isn't: either plyr.fm holds the only copy
 * (an upload from before originals went to the PDS, or a prod-era plyr.fm-storage track), or the
 * record names a blob the PDS no longer serves (a migration or host problem). Everything is read
 * from the artist's own PDS, which is the only authority on what it holds; the appview is not asked.
 */
export type AudioGapKind = 'only-plyr' | 'lost';

export interface AudioGap {
  uri: string;
  rkey: string;
  title: string;
  imageUrl?: string;
  kind: AudioGapKind;
  /** the blob a lost record names */
  blobCid?: string;
  /** bytes of the copy that would go to the PDS, when known */
  sizeBytes?: number;
  /** over the 100 MB a track can keep on a PDS, so plyr.fm keeps it */
  tooBig: boolean;
}

export type MoveResult = 'moved' | 'too-big' | 'no-copy' | 'already';

export interface GapContext {
  rpc: RepoRpc;
  did: Did;
  collection: `${string}.${string}.${string}`;
  /** the account's PDS origin, without a trailing slash */
  pds: string;
  fetcher?: typeof fetch;
}

/** where plyr.fm itself keeps public audio (same list as the appview's `held_audio_prefixes`) */
const prodBucket = 'https://pub-d4ed8a1e39d44dac85263d86ad5676fd.r2.dev/';
const heldPrefixes = ['https://audio.plyr.fm/', prodBucket, `${audioOrigin}/`];

export function heldAudioUrl(url: unknown): url is string {
  return typeof url === 'string' && heldPrefixes.some(prefix => url.startsWith(prefix));
}

function blobCid(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return;
  const ref = (value as { ref?: unknown }).ref;
  if (ref && typeof ref === 'object' && typeof (ref as { $link?: unknown }).$link === 'string') return (ref as { $link: string }).$link;
}

function blobMime(value: unknown): string | undefined {
  const mime = value && typeof value === 'object' ? (value as { mimeType?: unknown }).mimeType : undefined;
  return typeof mime === 'string' && mime.startsWith('audio/') ? mime : undefined;
}

/** What a record is missing on the PDS, before anything is fetched; undefined when nothing is. */
export function recordGap(value: Record<string, unknown>): { kind: 'only-plyr' } | { kind: 'probe'; blobCid: string } | undefined {
  // gated audio lives in a space, never as a public blob
  if (Object.hasOwn(value, 'audioSpace')) return;
  const cid = blobCid(value.audioBlob);
  if (cid) return { kind: 'probe', blobCid: cid };
  // only what the artist already shares openly may become a public blob
  if (heldAudioUrl(value.audioUrl) && canReplaceTrackAudio(value)) return { kind: 'only-plyr' };
}

const canonicalAudio = (url: string) => url.startsWith(prodBucket) ? 'https://audio.plyr.fm/' + url.slice(prodBucket.length) : url;

/** The copy plyr.fm would put on the PDS for a plyr-only track: the kept original for next uploads, else the file itself. */
async function plyrCopy(audioUrl: string, fetcher: typeof fetch, signal?: AbortSignal): Promise<{ url: string; contentType?: string; sizeBytes?: number }> {
  const media = serviceMediaUrl(audioUrl);
  if (media) {
    const response = await fetcher(`${media}/manifest`, { signal, credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error('the original is unavailable.');
    const manifest = await response.json() as { original?: { url?: unknown; contentType?: unknown; sizeBytes?: unknown } };
    const original = manifest.original;
    if (original?.url !== `${media}/original` || typeof original.contentType !== 'string' || typeof original.sizeBytes !== 'number')
      throw new Error('the original is unavailable.');
    return { url: original.url, contentType: original.contentType, sizeBytes: original.sizeBytes };
  }
  const url = canonicalAudio(audioUrl);
  const head = await fetcher(url, { method: 'HEAD', signal, credentials: 'omit' });
  if (!head.ok) throw new Error('the plyr.fm copy is unavailable.');
  const length = Number(head.headers.get('content-length'));
  return { url, contentType: head.headers.get('content-type') ?? undefined, sizeBytes: Number.isSafeInteger(length) && length > 0 ? length : undefined };
}

/** Whether the PDS serves the blob: true, false (it says it has no such blob), or undefined (couldn't tell). */
export async function pdsHasBlob(ctx: Pick<GapContext, 'pds' | 'did' | 'fetcher'>, cid: string, signal?: AbortSignal): Promise<boolean | undefined> {
  const fetcher = ctx.fetcher ?? fetch;
  const url = `${ctx.pds}/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did: ctx.did, cid })}`;
  try {
    const head = await fetcher(url, { method: 'HEAD', signal, credentials: 'omit', cache: 'no-store' });
    if (head.ok) return true;
    if (head.status !== 400 && head.status !== 404) return;
    // HEAD carries no body; the error body says whether it's really missing
    const response = await fetcher(url, { signal, credentials: 'omit', cache: 'no-store' });
    if (response.ok) { await response.body?.cancel(); return true; }
    const body = await response.json().catch(() => undefined) as { error?: unknown; message?: unknown } | undefined;
    const said = `${body?.error ?? ''} ${body?.message ?? ''}`.toLowerCase();
    return said.includes('blobnotfound') || said.includes('blob not found') ? false : undefined;
  } catch (failure) {
    if (signal?.aborted) throw failure;
    return;
  }
}

async function pool<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await run(items[next++]);
  }));
}

/** Every track on the account's PDS whose audio isn't there, oldest problems first. */
export async function findAudioGaps(ctx: GapContext, signal?: AbortSignal): Promise<AudioGap[]> {
  const fetcher = ctx.fetcher ?? fetch;
  const records: { uri: string; value: Record<string, unknown> }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await repoOk(listRecords(ctx.rpc, { params: { repo: ctx.did, collection: ctx.collection, limit: 100, cursor } }));
    records.push(...result.records);
    cursor = result.cursor;
    if (!cursor || !result.records.length) break;
  }
  const gaps: (AudioGap & { order: number })[] = [];
  const work = records.flatMap((record, order) => {
    const gap = recordGap(record.value);
    return gap ? [{ record, order, gap }] : [];
  });
  await pool(work, 6, async ({ record, order, gap }) => {
    const base = {
      uri: record.uri,
      rkey: record.uri.split('/').pop()!,
      title: typeof record.value.title === 'string' && record.value.title.trim() ? record.value.title : 'untitled',
      imageUrl: typeof record.value.imageUrl === 'string' ? record.value.imageUrl : undefined,
      order
    };
    if (gap.kind === 'probe') {
      if (await pdsHasBlob(ctx, gap.blobCid, signal) !== false) return;
      const size = (record.value.audioBlob as { size?: unknown }).size;
      gaps.push({ ...base, kind: 'lost', blobCid: gap.blobCid, sizeBytes: typeof size === 'number' ? size : undefined, tooBig: false });
      return;
    }
    try {
      const copy = await plyrCopy(record.value.audioUrl as string, fetcher, signal);
      gaps.push({ ...base, kind: 'only-plyr', sizeBytes: copy.sizeBytes, tooBig: (copy.sizeBytes ?? 0) > MAX_AUDIO_BYTES });
    } catch (failure) {
      if (signal?.aborted) throw failure;
      // no reachable copy: nothing this prompt could move
    }
  });
  return gaps.sort((a, b) => a.order - b.order).map(({ order: _, ...gap }) => gap);
}

async function readBytes(response: Response, onProgress?: (fraction: number) => void, expected?: number, cap = Infinity): Promise<ArrayBuffer> {
  const total = expected ?? (Number(response.headers.get('content-length')) || 0);
  if (total > cap) { await response.body?.cancel(); throw new TooBig(); }
  if (!response.body) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (received > cap) { await reader.cancel(); throw new TooBig(); }
    if (total) onProgress?.(Math.min(1, received / total));
  }
  const bytes = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return bytes.buffer;
}

class TooBig extends Error {}

async function sha256Hex(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Puts one track's audio on the account's PDS. A plyr-only track gets plyr.fm's copy as its
 * `audioBlob`, with every other field (its playable `audioUrl` included) left as it was. A lost blob
 * is uploaded again only from a copy that hashes to the record's CID, so the record never changes.
 * `onProgress` reports the download from 0 to 1; the PDS upload follows it.
 */
export async function moveAudioGap(ctx: GapContext, gap: AudioGap, { onProgress, assertSession, signal }: {
  onProgress?: (fraction: number) => void;
  /** throws when the signed-in account changed mid-move */
  assertSession?: () => void;
  signal?: AbortSignal;
} = {}): Promise<MoveResult> {
  const fetcher = ctx.fetcher ?? fetch;
  const check = () => { assertSession?.(); signal?.throwIfAborted(); };
  const read = async () => {
    const current = await repoOk(getRecord(ctx.rpc, { params: { repo: ctx.did, collection: ctx.collection, rkey: gap.rkey } }));
    if (current.uri !== gap.uri || !current.cid) throw new Error('could not read this track.');
    return { value: current.value, cid: current.cid };
  };
  check();
  let current = await read();
  const now = recordGap(current.value);

  if (gap.kind === 'lost') {
    if (now?.kind !== 'probe' || now.blobCid !== gap.blobCid) return 'already';
    if (await pdsHasBlob(ctx, now.blobCid, signal) === true) return 'already';
    const digest = rawCidDigest(now.blobCid);
    if (!digest) return 'no-copy';
    const audioUrl = current.value.audioUrl;
    const sources = [`${audioOrigin}/audio/${now.blobCid}`];
    if (heldAudioUrl(audioUrl)) {
      const media = serviceMediaUrl(audioUrl);
      sources.push(media ? `${media}/original` : canonicalAudio(audioUrl));
    }
    for (const source of sources) {
      check();
      let bytes: ArrayBuffer;
      try {
        const response = await fetcher(source, { signal, credentials: 'omit', cache: 'no-store' });
        if (!response.ok) { await response.body?.cancel(); continue; }
        bytes = await readBytes(response, onProgress);
      } catch (failure) {
        if (signal?.aborted) throw failure;
        continue;
      }
      if (await sha256Hex(bytes) !== digest) continue;
      check();
      const uploaded = await repoOk(uploadRepoBlob(ctx.rpc, { input: bytes, headers: { 'content-type': blobMime(current.value.audioBlob) ?? 'application/octet-stream' } }));
      if (blobCid(uploaded.blob) !== now.blobCid) throw new Error('your PDS stored a different file.');
      // an upload the record doesn't reference yet can be dropped by the PDS; only a served blob counts
      if (await pdsHasBlob(ctx, now.blobCid, signal) !== true) throw new Error("your PDS didn't keep the file.");
      return 'moved';
    }
    return 'no-copy';
  }

  if (now?.kind !== 'only-plyr') return 'already';
  const audioUrl = current.value.audioUrl as string;
  const copy = await plyrCopy(audioUrl, fetcher, signal);
  if ((copy.sizeBytes ?? 0) > MAX_AUDIO_BYTES) return 'too-big';
  check();
  const response = await fetcher(copy.url, { signal, credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error('the plyr.fm copy is unavailable.');
  let bytes: ArrayBuffer;
  try { bytes = await readBytes(response, onProgress, copy.sizeBytes, MAX_AUDIO_BYTES); }
  catch (failure) { if (failure instanceof TooBig) return 'too-big'; throw failure; }
  if (copy.sizeBytes && bytes.byteLength !== copy.sizeBytes) throw new Error('the download was cut short. try again.');
  const contentType = copy.contentType?.split(';')[0].trim() || response.headers.get('content-type') || 'audio/mpeg';
  check();
  let blob: unknown;
  try {
    blob = (await repoOk(uploadRepoBlob(ctx.rpc, { input: bytes, headers: { 'content-type': contentType } }))).blob;
  } catch (failure) {
    if (failure instanceof RepoResponseError && (failure.status === 413 || /too ?large/i.test(failure.error))) return 'too-big';
    throw failure;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    check();
    try {
      await repoOk(putRecord(ctx.rpc, { input: {
        repo: ctx.did, collection: ctx.collection, rkey: gap.rkey,
        // a prod-era bucket URL is rewritten to the same file's audio.plyr.fm address, the one origin prod
        // trusts: with the old one, prod's ingest would drop the URL and re-mirror the track
        record: { ...current.value, audioUrl: canonicalAudio(audioUrl), audioBlob: blob },
        swapRecord: current.cid
      } }));
      return 'moved';
    } catch (failure) {
      if (!(failure instanceof RepoResponseError && failure.error === 'InvalidSwap') || attempt > 0) throw failure;
      // edited elsewhere meanwhile: add the blob to the newest version, if it still needs one
      current = await read();
      if (recordGap(current.value)?.kind !== 'only-plyr' || current.value.audioUrl !== audioUrl) return 'already';
    }
  }
  return 'moved';
}
