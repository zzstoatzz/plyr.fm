import assert from 'node:assert/strict';
import test from 'node:test';
import type { Playback } from '../src/api.ts';
import { freshPlayback } from '../src/fresh-playback.ts';

const artifact = { cid: 'bafk', media_type: 'audio/x-m4a', byte_length: 10 };
const pending: Playback = { object: 'playback', track_id: 't', record: { uri: 'at://x', cid: 'c' }, availability: { status: 'unavailable', artifact, delivery: null } };
const ready: Playback = { ...pending, availability: { status: 'available', artifact, delivery: { url: 'https://audio/x', media_type: 'audio/x-m4a' } } };

function clock(start: number) {
  let at = start;
  return { now: () => at, wait: async (ms: number) => { at += ms; } };
}

test('waits for a fresh upload until its audio can be delivered', async () => {
  const time = clock(Date.parse('2026-11-20T19:54:16Z'));
  const answers = [pending, pending, pending, ready];
  let waiting = 0;
  const result = await freshPlayback(attempt => Promise.resolve(answers[attempt]), { createdAt: '2026-11-20T19:54:09Z', ...time, onWaiting: () => waiting++ });
  assert.equal(result, ready);
  assert.equal(waiting, 1);
});

test('does not wait on an old track', async () => {
  const time = clock(Date.parse('2026-11-20T19:54:16Z'));
  let reads = 0;
  const result = await freshPlayback(() => { reads++; return Promise.resolve(pending); }, { createdAt: '2026-11-19T10:00:00Z', ...time });
  assert.equal(result, pending);
  assert.equal(reads, 1);
});

test('gives up after a bounded wait', async () => {
  const time = clock(Date.parse('2026-11-20T19:54:16Z'));
  let reads = 0;
  const result = await freshPlayback(() => { reads++; return Promise.resolve(pending); }, { createdAt: '2026-11-20T19:54:09Z', ...time });
  assert.equal(result, pending);
  assert.ok(reads > 2);
  assert.ok(reads <= 8);
});

test('stops when the listener moves on', async () => {
  const time = clock(Date.parse('2026-11-20T19:54:16Z'));
  let reads = 0;
  await freshPlayback(() => { reads++; return Promise.resolve(pending); }, { createdAt: '2026-11-20T19:54:09Z', ...time, stale: () => reads >= 2 });
  assert.equal(reads, 2);
});

test('returns at once when audio is ready or gone', async () => {
  const time = clock(Date.parse('2026-11-20T19:54:16Z'));
  const gone: Playback = { ...pending, availability: { status: 'unavailable', artifact: null, delivery: null } };
  assert.equal(await freshPlayback(() => Promise.resolve(ready), { createdAt: '2026-11-20T19:54:09Z', ...time }), ready);
  assert.equal(await freshPlayback(() => Promise.resolve(gone), { createdAt: '2026-11-20T19:54:09Z', ...time }), gone);
});
