import test from 'node:test';
import assert from 'node:assert/strict';
import { QueueContinuation } from '../src/queue-continuation.ts';
import type { Page } from '../src/api.ts';
const song = (id: string) => ({ id });

test('continuation walks past a seen page and retains every fetched track until consumption', async () => {
  const calls: (string | undefined)[] = [];
  const reader = new QueueContinuation(async cursor => {
    calls.push(cursor);
    return cursor === undefined ? { object: 'list', data: [song('seen')], has_more: true, next_cursor: 'page-two' }
      : { object: 'list', data: Array.from({ length: 10 }, (_, at) => song(String(at))), has_more: false };
  });
  await Promise.all([reader.prefetch(new Set(['seen'])), reader.prefetch(new Set(['seen']))]);
  assert.deepEqual(calls, [undefined, 'page-two']);
  const tracks = reader.peek(new Set());
  assert.equal(tracks.length, 10);
  reader.consumed(new Set(tracks.slice(0, 3).map(track => track.id)));
  assert.deepEqual(reader.peek(new Set()).map(track => track.id), ['3', '4', '5', '6', '7', '8', '9']);
  await reader.prefetch(new Set());
  assert.equal(calls.length, 2);
});

test('context changes fence late pages and resume from the synchronized cursor', async () => {
  let deliver: (page: Page<{ id: string }>) => void = () => {};
  const calls: (string | undefined)[] = [];
  const reader = new QueueContinuation(cursor => {
    calls.push(cursor);
    return cursor ? Promise.resolve({ object: 'list', data: [song('new')], has_more: false })
      : new Promise(resolve => { deliver = resolve; });
  });
  const old = reader.prefetch(new Set());
  reader.reset('saved-cursor');
  await reader.prefetch(new Set());
  deliver({ object: 'list', data: [song('old')], has_more: false });
  await old;
  assert.deepEqual(calls, [undefined, 'saved-cursor']);
  assert.deepEqual(reader.peek(new Set()).map(track => track.id), ['new']);
});

test('one prefetch is bounded even when the current queue covers several discovery pages', async () => {
  let calls = 0;
  const reader = new QueueContinuation(async () => ({ object: 'list', data: [song('seen')], has_more: true, next_cursor: String(++calls) }));
  await reader.prefetch(new Set(['seen']));
  assert.equal(calls, 3);
  assert.deepEqual(reader.peek(new Set()), []);
  await reader.prefetch(new Set(['seen']));
  assert.equal(calls, 6);
});

test('reset aborts the old fetch without exposing a stale-context error', async () => {
  let aborted = false;
  const reader = new QueueContinuation<{ id: string }>((cursor, signal) => cursor
    ? Promise.resolve({ object: 'list', data: [song('new')], has_more: false })
    : new Promise((_, reject) => { signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }); }));
  const previous = reader.prefetch(new Set());
  reader.reset('new-context');
  await previous;
  assert.equal(aborted, true);
  await reader.prefetch(new Set());
  assert.deepEqual(reader.peek(new Set()).map(track => track.id), ['new']);
});
