import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthConfig } from '../src/auth-config.ts';
import { createPrivateLibrary, type PrivateCreate } from '../src/publishing/private-music.ts';

const library = createPrivateLibrary(createAuthConfig());
const owner = 'did:plc:fixture', space = library.privateSpace(owner);
const audioCid = 'bafkreiaudioaudioaudioaudioaudioaudioaudioaudio', imageCid = 'bafkreiimageimageimageimageimageimageimageimage';
const policy = { $type: 'com.atproto.memberspace.policy', publicRead: false, publicWrite: false, publishPolicy: false, publishMembers: false };
const file = (type: string, size: number) => ({ name: type.startsWith('audio') ? 'song.mp3' : 'cover.jpg', type, size, arrayBuffer: async () => new ArrayBuffer(size) });

function fixture() {
  const records = new Map<string, unknown>(), blobs: string[] = [];
  const agent = { async handle(path: string, init: { method: string; body?: unknown; headers?: Record<string, string> }) {
    const method = path.slice('/xrpc/'.length).split('?')[0], params = new URLSearchParams(path.split('?')[1] ?? '');
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (method === 'com.atproto.space.createSpace') return json({ error: 'SpaceAlreadyExists' }, 400);
    if (method === 'com.atproto.space.getSpace') return json({ space, policy });
    if (method === 'com.atproto.repo.uploadBlob') {
      const type = init.headers?.['content-type'] ?? '';
      blobs.push(type);
      return json({ blob: { $type: 'blob', ref: { $link: type.startsWith('image/') ? imageCid : audioCid }, mimeType: type, size: 1 } });
    }
    if (method === 'com.atproto.space.createRecord') {
      const body = JSON.parse(String(init.body));
      records.set(body.rkey, body.record);
      return json({ uri: `${space}/${owner}/fm.plyr.track/${body.rkey}`, cid: 'bafyrecord' });
    }
    if (method === 'com.atproto.space.getRecord') {
      const value = records.get(params.get('rkey') ?? '');
      return value ? json({ uri: `${space}/${owner}/fm.plyr.track/${params.get('rkey')}`, cid: 'bafyrecord', value }) : json({ error: 'RecordNotFound' }, 400);
    }
    if (method === 'com.atproto.space.listRecords') return json({ records: [...records].map(([rkey, value]) => ({ collection: 'fm.plyr.track', rkey, cid: 'bafyrecord', value })) });
    return json({ error: 'UnknownMethod' }, 404);
  } };
  const auth = { did: owner, rpc: 'https://pds.fixture', agent, privatePublishing: true, privateDeleting: true } as never;
  const stored: PrivateCreate[] = [];
  const storage = {
    load: async () => stored, put: async (operation: PrivateCreate) => { stored.push(operation); },
    archive: async () => {}, delete: async (operation: PrivateCreate) => { stored.splice(stored.indexOf(operation), 1); },
  };
  return { records, blobs, auth, storage };
}

test('a private upload keeps its cover as a blob in the private record, never as a public url', async () => {
  const { records, blobs, auth, storage } = fixture();
  const seen: unknown[] = [];
  const pds = library.privatePds(auth, () => auth, storage, () => '3jzfcijpj2z2a', async artwork => { seen.push(artwork); return 'blob:cover'; });
  const { result } = await pds.upload({ file: file('audio/mpeg', 10), artwork: file('image/jpeg', 5), title: 'song', artist: 'me', description: '', tags: [] }, () => {});
  assert.equal(result.state, 'accepted');
  assert.deepEqual(blobs, ['audio/mpeg', 'image/jpeg']);
  const record = records.get('3jzfcijpj2z2a') as Record<string, unknown>;
  assert.deepEqual((record.imageBlob as { ref: unknown }).ref, { $link: imageCid });
  assert.equal('imageUrl' in record, false);
  const { tracks } = await pds.list();
  assert.equal(tracks[0].media.artwork?.url, 'blob:cover');
  assert.deepEqual(seen[0], { space, repo: owner, cid: imageCid, mimeType: 'image/jpeg' });
  assert.equal((await pds.track('3jzfcijpj2z2a'))?.media.artwork?.url, 'blob:cover');
});

test('a cover that cannot be read leaves the private track listed without art', async () => {
  const { auth, storage } = fixture();
  const pds = library.privatePds(auth, () => auth, storage, () => '3jzfcijpj2z2a', async () => { throw new Error('offline'); });
  await pds.upload({ file: file('audio/mpeg', 10), artwork: file('image/png', 5), title: 'song', artist: 'me', description: '', tags: [] }, () => {});
  const { tracks } = await pds.list();
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].media.artwork, undefined);
});

test('a private upload without a cover writes no image, and an unsupported cover is refused before any upload', async () => {
  const { records, blobs, auth, storage } = fixture();
  const pds = library.privatePds(auth, () => auth, storage, () => '3jzfcijpj2z2a');
  await assert.rejects(pds.upload({ file: file('audio/mpeg', 10), artwork: file('image/heic', 5), title: 'song', artist: 'me', description: '', tags: [] }, () => {}), /cover/);
  assert.deepEqual(blobs, []);
  await pds.upload({ file: file('audio/mpeg', 10), artwork: null, title: 'song', artist: 'me', description: '', tags: [] }, () => {});
  assert.equal('imageBlob' in (records.get('3jzfcijpj2z2a') as object), false);
});

test('a private create carrying a public image url is rejected', () => {
  const rkey = '3jzfcijpj2z2a';
  assert.throws(() => library.privateCreate({ owner, rkey, uri: `${space}/${owner}/fm.plyr.track/${rkey}`, record: { $type: 'fm.plyr.track', audioBlob: {}, imageUrl: 'https://x.invalid/a.jpg' } }, owner));
});

test('a private upload is labeled by its bytes, not its name', async () => {
  const { records, blobs, auth, storage } = fixture();
  const pds = library.privatePds(auth, () => auth, storage, () => '3jzfcijpj2z2a');
  const wav = new Uint8Array(64);
  wav.set(new TextEncoder().encode('RIFF'), 0);
  wav.set(new TextEncoder().encode('WAVE'), 8);
  const renamed = { name: 'merch shop.m4a', type: 'audio/mp4', size: wav.byteLength, arrayBuffer: async () => wav.buffer };
  await pds.upload({ file: renamed, artwork: null, title: 'song', artist: 'me', description: '', tags: [] }, () => {});
  assert.deepEqual(blobs, ['audio/wav']);
  assert.equal((records.get('3jzfcijpj2z2a') as Record<string, unknown>).fileType, 'wav');
});
