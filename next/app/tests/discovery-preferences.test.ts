import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_HIDDEN_TAGS, discoveryFilter, hiddenTags } from '../src/discovery/preferences.ts';

test('discovery preferences normalize and deduplicate with the API tag rules', () => {
  assert.deepEqual(hiddenTags([' -- AI ', 'AI', '  field\trecording ', 'Suno', 'Ä']), ['ai', 'field recording', 'suno', 'Ä']);
  assert.deepEqual(hiddenTags(['\u{10000}', '\uE000']), ['\uE000', '\u{10000}']);
  assert.deepEqual(hiddenTags([]), []);
});

test('invalid or oversized stored preferences do not become an allow-all setting', () => {
  for (const value of [null, 'ai', [''], ['---'], ['a\0b'], [42], ['é'.repeat(101)], Array.from({ length: 11 }, (_, n) => String(n))]) {
    assert.equal(hiddenTags(value), undefined);
  }
  assert.deepEqual(hiddenTags(Array(12).fill('ai')), ['ai']);
  assert.deepEqual(hiddenTags(['é'.repeat(100)]), ['é'.repeat(100)]);
});

test('default discovery reuses bootstrap and explicit show-all survives query encoding', () => {
  assert.equal(discoveryFilter(DEFAULT_HIDDEN_TAGS), undefined);
  const query = new URLSearchParams();
  for (const tag of discoveryFilter([]) ?? []) query.append('hidden_tag', tag);
  assert.equal(query.toString(), 'hidden_tag=');
  assert.deepEqual(discoveryFilter(['suno']), ['suno']);
});
