import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { findAudioGaps, moveAudioGap, recordGap, type GapContext } from '../src/publishing/pds-audio-gaps.ts';
import type { RepoRpc } from '../src/publishing/repo-rpc.ts';

const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const collection = 'fm.plyr.track';
const pds = 'https://pds.example';
const media = `https://plyr-next-audio.n8-3e9.workers.dev/media/${'b'.repeat(64)}/3d2adcd3-6eb7-4f67-94ab-cb54e2c7c1a7`;

function rawCid(bytes: Uint8Array) {
  const all = [0x01, 0x55, 0x12, 0x20, ...createHash('sha256').update(bytes).digest()];
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let out = 'b', buffer = 0, bits = 0;
  for (const byte of all) {
    buffer = (buffer << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; out += alphabet[(buffer >> bits) & 31]; buffer &= (1 << bits) - 1; }
  }
  if (bits) out += alphabet[(buffer << (5 - bits)) & 31];
  return out;
}

const original = new Uint8Array([7, 7, 7, 7]);
const lostBytes = new Uint8Array([9, 8, 7]);
const lostCid = rawCid(lostBytes);
const presentCid = rawCid(new Uint8Array([1]));
const blob = (cid: string, mimeType = 'audio/mpeg', size = 3) => ({ $type: 'blob', ref: { $link: cid }, mimeType, size });

/** `served`: the blobs the PDS serves; an upload joins it unless the PDS is set to drop it */
function repo(records: Record<string, Record<string, unknown>>, served?: string[]) {
  const cids = new Map(Object.keys(records).map(rkey => [rkey, `bafyrei${rkey}0`]));
  const writes: { record: Record<string, unknown>; swapRecord?: string }[] = [];
  const uploads: { bytes: Uint8Array; type: string }[] = [];
  const uri = (rkey: string) => `at://${did}/${collection}/${rkey}`;
  const rpc = {
    async get(method: string, { params }: { params: { rkey?: string } }) {
      if (method === 'com.atproto.repo.listRecords') return { ok: true, data: { records: Object.entries(records).map(([rkey, value]) => ({ uri: uri(rkey), cid: cids.get(rkey), value })) } };
      return { ok: true, data: { uri: uri(params.rkey!), cid: cids.get(params.rkey!), value: records[params.rkey!] } };
    },
    async post(method: string, { input, headers }: { input: any; headers?: { 'content-type': string } }) {
      if (method === 'com.atproto.repo.uploadBlob') {
        const bytes = new Uint8Array(input as ArrayBuffer);
        uploads.push({ bytes, type: headers!['content-type'] });
        served?.push(rawCid(bytes));
        return { ok: true, data: { blob: blob(rawCid(bytes), headers!['content-type'], bytes.byteLength) } };
      }
      if (input.swapRecord !== cids.get(input.rkey)) return { ok: false, status: 400, data: { error: 'InvalidSwap' } };
      writes.push({ record: input.record, swapRecord: input.swapRecord });
      records[input.rkey] = input.record;
      cids.set(input.rkey, `bafyrei${input.rkey}${writes.length}`);
      return { ok: true, data: { uri: uri(input.rkey), cid: cids.get(input.rkey) } };
    }
  } as unknown as RepoRpc;
  return { rpc, writes, uploads, cids, records };
}

function network({ onPds = [presentCid], mirror = {} as Record<string, Uint8Array> } = {}) {
  const calls: string[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.startsWith(`${pds}/xrpc/com.atproto.sync.getBlob`)) {
      const cid = new URL(url).searchParams.get('cid')!;
      if (onPds.includes(cid)) return new Response(init?.method === 'HEAD' ? null : 'x', { status: 200 });
      return init?.method === 'HEAD' ? new Response(null, { status: 400 }) : Response.json({ error: 'InvalidRequest', message: 'Blob not found' }, { status: 400 });
    }
    if (url === `${media}/manifest`) return Response.json({ processed: true, original: { url: `${media}/original`, contentType: 'audio/aiff', sizeBytes: original.byteLength } });
    if (url === `${media}/original`) return new Response(original, { headers: { 'content-length': String(original.byteLength) } });
    if (url === 'https://audio.plyr.fm/audio/big.wav') return new Response(null, { headers: { 'content-length': String(200 * 1024 * 1024), 'content-type': 'audio/wav' } });
    const mirrored = Object.entries(mirror).find(([key]) => url.endsWith(`/audio/${key}`));
    if (mirrored) return new Response(mirrored[1]);
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { calls, fetcher };
}

