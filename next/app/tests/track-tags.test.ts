import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { normalizeTrackTags, recordTags } from '../src/publishing/track-tags.ts';

test('creator tags follow canonical normalization with stable deduplication', () => {
  assert.deepEqual(normalizeTrackTags(['  AI  ', 'ai', '--Hip-Hop--', 'AI   Generated', '', '---']), ['ai', 'hip-hop', 'ai generated']);
  assert.deepEqual(normalizeTrackTags([]), []);
  assert.equal(recordTags(undefined), undefined);
  assert.deepEqual(recordTags([]), []);
  assert.throws(() => recordTags([1]));
  const nested = normalizeTrackTags([' -- AI -- ', '- - ', '\n\t', '-- - Hip-Hop - --']);
  assert.deepEqual(nested, ['ai', 'hip-hop']);
  assert.deepEqual(normalizeTrackTags(nested), nested);
});

test('published tag limits count UTF-8 bytes and unique normalized tags', () => {
  assert.equal(normalizeTrackTags(['é'.repeat(25)])[0], 'é'.repeat(25));
  assert.throws(() => normalizeTrackTags(['é'.repeat(26)]));
  assert.equal(normalizeTrackTags(['🎵'.repeat(12) + 'ab'])[0], '🎵'.repeat(12) + 'ab');
  assert.throws(() => normalizeTrackTags(['🎵'.repeat(13)]));
  assert.throws(() => normalizeTrackTags(['İ'.repeat(17)]), 'lowercase expansion is validated');
  assert.equal(normalizeTrackTags(Array.from({ length: 20 }, (_, i) => `tag ${i}`)).length, 20);
  assert.throws(() => normalizeTrackTags(Array.from({ length: 21 }, (_, i) => `tag ${i}`)));
  assert.equal(normalizeTrackTags(Array(21).fill('ai')).length, 1);
  assert.throws(() => normalizeTrackTags(['ai\0hidden']));
});
