import assert from 'node:assert/strict';
import { test } from 'node:test';
import { albumPublishing } from '../src/collections/album-pds.ts';
import type { CollectionItem } from '../src/collections/collection-order.ts';
import { collectionOrdering } from '../src/collections/collection-order-pds.ts';
import { readAlbumUploadPlan } from '../src/publishing/album-upload-plan.ts';
import type { RepoRpc } from '../src/publishing/repo-rpc.ts';

const did = 'did:plc:fixture';
const trackCollection = 'fm.plyr.track';
const collection = 'fm.plyr.list';
const prefix = `at://${did}/${trackCollection}/`;
const missing = '3222222222229';

function fixture() {
  const reads: string[] = [];
  const published: { name: string; items: CollectionItem[]; draftId?: string }[] = [];
  let handoffs = 0;
  const rpc: RepoRpc = {
    async get(method, options) {
      assert.equal(method, 'com.atproto.repo.getRecord');
      assert.equal(options.params.repo, did);
      assert.equal(options.params.collection, trackCollection);
      assert.ok('rkey' in options.params);
      const { rkey } = options.params;
      reads.push(rkey);
      if (rkey === missing) return { ok: false, status: 400, data: { error: 'RecordNotFound' } };
      return { ok: true, data: { uri: prefix + rkey, cid: 'current-' + rkey,
        value: { $type: trackCollection, ...(rkey === 'private' ? { visibility: 'private' } : {}) } } };
    },
    async post() { throw new Error('album publishing must not rewrite a track'); }
  };
  const assertSession = () => {};
  const albums = albumPublishing({
    rpc, did, trackCollection, assertSession,
    ordering: collectionOrdering({ rpc, did, collection, kind: 'album', assertSession, settle: async () => 'indexed' }),
    async uploadCover() { return { imageBlob: 'cover' }; },
    async publish(name, items, _cover, draft) {
      published.push({ name, items, draftId: draft?.id });
      await draft?.handedOff();
      return { uri: `at://${did}/${collection}/3album`, status: 'pending' };
    },
  });
  const draft = { id: 'album-draft', async handedOff() { handoffs++; } };
  return { albums, draft, reads, published, handoffs: () => handoffs };
}

test('a bulk album publishes current PDS references in the selected order', async () => {
  const f = fixture();
  const keys = ['3222222222223', '3222222222222'];
  const tracks = keys.map(key => ({ uri: prefix + key, cid: 'current-' + key }));
  const result = await f.albums.createFromUploads('recordings', tracks, undefined, f.draft);
  assert.equal(result.status, 'pending');
  assert.deepEqual(f.reads, keys);
  assert.deepEqual(f.published, [{ name: 'recordings', items: tracks.map(subject => ({ subject })), draftId: f.draft.id }]);
  assert.equal(f.handoffs(), 1);
});

test('an album draft distinguishes a missing upload and rejects foreign, protected and changed tracks', async () => {
  const f = fixture();
  assert.equal(await f.albums.readUpload(prefix + missing), null);
  await assert.rejects(f.albums.readUpload(`at://did:plc:another/${trackCollection}/3222222222222`), /your published tracks/);
  await assert.rejects(f.albums.readUpload(`at://${did}/space/private/${trackCollection}/3222222222222`), /your published tracks/);
  await assert.rejects(f.albums.readUpload(prefix + 'private'), /your published tracks/);
  await assert.rejects(f.albums.createFromUploads('recordings', [{ uri: prefix + '3222222222222', cid: 'old' }], undefined, f.draft), /a song changed/);
  assert.deepEqual(f.published, []);
  assert.equal(f.handoffs(), 0);
});

test('an album plan preserves the selected order and stays with its original account', () => {
  const slots = ['3222222222223', '3222222222222'].map((reservedRkey, index) => ({
    reservedRkey, owner: did, id: `slot-${index}`, album: 'recordings', artist: 'fixture', title: `song ${index}`,
    audio: { name: `song-${index}.mp3`, type: 'audio/mpeg', size: 1024 },
  }));
  const plan = { id: 'album-draft', owner: did, name: 'recordings', coverName: 'scan.jpg', slots };
  const restored = readAlbumUploadPlan(plan, did);
  assert.deepEqual(restored.slots.map(slot => slot.reservedRkey), slots.map(slot => slot.reservedRkey));
  assert.equal(restored.coverName, plan.coverName);
  assert.throws(() => readAlbumUploadPlan(plan, 'did:plc:another'), /could not read/);
  assert.throws(() => readAlbumUploadPlan({ ...plan, slots: [slots[0], slots[0]] }, did), /could not read/);
  assert.throws(() => readAlbumUploadPlan({ ...plan, slots: [{ ...slots[0], reservedRkey: undefined }] }, did), /could not read/);
});
