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

const page = (dids: string[], next?: string) => ({ data: dids.map(did => ({ record: { uri: `at://${did}/fm.plyr.like/1` }, actor: { did, profile: { handle: `${did.slice(8)}.test` } } })), has_more: !!next, next_cursor: next ?? null });

test('liking shows you in who liked it at once, before the appview lists the like, and unliking takes you out', async () => {
  const account = { did: 'did:plc:me', handle: 'me.test', rpc: {} };
  let listed: string[] = [];
  const model = createTrackLikes({ getAuth: () => account, createPds: () => ({
    myLikes: async () => new Map<string, LikeRef>(), like: async () => 'pending' as const, unlike: async () => 'absent' as const
  }), fetchLikers: async () => page(listed) as never, fetchViewer: async () => ({ handle: 'me.test', display_name: 'me', avatar_url: 'me.jpg' }) });
  await model.loadLikers(track);
  assert.deepEqual(model.likers(track).people, []);
  const liking = model.toggle(track);
  assert.deepEqual(model.likers(track).people.map(person => person.did), ['did:plc:me']);
  await liking;
  await new Promise(done => setTimeout(done));
  assert.equal(model.likers(track).people[0]?.profile?.display_name, 'me');
  listed = ['did:plc:other', 'did:plc:me'];
  assert.deepEqual(model.likers(track).people.map(person => person.did), ['did:plc:me'], 'a cached page still shows the like');
  await model.toggle(track);
  assert.deepEqual(model.likers(track).people, []);
});

test('an unlike hides you even while the appview still lists the old like', async () => {
  const account = { did: 'did:plc:me', rpc: {} };
  const model = createTrackLikes({ getAuth: () => account, createPds: () => ({
    myLikes: async () => new Map([[track.record.uri, {} as LikeRef]]), like: async () => 'pending' as const, unlike: async () => 'absent' as const
  }), fetchLikers: async () => page(['did:plc:me', 'did:plc:other']) as never });
  await model.loadLikers(track);
  await model.load(track);
  assert.deepEqual(model.likers(track).people.map(person => person.did), ['did:plc:me', 'did:plc:other']);
  await model.toggle(track);
  assert.deepEqual(model.likers(track).people.map(person => person.did), ['did:plc:other']);
  assert.equal(model.snapshot(track).count, 4);
});

test('who liked it is read again once it is stale, and pages append without repeats', async () => {
  let clock = 0;
  const calls: (string | undefined)[] = [];
  const model = createTrackLikes({ getAuth: () => ({ did: null, rpc: null }), createPds: () => { throw new Error('signed out'); },
    fetchLikers: async (_track, cursor) => { calls.push(cursor); return (cursor ? page(['did:plc:b', 'did:plc:c']) : page(['did:plc:a', 'did:plc:b'], 'next')) as never; },
    now: () => clock });
  await model.loadLikers(track);
  await model.loadLikers(track);
  assert.deepEqual(calls, [undefined]);
  assert.equal(model.likers(track).more, true);
  await model.loadLikers(track, { more: true });
  assert.deepEqual(model.likers(track).people.map(person => person.did), ['did:plc:a', 'did:plc:b', 'did:plc:c']);
  clock = 60_000;
  await model.loadLikers(track);
  assert.deepEqual(calls, [undefined, 'next', undefined]);
});

test('a newer appview count replaces the first one once your own change has had time to be counted', async () => {
  let clock = 0;
  const account = { did: 'did:plc:me', rpc: {} };
  const model = createTrackLikes({ getAuth: () => account, now: () => clock, createPds: () => ({
    myLikes: async () => new Map<string, LikeRef>(), like: async () => 'pending' as const, unlike: async () => 'absent' as const
  }) });
  const read = (like_count: number) => ({ ...track, metrics: { ...track.metrics, like_count } });
  assert.equal(model.snapshot(read(5)).count, 5);
  assert.equal(model.snapshot(read(7)).count, 7, 'someone else liked it');
  await model.load(track);
  await model.toggle(read(7));
  assert.equal(model.snapshot(read(7)).count, 8);
  clock = 5_000;
  assert.equal(model.snapshot(read(7)).count, 8, 'a read from before your like was indexed keeps your like');
  clock = 60_000;
  assert.equal(model.snapshot(read(8)).count, 8);
  assert.equal(model.snapshot(read(9)).count, 9);
});

test('a likers read during render never fetches your profile', async () => {
  let asked = 0;
  const account = { did: 'did:plc:me', handle: 'me.test', rpc: {} };
  const model = createTrackLikes({ getAuth: () => account, createPds: () => ({
    myLikes: async () => new Map([[track.record.uri, {} as LikeRef]]), like: async () => 'pending' as const, unlike: async () => 'absent' as const
  }), fetchViewer: async () => { asked++; return { handle: 'me.test' }; } });
  await model.load(track);
  assert.equal(model.likers(track).people[0]?.profile?.handle, 'me.test');
  assert.equal(asked, 0);
});
