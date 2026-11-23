import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnPlaylists } from '../src/collections/own-playlists.ts';
import type { ListSummary, Track } from '../src/api.ts';

const did = 'did:plc:me';
const list = (n: number, count = 2) => ({ object: 'playlist', id: `p${n}`, record: { uri: `at://${did}/fm.plyr.list/${n}`, cid: 'c', collection: 'fm.plyr.list', rkey: `${n}` },
  metadata: { name: `list ${n}` }, media: null, metrics: { member_count: count, available_count: count, total_plays: 0 } }) as unknown as ListSummary;
const track = { id: 't1', record: { uri: 'at://did:plc:a/fm.plyr.track/1' }, media: { artwork: { url: 'https://img/1.jpg' } } } as unknown as Track;
const tick = () => new Promise(done => setTimeout(done, 5));

function setup() {
  let revision = 0, clock = 0, calls = 0, fail = false;
  const store = createOwnPlaylists({
    fetch: async (_did, cursor) => { calls++; if (fail) throw new Error('down'); return cursor ? { object: 'list', data: [list(3)], has_more: false } : { object: 'list', data: [list(1), list(2)], has_more: true, next_cursor: 'n' }; },
    revision: () => revision, now: () => clock
  });
  return { store, calls: () => calls, bump: () => { revision++; }, advance: (ms: number) => { clock += ms; }, failing: (value: boolean) => { fail = value; } };
}

test('the picker loads once and opens on its list after that', async () => {
  const { store, calls } = setup();
  assert.equal(store.snapshot(did).loading, true);
  store.open(did);
  await tick();
  store.open(did); store.open(did);
  await tick();
  assert.equal(calls(), 1);
  assert.deepEqual(store.snapshot(did).data.map(item => item.id), ['p1', 'p2']);
  assert.equal(store.snapshot(did).cursor, 'n');
});

test('adds and creates show at once and do not make the next open ask again', async () => {
  const { store, calls, bump } = setup();
  store.open(did);
  await tick();
  bump();
  store.added(did, list(2).record.uri, track);
  bump();
  store.created(did, `at://${did}/fm.plyr.list/9`, 'new one', track);
  store.open(did);
  await tick();
  assert.equal(calls(), 1);
  const [made, first, second] = store.snapshot(did).data;
  assert.equal(made.metadata.name, 'new one');
  assert.equal(made.metrics.member_count, 1);
  assert.equal(made.media?.artwork?.url, 'https://img/1.jpg');
  assert.equal(first.metrics.member_count, 2);
  assert.equal(second.metrics.member_count, 3);
  assert.equal(second.media?.artwork?.url, 'https://img/1.jpg');
});

test('a change made elsewhere or ten minutes makes the next open check again, behind the list', async () => {
  const { store, calls, bump, advance, failing } = setup();
  store.open(did);
  await tick();
  bump();
  store.open(did);
  assert.equal(store.snapshot(did).loading, false, 'the list stays up while it checks');
  await tick();
  assert.equal(calls(), 2);
  advance(11 * 60_000);
  failing(true);
  store.open(did);
  await tick();
  assert.equal(calls(), 3);
  assert.equal(store.snapshot(did).error, undefined, 'a failed quiet check keeps the list');
  assert.equal(store.snapshot(did).data.length, 2);
});

test('more appends the next page', async () => {
  const { store } = setup();
  store.open(did);
  await tick();
  store.more(did);
  await tick();
  assert.deepEqual(store.snapshot(did).data.map(item => item.id), ['p1', 'p2', 'p3']);
  assert.equal(store.snapshot(did).cursor, undefined);
});

test('a failed first load shows the error and retry starts over; forget drops everything', async () => {
  const { store, calls, failing } = setup();
  failing(true);
  store.open(did);
  await tick();
  assert.equal(store.snapshot(did).error, 'down');
  failing(false);
  store.retry(did);
  await tick();
  assert.equal(calls(), 2);
  assert.equal(store.snapshot(did).data.length, 2);
  store.forget();
  assert.equal(store.snapshot(did).loading, true);
  assert.equal(store.snapshot(did).data.length, 0);
});

test('a playlist made here is not listed twice when a later page brings it back', async () => {
  let page = 0;
  const made = `at://${did}/fm.plyr.list/3`;
  const store = createOwnPlaylists({
    fetch: async (_did, cursor) => { page++; return cursor ? { object: 'list', data: [list(3)], has_more: false } : { object: 'list', data: [list(1)], has_more: true, next_cursor: 'n' }; },
    revision: () => 0
  });
  store.open(did);
  await tick();
  store.created(did, made, 'list 3', track);
  store.more(did);
  await tick();
  assert.equal(page, 2);
  assert.deepEqual(store.snapshot(did).data.map(item => item.record.uri).filter(uri => uri === made).length, 1);
});
