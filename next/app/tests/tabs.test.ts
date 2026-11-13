import assert from 'node:assert/strict';
import test from 'node:test';
import { tabForKey } from '../src/behaviors/tabs.ts';

const sections = ['tracks', 'albums', 'playlists', 'likes'] as const;

test('arrow keys move to the neighbouring tab and wrap at both ends', () => {
  assert.equal(tabForKey(sections, 'tracks', 'ArrowRight'), 'albums');
  assert.equal(tabForKey(sections, 'likes', 'ArrowRight'), 'tracks');
  assert.equal(tabForKey(sections, 'tracks', 'ArrowLeft'), 'likes');
  assert.equal(tabForKey(sections, 'albums', 'ArrowLeft'), 'tracks');
});

test('Home and End move to the first and last tab', () => {
  assert.equal(tabForKey(sections, 'playlists', 'Home'), 'tracks');
  assert.equal(tabForKey(sections, 'albums', 'End'), 'likes');
});

test('two tabs toggle with either arrow', () => {
  assert.equal(tabForKey(['tracks', 'albums'], 'tracks', 'ArrowLeft'), 'albums');
  assert.equal(tabForKey(['tracks', 'albums'], 'albums', 'ArrowRight'), 'tracks');
});

test('other keys leave the selection alone', () => {
  assert.equal(tabForKey(sections, 'tracks', 'ArrowDown'), null);
  assert.equal(tabForKey(sections, 'tracks', 'Enter'), null);
  assert.equal(tabForKey([], 'tracks', 'Home'), null);
});
