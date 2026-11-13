import test from 'node:test';
import assert from 'node:assert/strict';
import { EarlyIntents, EARLY_PLAY_LIMIT_MS } from '../src/early-intents.ts';
import type { Track } from '../src/api.ts';

const track = (id: string) => ({ id }) as Track;

test('a play the account queue never picks up expires instead of waiting forever', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const expired: string[] = [];
  const early = new EarlyIntents(intent => expired.push(intent.track.id));
  early.play({ track: track('a') });
  assert.equal(early.hasPlay(), true);
  t.mock.timers.tick(EARLY_PLAY_LIMIT_MS - 1);
  assert.deepEqual(expired, []);
  t.mock.timers.tick(1);
  assert.deepEqual(expired, ['a']);
  assert.equal(early.hasPlay(), false);
});

test('a play drained before the deadline does not also expire', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const expired: string[] = [];
  const early = new EarlyIntents(intent => expired.push(intent.track.id));
  early.enqueue(track('q'));
  early.play({ track: track('a') });
  assert.deepEqual(early.drain().map(intent => intent.kind + ':' + intent.track.id), ['enqueue:q', 'play:a']);
  t.mock.timers.tick(EARLY_PLAY_LIMIT_MS * 2);
  assert.deepEqual(expired, []);
  assert.equal(early.length, 0);
});

test('a newer play replaces the pending one and restarts the deadline', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const expired: string[] = [];
  const early = new EarlyIntents(intent => expired.push(intent.track.id), 100);
  early.play({ track: track('a') });
  t.mock.timers.tick(60);
  early.play({ track: track('b') });
  t.mock.timers.tick(60);
  assert.deepEqual(expired, []);
  t.mock.timers.tick(40);
  assert.deepEqual(expired, ['b']);
  assert.equal(early.length, 0);
});

test('queued additions stay queued when a play expires, up to the cap', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const early = new EarlyIntents(() => {}, 10);
  for (let index = 0; index < 70; index++) early.enqueue(track(String(index)));
  assert.equal(early.length, 64);
});
