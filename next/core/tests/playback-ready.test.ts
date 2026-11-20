import assert from 'node:assert/strict';
import test from 'node:test';
import type { Playback } from '../src/api.ts';
import { readyPlayback } from '../src/playback-ready.ts';

const answer = (status: Playback['availability']['status']): Playback => ({
  object: 'playback', track_id: 'trk_x', record: { uri: 'at://did:plc:a/fm.plyr.track/3t', cid: 'bafy' },
  availability: { status, delivery: status === 'available' ? { url: 'https://audio.example/audio/bafk', media_type: 'audio/mp4' } : null },
});

test('a preparing track is asked about again until it is available', async () => {
  const replies = [answer('preparing'), answer('preparing'), answer('available')];
  let preparing = 0;
  const playback = await readyPlayback(async () => replies.shift()!, { delaysMs: [0, 0, 0], onPreparing: () => { preparing++; } });
  assert.equal(playback.availability.status, 'available');
  assert.equal(preparing, 2);
});

test('other answers return at once and a track that stays preparing gives up', async () => {
  let lookups = 0;
  assert.equal((await readyPlayback(async () => { lookups++; return answer('unavailable'); }, { delaysMs: [0, 0] })).availability.status, 'unavailable');
  assert.equal(lookups, 1);
  lookups = 0;
  assert.equal((await readyPlayback(async () => { lookups++; return answer('preparing'); }, { delaysMs: [0, 0] })).availability.status, 'preparing');
  assert.equal(lookups, 3);
});

test('a skip abandons the wait', async () => {
  const controller = new AbortController();
  const waiting = readyPlayback(async () => answer('preparing'), { signal: controller.signal, delaysMs: [60_000] });
  controller.abort(new Error('skipped'));
  await assert.rejects(waiting, /skipped/);
});
