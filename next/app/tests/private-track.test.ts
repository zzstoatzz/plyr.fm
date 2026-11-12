import assert from 'node:assert/strict';
import test from 'node:test';
import { privateTrack, isPrivateTrack, editPrivateQueue } from '../src/publishing/private-track.ts';
import { queueReference } from '../src/personal-queue.ts';
import { queueCheckpoint } from '../src/queue-checkpoint.ts';

const track = privateTrack('did:plc:fixture', '3jzfcijpj2z2a', 'fixturecid', {
  $type: 'fm.plyr.track', title: 'private song', artist: 'private artist', createdAt: '2026-11-12T00:00:00Z',
  imageUrl: 'https://untrusted.invalid/private-artwork', description: 'private liner notes', duration: 42,
});

test('private track metadata stays local and cannot become a synchronized queue reference', () => {
  assert.equal(isPrivateTrack(track), true);
  assert.equal(track.metadata.description, 'private liner notes');
  assert.equal(track.media.artwork, undefined);
  assert.throws(() => queueReference(track, 'entry1'), /private queue/);
  assert.equal(queueCheckpoint({ version: 1, owner: 'did:plc:fixture', updatedAt: 1, position: 0, repeat: 'off', keepPlaying: false,
    state: { entries: [{ key: 'entry1', track }], index: 0 } }, 'did:plc:fixture'), null);
});

test('a private URI cannot be disguised as a public synchronized track', () => {
  const disguised = { ...track, id: 'trk_fixture', access: { visibility: 'public' as const } };
  assert.equal(isPrivateTrack(disguised), true);
  assert.throws(() => queueReference(disguised, 'entry1'), /private queue/);
  assert.equal(queueCheckpoint({ version: 1, owner: 'did:plc:fixture', updatedAt: 1, position: 0, repeat: 'off', keepPlaying: false,
    state: { entries: [{ key: 'entry1', track: disguised }], index: 0 } }, 'did:plc:fixture'), null);
});

test('private queue edits retain current and history through shared queue rules', () => {
  const tracks = [track, { ...track, id: 'second' }, { ...track, id: 'third' }];
  assert.deepEqual(editPrivateQueue(tracks, 0, { action: 'move', from: 0, to: 2 }), tracks);
  assert.deepEqual(editPrivateQueue(tracks, 0, { action: 'move', from: 1, to: 2 }).map(item => item.id), [track.id, 'third', 'second']);
  assert.deepEqual(editPrivateQueue(tracks, 0, { action: 'remove', at: 0 }), tracks);
  assert.deepEqual(editPrivateQueue(tracks, 0, { action: 'clear' }), [track]);
  assert.equal(editPrivateQueue(tracks, 0, { action: 'shuffle' })[0], track);
});