const ctx = (rpc: RepoRpc, fetcher: typeof fetch): GapContext => ({ rpc, did, collection, pds, fetcher });

test('a record is checked for what its PDS should hold', () => {
  assert.deepEqual(recordGap({ audioUrl: media, fileType: 'mp3' }), { kind: 'only-plyr' });
  assert.deepEqual(recordGap({ audioUrl: 'https://audio.plyr.fm/audio/x.mp3' }), { kind: 'only-plyr' });
  assert.deepEqual(recordGap({ audioUrl: media, audioBlob: blob(lostCid) }), { kind: 'probe', blobCid: lostCid });
  // gated, closed or protected audio never becomes a public blob
  assert.equal(recordGap({ audioSpace: 'at://x', audioUrl: media }), undefined);
  assert.equal(recordGap({ audioUrl: media, downloadPolicy: 'off' }), undefined);
  assert.equal(recordGap({ audioUrl: media, supportGate: {} }), undefined);
  // somebody else's host is not plyr.fm's copy to move
  assert.equal(recordGap({ audioUrl: 'https://elsewhere.example/a.mp3' }), undefined);
});

test('gaps are found on the PDS: plyr-only tracks, lost blobs, and big files that must stay', async () => {
  const { rpc } = repo({
    a: { title: 'bog bender', audioUrl: media, fileType: 'mp3' },
    b: { title: 'kept', audioUrl: media, audioBlob: blob(presentCid) },
    c: { title: 'lost', audioUrl: 'https://audio.plyr.fm/audio/c.mp3', audioBlob: blob(lostCid) },
    d: { title: 'huge', audioUrl: 'https://audio.plyr.fm/audio/big.wav', fileType: 'wav' }
  });
  const gaps = await findAudioGaps(ctx(rpc, network().fetcher));
  assert.deepEqual(gaps.map(gap => [gap.rkey, gap.kind, gap.tooBig, gap.sizeBytes]), [
    ['a', 'only-plyr', false, 4], ['c', 'lost', false, 3], ['d', 'only-plyr', true, 200 * 1024 * 1024]
  ]);
});

test('moving a plyr-only track adds the original as audioBlob and keeps every other field', async () => {
  const fixture = repo({ a: { title: 'bog bender', audioUrl: media, fileType: 'mp3', futureField: { kept: true } } });
  const { fetcher } = network();
  const [gap] = await findAudioGaps(ctx(fixture.rpc, fetcher));
  const progress: number[] = [];
  assert.equal(await moveAudioGap(ctx(fixture.rpc, fetcher), gap, { onProgress: value => progress.push(value) }), 'moved');
  assert.deepEqual(fixture.uploads.map(upload => [...upload.bytes]), [[...original]]);
  assert.equal(fixture.uploads[0].type, 'audio/aiff');
  assert.equal(fixture.writes[0].swapRecord, 'bafyreia0');
  assert.deepEqual(fixture.writes[0].record, { title: 'bog bender', audioUrl: media, fileType: 'mp3', futureField: { kept: true }, audioBlob: blob(rawCid(original), 'audio/aiff', 4) });
  assert.equal(progress.at(-1), 1);
  // done is done: running it again changes nothing
  assert.equal(await moveAudioGap(ctx(fixture.rpc, fetcher), gap), 'already');
  assert.equal(fixture.writes.length, 1);
});

