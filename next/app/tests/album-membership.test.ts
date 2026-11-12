import assert from 'node:assert/strict';
import test from 'node:test';
import { albumMembership, albumName } from '../src/collections/album-membership.ts';
import { collectionRecord } from '../src/collections/collection-order.ts';

test('album edits remove exact occurrences and preserve retained unknown fields', () => {
  const items = [
    { subject: { uri: 'at://same', cid: 'a', future: true }, occurrence: 'one' },
    { subject: { uri: 'at://missing', cid: 'b' }, unavailable: true },
    { subject: { uri: 'at://same', cid: 'a' }, occurrence: 'two' },
  ];
  const revision = { uri: 'at://album', cid: 'old', value: collectionRecord({ listType: 'album', future: true, items }, 'album') };
  assert.deepEqual(albumMembership(revision, [2, 1], new Map()), [items[2], items[1]]);
  assert.deepEqual(revision.value.items, items);
  for (const entries of [[1, 1], [3], [-1], [0.5]]) assert.throws(() => albumMembership(revision, entries, new Map()));
  assert.throws(() => collectionRecord(revision.value, 'playlist'));
});

test('album names are explicit and never silently truncated', () => {
  assert.equal(albumName('  a recording  '), 'a recording');
  for (const name of ['', '   ', 'a'.repeat(65)]) assert.throws(() => albumName(name));
});
