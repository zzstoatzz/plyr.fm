import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueueSuggestions, type PlayingContext } from '../src/queue-suggestion-store.ts';
import type { Track } from '../src/api.ts';

const track = (n: number, did = 'did:plc:a') => ({ id: `t${n}`, artist: { did }, record: { uri: `at://${did}/fm.plyr.track/${n}` } }) as unknown as Track;
const wait = (ms = 320) => new Promise(done => setTimeout(done, ms));

function fakeApi() {
  const calls = { suggestions: 0, tracks: 0, chart: 0, latest: 0, playlists: 0 };
  const api = {
    suggestions: async () => { calls.suggestions++; return { data: [track(100 + calls.suggestions)] }; },
    tracks: async (params: { artist_did?: string }) => {
      if (params.artist_did) { calls.tracks++; return { data: [track(1), track(2), track(3)] }; }
      calls.latest++; return { data: [track(50)] };
    },
    chart: async () => { calls.chart++; return { data: [{ track: track(60) }] }; },
    actorLikes: async () => ({ data: [] }),
    playlists: async () => { calls.playlists++; return { data: [] }; },
    playlist: async () => { throw new Error('none'); }
  };
  return { api: api as unknown as Parameters<typeof createQueueSuggestions>[0], calls };
}

const playing = (n: number, did = 'did:plc:a'): PlayingContext => ({ uri: track(n, did).record.uri, artistDid: did, artistName: 'a', queue: () => ({ queue: [track(n, did), track(9, did)], index: 0 }) });

test('reopening the queue on the same track asks for nothing and keeps the strips', async () => {
  const { api, calls } = fakeApi();
  const store = createQueueSuggestions(api);
  store.follow(playing(1));
  await wait();
  assert.equal(calls.suggestions, 1);
  assert.equal(calls.tracks, 1);
  const before = store.snapshot();
  for (let open = 0; open < 5; open++) store.follow(playing(1));
  await wait();
  assert.equal(calls.suggestions, 1);
  assert.equal(calls.tracks, 1);
  assert.equal(store.snapshot(), before, 'the same snapshot, so nothing re-renders');
  assert.deepEqual(before.more.map(item => item.id), ['t2', 't3'], 'queued tracks stay out of more from');
});

test('a new track refetches suggestions; the same artist keeps its strip', async () => {
  const { api, calls } = fakeApi();
  const store = createQueueSuggestions(api);
  store.follow(playing(1));
  await wait();
  store.follow(playing(2));
  await wait();
  assert.equal(calls.suggestions, 2);
  assert.equal(calls.tracks, 1);
  store.follow(playing(3, 'did:plc:b'));
  await wait();
  assert.equal(calls.tracks, 2);
});

test('skipping quickly asks once, and refresh asks again for the same track', async () => {
  const { api, calls } = fakeApi();
  const store = createQueueSuggestions(api);
  store.follow(playing(1)); store.follow(playing(2)); store.follow(playing(3));
  await wait();
  assert.equal(calls.suggestions, 1);
  store.refresh();
  await wait(20);
  assert.equal(calls.suggestions, 2);
});

test('stacks load once per account and reload after they are used', async () => {
  const { api, calls } = fakeApi();
  const store = createQueueSuggestions(api);
  store.showStacks(null);
  await wait(10);
  assert.equal(calls.chart, 1);
  store.showStacks(null);
  await wait(10);
  assert.equal(calls.chart, 1, 'reopening shows the loaded stacks');
  store.started('top');
  store.showStacks(null);
  assert.equal(typeof store.snapshot().stacks.top, 'object', 'the used stack keeps its covers while it reloads');
  assert.equal(store.snapshot().started.size, 0);
  await wait(10);
  assert.equal(calls.chart, 2);
  assert.equal(calls.latest, 1);
});