test('an edit made elsewhere mid-move is kept, and the blob lands on the newest version', async () => {
  const fixture = repo({ a: { title: 'old title', audioUrl: media } });
  const { fetcher } = network();
  const [gap] = await findAudioGaps(ctx(fixture.rpc, fetcher));
  const racing = (async (url: string, init?: RequestInit) => {
    if (url === `${media}/original`) { fixture.records.a = { title: 'new title', audioUrl: media }; fixture.cids.set('a', 'bafyreiedited'); }
    return fetcher(url, init);
  }) as typeof fetch;
  assert.equal(await moveAudioGap(ctx(fixture.rpc, racing), gap), 'moved');
  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.writes[0].swapRecord, 'bafyreiedited');
  assert.equal(fixture.writes[0].record.title, 'new title');
});

test('a lost blob is restored only from a copy with the same hash, without touching the record', async () => {
  const onPds = [presentCid];
  const fixture = repo({ c: { title: 'lost', audioUrl: 'https://audio.plyr.fm/audio/c.mp3', audioBlob: blob(lostCid) } }, onPds);
  const { fetcher, calls } = network({ onPds, mirror: { [lostCid]: lostBytes } });
  const [gap] = await findAudioGaps(ctx(fixture.rpc, fetcher));
  assert.equal(await moveAudioGap(ctx(fixture.rpc, fetcher), gap), 'moved');
  assert.deepEqual(fixture.uploads.map(upload => [...upload.bytes]), [[...lostBytes]]);
  assert.equal(fixture.writes.length, 0);
  assert.ok(calls.some(call => call.endsWith(`/audio/${lostCid}`)));

  const other = repo({ c: { title: 'lost', audioUrl: 'https://audio.plyr.fm/audio/c.mp3', audioBlob: blob(lostCid) } });
  const wrong = network({ mirror: { [lostCid]: new Uint8Array([0]) } });
  assert.equal(await moveAudioGap(ctx(other.rpc, wrong.fetcher), gap), 'no-copy');
  assert.equal(other.uploads.length, 0);

  // an upload the PDS doesn't go on serving isn't reported as moved
  const dropping = repo({ c: { title: 'lost', audioUrl: 'https://audio.plyr.fm/audio/c.mp3', audioBlob: blob(lostCid) } });
  const keepsNothing = network({ mirror: { [lostCid]: lostBytes } });
  await assert.rejects(moveAudioGap(ctx(dropping.rpc, keepsNothing.fetcher), gap), /didn't keep/);
});

test("a prod-era bucket URL is written as the audio.plyr.fm address prod trusts, so prod keeps the track as it was", async () => {
  const old = 'https://pub-d4ed8a1e39d44dac85263d86ad5676fd.r2.dev/audio/old.mp3';
  const fixture = repo({ f: { title: 'old', audioUrl: old, fileType: 'mp3' } });
  const base = network();
  const fetcher = (async (url: string, init?: RequestInit) => url === 'https://audio.plyr.fm/audio/old.mp3'
    ? new Response(init?.method === 'HEAD' ? null : original, { headers: { 'content-length': String(original.byteLength), 'content-type': 'audio/mpeg' } })
    : base.fetcher(url, init)) as typeof fetch;
  const [gap] = await findAudioGaps(ctx(fixture.rpc, fetcher));
  assert.equal(await moveAudioGap(ctx(fixture.rpc, fetcher), gap), 'moved');
  const { record } = fixture.writes[0];
  assert.equal(record.audioUrl, 'https://audio.plyr.fm/audio/old.mp3');
  assert.equal(record.fileType, 'mp3');
  assert.ok(record.audioBlob);
});

test('a file over 100 MB stays with plyr.fm instead of failing', async () => {
  const fixture = repo({ d: { title: 'huge', audioUrl: 'https://audio.plyr.fm/audio/big.wav' } });
  const { fetcher, calls } = network();
  const [gap] = await findAudioGaps(ctx(fixture.rpc, fetcher));
  assert.equal(await moveAudioGap(ctx(fixture.rpc, fetcher), gap), 'too-big');
  assert.equal(fixture.uploads.length, 0);
  assert.ok(!calls.includes('GET https://audio.plyr.fm/audio/big.wav'));
});

test('the store asks once per account, "not now" lasts until the tracks change, and a move reports each track', async () => {
  const { createPdsAudioStore } = await import('../src/publishing/pds-audio-store.ts');
  const fixture = repo({ a: { title: 'bog bender', audioUrl: media }, d: { title: 'huge', audioUrl: 'https://audio.plyr.fm/audio/big.wav' } });
  const { fetcher } = network();
  const saved = new Map<string, string>();
  let account = { did: did as `did:${string}:${string}`, rpc: fixture.rpc, ready: true };
  const authListeners = new Set<() => void>();
  const make = () => createPdsAudioStore({ getAuth: () => account, subscribeAuth: listener => authListeners.add(listener), collection, fetcher,
    pdsEndpoint: async () => pds, storage: { read: key => saved.get(key) ?? null, write: (key, value) => { saved.set(key, value); } } });
  let store = make();
  await store.check();
  assert.equal(store.snapshot.fixable.length, 1);
  assert.equal(store.snapshot.gaps.length, 2);
  assert.ok(store.snapshot.showSheet && store.snapshot.showCard);
  store.dismiss();
  assert.ok(!store.snapshot.showSheet && !store.snapshot.showCard);
  // a fresh session on the same device remembers both
  store = make();
  await store.check();
  assert.ok(!store.snapshot.showSheet && !store.snapshot.showCard);
  // a new gap brings the card back, but the sign-in ask was already used
  fixture.records.e = { title: 'new', audioUrl: media };
  fixture.cids.set('e', 'bafyreie0');
  store = make();
  await store.check();
  assert.ok(store.snapshot.showCard && !store.snapshot.showSheet);
  await store.moveAll();
  assert.deepEqual(Object.values(store.snapshot.rows).map(row => row.state).sort(), ['moved', 'moved', 'too-big']);
  assert.ok(store.snapshot.finished && store.snapshot.showCard);
  store.close();
  assert.ok(!store.snapshot.showCard);
  // signing out clears it
  account = { did: null as any, rpc: null as any, ready: true };
  for (const listener of authListeners) listener();
  assert.equal(store.snapshot.gaps.length, 0);
});

test('switching accounts mid-move stops the old move and starts clean', async () => {
  const { createPdsAudioStore } = await import('../src/publishing/pds-audio-store.ts');
  const fixture = repo({ a: { title: 'one', audioUrl: media }, b: { title: 'two', audioUrl: media }, c: { title: 'three', audioUrl: media } });
  const { fetcher } = network();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let account = { did: did as `did:${string}:${string}`, rpc: fixture.rpc, ready: true };
  const authListeners = new Set<() => void>();
  const slow = (async (url: string, init?: RequestInit) => {
    if (url === `${media}/original`) await gate;
    return fetcher(url, init);
  }) as typeof fetch;
  const store = createPdsAudioStore({ getAuth: () => account, subscribeAuth: listener => authListeners.add(listener), collection, fetcher: slow,
    pdsEndpoint: async () => pds, storage: { read: () => null, write: () => {} } });
  await store.check();
  const moving = store.moveAll();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(store.snapshot.moving);
  account = { did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' as `did:${string}:${string}`, rpc: repo({}).rpc, ready: true };
  for (const listener of authListeners) listener();
  assert.ok(!store.snapshot.moving && !store.snapshot.showCard);
  release();
  await moving;
  assert.equal(fixture.writes.length, 0);
  assert.deepEqual(store.snapshot.rows, {});
  await store.check();
  assert.equal(store.snapshot.gaps.length, 0);
});
