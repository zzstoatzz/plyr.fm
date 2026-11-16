import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from '../src/api.ts';
import type { LikeRef } from '../src/pds.ts';
import { createTrackLikes } from '../src/track-likes.ts';

const track: Track = {
  object: 'track', id: 'track', record: { uri: 'at://did:plc:artist/fm.plyr.track/1', cid: 'bafytrack', revision: null, collection: 'fm.plyr.track', rkey: '1' },
  metadata: { title: 'sketch', description: null, album: null, duration_seconds: 120, created_at: '' },
  artist: { did: 'did:plc:artist', profile: { handle: 'artist.test', display_name: 'artist', avatar_url: null } },
  media: {}, access: { visibility: 'public' }, metrics: { play_count: 0, like_count: 5 }
};
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

test('row and player share a like transition and count; a held write cannot be repeated', async () => {
  const receipt = deferred<'pending'>();
  let writes = 0;
  const account = { did: 'did:plc:me', rpc: {} };
  const model = createTrackLikes({ getAuth: () => account, createPds: () => ({
    myLikes: async () => new Map<string, LikeRef>(),
    like: async () => { writes++; return receipt.promise; }, unlike: async () => 'absent' as const
  }) });
  await model.load(track);
  const first = model.toggle(track);
  await model.toggle(track);
  assert.equal(writes, 1);
  assert.equal(model.snapshot(track).busy, true);
  assert.equal(model.snapshot(track).count, 5);
  receipt.resolve('pending');
  await first;
  assert.equal(model.snapshot(track).liked, true);
  assert.equal(model.snapshot({ ...track }).count, 6);
  await model.toggle(track);
  assert.equal(model.snapshot(track).liked, false);
  assert.equal(model.snapshot(track).count, 5);
});

test('a late like receipt never changes a different account', async () => {
  const receipt = deferred<'pending'>();
  let account = { did: 'did:plc:first', rpc: {} };
  const model = createTrackLikes({ getAuth: () => account, createPds: () => ({
    myLikes: async () => new Map<string, LikeRef>(), like: () => receipt.promise, unlike: async () => 'absent' as const
  }) });
  await model.load(track);
  const writing = model.toggle(track);
  account = { did: 'did:plc:second', rpc: {} };
  model.reset();
  receipt.resolve('pending');
  await writing;
  assert.deepEqual(model.snapshot(track), { liked: false, count: 5, known: false, loading: false, busy: false, error: '' });
});

test('failed writes preserve the visible count and allow retry', async () => {
  let fail = true;
  const session = {};
  const model = createTrackLikes({ getAuth: () => ({ did: 'did:plc:me', rpc: session }), createPds: () => ({
    myLikes: async () => new Map<string, LikeRef>(), like: async () => { if (fail) throw new Error('offline'); return 'pending' as const; }, unlike: async () => 'absent' as const
  }) });
  await model.load(track);
  await model.toggle(track);
  assert.equal(model.snapshot(track).count, 5);
  assert.equal(model.snapshot(track).error, 'offline');
  fail = false;
  await model.toggle(track);
  assert.equal(model.snapshot(track).count, 6);
  assert.equal(model.snapshot(track).error, '');
});
