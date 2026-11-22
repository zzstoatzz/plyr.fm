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

test('a like shows at once, and taps during the write move the target instead of waiting', async () => {
  const receipt = deferred<'pending'>();
  const writes: string[] = [];
  const account = { did: 'did:plc:me', rpc: {} };
  const model = createTrackLikes({ getAuth: () => account, createPds: () => ({
    myLikes: async () => new Map<string, LikeRef>(),
    like: async () => { writes.push('like'); return receipt.promise; },
    unlike: async () => { writes.push('unlike'); return 'absent' as const; }
  }) });
  await model.load(track);
  const first = model.toggle(track);
  assert.equal(model.snapshot(track).liked, true);
  assert.equal(model.snapshot({ ...track }).count, 6);
  assert.equal(model.snapshot(track).busy, true);
  await model.toggle(track);
  assert.equal(model.snapshot(track).liked, false);
  assert.equal(model.snapshot(track).count, 5);
  await model.toggle(track);
  await model.toggle(track);
  assert.equal(model.snapshot(track).liked, false);
  assert.deepEqual(writes, ['like']);
  receipt.resolve('pending');
  await first;
  assert.deepEqual(writes, ['like', 'unlike']);
  assert.deepEqual(model.snapshot(track), { liked: false, count: 5, known: true, loading: false, busy: false, error: '' });
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

test('a failed write puts back the saved like and count, and a retry works', async () => {
  let fail = true;
  const session = {};
  const model = createTrackLikes({ getAuth: () => ({ did: 'did:plc:me', rpc: session }), createPds: () => ({
    myLikes: async () => new Map<string, LikeRef>(), like: async () => { if (fail) throw new Error('offline'); return 'pending' as const; }, unlike: async () => 'absent' as const
  }) });
  await model.load(track);
  const writing = model.toggle(track);
  assert.equal(model.snapshot(track).count, 6);
  await writing;
  assert.equal(model.snapshot(track).liked, false);
  assert.equal(model.snapshot(track).count, 5);
  assert.equal(model.snapshot(track).error, 'offline');
  fail = false;
  await model.toggle(track);
  assert.equal(model.snapshot(track).liked, true);
  assert.equal(model.snapshot(track).count, 6);
  assert.equal(model.snapshot(track).error, '');
});

test('a failed unlike on a stale zero count comes back to the same count', async () => {
  const account = { did: 'did:plc:me', rpc: {} };
  const model = createTrackLikes({ getAuth: () => account, createPds: () => ({
    myLikes: async () => new Map([[track.record.uri, {} as LikeRef]]), like: async () => 'pending' as const,
    unlike: async () => { throw new Error('offline'); }
  }) });
  const stale = { ...track, metrics: { ...track.metrics, like_count: 0 } };
  await model.load(stale);
  await model.toggle(stale);
  assert.equal(model.snapshot(stale).liked, true);
  assert.equal(model.snapshot(stale).count, 0);
});

test('a later write in a chain failing keeps what the earlier one saved', async () => {
  const receipt = deferred<'pending'>();
  const account = { did: 'did:plc:me', rpc: {} };
  const model = createTrackLikes({ getAuth: () => account, createPds: () => ({
    myLikes: async () => new Map<string, LikeRef>(), like: () => receipt.promise,
    unlike: async () => { throw new Error('offline'); }
  }) });
  await model.load(track);
  const first = model.toggle(track);
  await model.toggle(track);
  receipt.resolve('pending');
  await first;
  assert.equal(model.snapshot(track).liked, true);
  assert.equal(model.snapshot(track).count, 6);
  assert.equal(model.snapshot(track).error, 'offline');
});
