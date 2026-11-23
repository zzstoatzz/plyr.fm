import assert from 'node:assert/strict';
import test from 'node:test';
import { albumTitles } from '../src/publishing/album-titles.ts';

test('a shared track number prefix is dropped', () => {
  assert.deepEqual(albumTitles(['01 tide out.wav', '02 - blue nile.flac', '3. low.mp3']), ['tide out', 'blue nile', 'low']);
});

test('a number that only some titles start with stays', () => {
  assert.deepEqual(albumTitles(['30 seconds.wav', 'harbor.wav']), ['30 seconds', 'harbor']);
  assert.deepEqual(albumTitles(['30 seconds.wav']), ['30 seconds']);
});
