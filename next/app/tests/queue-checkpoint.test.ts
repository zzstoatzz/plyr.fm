import test from 'node:test';
import assert from 'node:assert/strict';
import type { Track } from '../src/api.ts';
import { applyQueueProgress, newerProgress, queueCheckpoint, type QueueCheckpoint } from '../src/queue-checkpoint.ts';

const uri = 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/fm.plyr.track/a';
const track: Track = { object: 'track', id: 'trk_' + Buffer.from(uri).toString('base64url'), record: { uri, cid: 'bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm', revision: 'rev', collection: 'fm.plyr.track', rkey: 'a' },
  metadata: { title: 'A song', description: null, album: null, duration_seconds: 60, created_at: '2026-11-06T00:00:00Z' },
  artist: { did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', profile: { handle: 'artist.test', display_name: 'Artist', avatar_url: null } },
  media: { artwork: null }, access: { visibility: 'public' }, metrics: { play_count: 1, like_count: 0 } };
const checkpoint: QueueCheckpoint = { version: 1, owner: 'anonymous', updatedAt: 100, state: { entries: [{ key: 'first', track }, { key: 'second', track }], index: 1 }, position: 12, repeat: 'off', keepPlaying: false };

test('queue checkpoints preserve repeated occurrence and paused resume position', () => {
  const restored = queueCheckpoint(JSON.parse(JSON.stringify(checkpoint)), 'anonymous');
  assert.deepEqual(restored, checkpoint);
  assert.equal(restored?.state.entries[restored.state.index].key, 'second');
  assert.equal(queueCheckpoint(checkpoint, 'did:plc:anotheraccount'), null);
});

test('progress cannot seek a successor occurrence or override a newer snapshot', () => {
  assert.equal(applyQueueProgress(checkpoint, { key: 'first', position: 40, updatedAt: 200 }, 'anonymous')?.position, 12);
  assert.equal(applyQueueProgress(checkpoint, { key: 'second', position: 40, updatedAt: 99 }, 'anonymous')?.position, 12);
  assert.equal(applyQueueProgress(checkpoint, { key: 'second', position: 40, updatedAt: 200 }, 'anonymous')?.position, 40);
});

test('corrupt or oversized checkpoints are ignored without throwing', () => {
  assert.equal(queueCheckpoint({ ...checkpoint, position: Number.NaN }, 'anonymous'), null);
  assert.equal(queueCheckpoint({ ...checkpoint, state: { ...checkpoint.state, entries: Array(201).fill(checkpoint.state.entries[0]) } }, 'anonymous'), null);
  assert.equal(queueCheckpoint({ ...checkpoint, state: { entries: [checkpoint.state.entries[0], checkpoint.state.entries[0]], index: 0 } }, 'anonymous'), null);
  assert.equal(queueCheckpoint({ ...checkpoint, state: { entries: [], index: -1 } }, 'anonymous'), null);
  assert.equal(queueCheckpoint(null, 'anonymous'), null);
});

test('only display metadata is cached, not delivery URLs or unknown response fields', () => {
  const raw = { ...checkpoint, extraSession: 'discard-me', state: { ...checkpoint.state, entries: checkpoint.state.entries.map(entry => ({ ...entry, track: { ...entry.track, media: { artwork: null, origins: [{ url: 'https://delivery.example/temporary' }] } } })) } };
  const safe = queueCheckpoint(raw, 'anonymous');
  assert.deepEqual(safe, checkpoint);
  assert.equal(JSON.stringify(safe).includes('delivery.example'), false);
  assert.equal(JSON.stringify(safe).includes('discard-me'), false);
});

test('restore uses whichever saved progress is newest, so a pagehide write that never committed is not needed', () => {
  const committed = { key: 'second', position: 20, updatedAt: 200 };
  const synchronous = { key: 'second', position: 31, updatedAt: 300 };
  assert.equal(newerProgress(committed, synchronous), synchronous);
  assert.equal(newerProgress(synchronous, committed), synchronous);
  assert.equal(newerProgress(undefined, synchronous), synchronous);
  assert.equal(newerProgress(committed, null), committed);
  assert.equal(applyQueueProgress(checkpoint, newerProgress(committed, synchronous), 'anonymous')?.position, 31);
});
