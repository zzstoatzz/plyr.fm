import assert from 'node:assert/strict';
import test from 'node:test';
import { orderedPlaylist, playlistRecord, sameRecord } from '../src/collections/playlist-order.ts';

test('ordering preserves every occurrence and unknown fields without mutating the snapshot', () => {
  const input = { listType: 'playlist', future: { intact: true }, items: [
    { subject: { uri: 'at://one', cid: 'a', extra: true }, occurrence: 'first' },
    { subject: { uri: 'at://missing', cid: 'b' }, occurrence: 'missing' },
    { subject: { uri: 'at://one', cid: 'a' }, occurrence: 'duplicate' },
  ] };
  const parsed = playlistRecord(input);
  const moved = orderedPlaylist(parsed, [2, 0, 1]);
  assert.deepEqual(moved.items, [input.items[2], input.items[0], input.items[1]]);
  assert.deepEqual(moved.future, input.future);
  assert.deepEqual(parsed, input);
  for (const order of [[0, 0, 2], [0, 1], [0, 1, 3], [0, 1, 1.5], [-1, 0, 1]]) {
    assert.throws(() => orderedPlaylist(parsed, order), /exactly once/);
  }
});

test('malformed canonical entries fail closed rather than disappearing', () => {
  for (const value of [null, [], { listType: 'album', items: [] }, { listType: 'playlist', items: [null] },
    { listType: 'playlist', items: [{ subject: { uri: 'at://one' } }] }]) assert.throws(() => playlistRecord(value));
});

test('record acknowledgement comparison ignores object key order but preserves array order and unknown fields', () => {
  assert.ok(sameRecord({ a: 1, b: [{ c: true }] }, { b: [{ c: true }], a: 1 }));
  assert.equal(sameRecord({ a: [1, 2] }, { a: [2, 1] }), false);
  assert.equal(sameRecord({ a: 1 }, { a: 1, extra: true }), false);
});
