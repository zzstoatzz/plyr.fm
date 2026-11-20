import assert from 'node:assert/strict';
import test from 'node:test';
import { islandJob, uploadIsland } from '../src/publishing/upload-island.ts';

test('the island says each upload step in a word or two', () => {
  assert.deepEqual(uploadIsland({ title: 'demo', phase: 'uploading', progress: 0.427 }), { phase: 'active', summary: '42%', progress: 0.427, announce: 'uploading "demo" 42%', title: 'demo' });
  assert.equal(uploadIsland({ title: 'demo', phase: 'uploading' })?.summary, 'uploading');
  assert.equal(uploadIsland({ title: 'demo', phase: 'processing' })?.summary, 'to mp3');
  assert.equal(uploadIsland({ title: 'demo', phase: 'done' })?.phase, 'done');
  const failed = uploadIsland({ title: 'demo', phase: 'failed', error: 'sign in again' });
  assert.equal(failed?.phase, 'failed');
  assert.equal(failed?.announce, `"demo" didn't upload: sign in again`);
});

test('the island follows the moving upload, but always shows a finish', () => {
  const a = { id: 'a', phase: 'uploading' as const }, b = { id: 'b', phase: 'waiting' as const };
  assert.equal(islandJob([a, b], b), a);
  const done = { id: 'c', phase: 'done' as const };
  assert.equal(islandJob([a, done], done), done);
});
