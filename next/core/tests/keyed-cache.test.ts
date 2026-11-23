import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyedCache } from '../src/keyed-cache.ts';

test('a key is asked for once, shared while in flight, and kept', async () => {
  let calls = 0;
  const cache = createKeyedCache(async key => { calls++; return key.toUpperCase(); });
  assert.equal(cache.peek('a'), undefined);
  const [one, two] = await Promise.all([cache.load('a'), cache.load('a')]);
  assert.equal(one, 'A'); assert.equal(two, 'A');
  assert.equal(cache.peek('a'), 'A');
  await cache.load('a');
  assert.equal(calls, 1);
});

test('a failure is not remembered, and the oldest key goes past the cap', async () => {
  let fail = true;
  const cache = createKeyedCache(async key => { if (fail) throw new Error('down'); return key; }, { max: 2 });
  await assert.rejects(cache.load('a'));
  fail = false;
  assert.equal(await cache.load('a'), 'a');
  await cache.load('b'); await cache.load('c');
  assert.equal(cache.peek('a'), undefined);
  assert.equal(cache.peek('c'), 'c');
});

test('a stale answer still shows while it is asked for again', async () => {
  let clock = 0, calls = 0;
  const cache = createKeyedCache(async () => ++calls, { freshFor: 10, now: () => clock });
  await cache.load('a');
  clock = 11;
  assert.equal(cache.peek('a'), 1);
  assert.equal(await cache.load('a'), 2);
});
