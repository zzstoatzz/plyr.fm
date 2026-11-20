import assert from 'node:assert/strict';
import test from 'node:test';
import { addTag, removeTag, suggestTags, tagCatalog, tagList } from '../src/publishing/tag-suggestions.ts';

const catalog = [
  { name: 'electronic', track_count: 40 }, { name: 'ambient', track_count: 30 }, { name: 'lo-fi', track_count: 12 },
  { name: 'dark ambient', track_count: 9 }, { name: 'ambient techno', track_count: 3 }, { name: 'techno', track_count: 20 },
];

test('suggestions put prefix matches first, then other matches, most used first, skipping chosen tags', () => {
  assert.deepEqual(suggestTags(catalog, 'Amb', []).map(tag => tag.name), ['ambient', 'ambient techno', 'dark ambient']);
  assert.deepEqual(suggestTags(catalog, 'amb', ['ambient']).map(tag => tag.name), ['ambient techno', 'dark ambient']);
  assert.deepEqual(suggestTags(catalog, 'techno', []).map(tag => tag.name), ['techno', 'ambient techno']);
  assert.deepEqual(suggestTags(catalog, '  ', []), []);
  assert.equal(suggestTags(catalog, 'e', [], 2).length, 2);
});

test('adding and removing keeps one tag per line without duplicates', () => {
  let value = addTag('', ' Dark  Ambient ');
  value = addTag(value, 'techno');
  value = addTag(value, 'dark ambient');
  assert.equal(value, 'dark ambient\ntechno');
  assert.deepEqual(tagList('a\n\n b \na'), ['a', 'b']);
  assert.equal(removeTag(value, 'dark ambient'), 'techno');
  assert.equal(addTag(value, '   '), value);
  const full = Array.from({ length: 20 }, (_, at) => `t${at}`).join('\n');
  assert.equal(addTag(full, 'one more'), full);
});

test('the catalog loads a few pages once and retries after a failure', async () => {
  const calls: (string | undefined)[] = [];
  let fail = true;
  const load = tagCatalog(async (_limit, cursor) => {
    calls.push(cursor);
    if (fail) { fail = false; throw new Error('offline'); }
    return cursor ? { object: 'list', data: [catalog[1]], has_more: false } : { object: 'list', data: [catalog[0]], has_more: true, next_cursor: 'c1' };
  });
  await assert.rejects(load());
  assert.deepEqual((await load()).map(tag => tag.name), ['electronic', 'ambient']);
  await load();
  assert.deepEqual(calls, [undefined, undefined, 'c1']);
});
