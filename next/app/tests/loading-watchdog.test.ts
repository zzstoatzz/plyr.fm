import test from 'node:test';
import assert from 'node:assert/strict';
import { LoadingWatchdog, STUCK_LOADING_MS } from '../src/loading-watchdog.ts';

test('fires once when loading stays on past the limit', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let fired = 0;
  const watchdog = new LoadingWatchdog(() => fired++);
  watchdog.update(true);
  t.mock.timers.tick(STUCK_LOADING_MS - 1);
  watchdog.update(true);
  assert.equal(fired, 0);
  t.mock.timers.tick(1);
  assert.equal(fired, 1);
  t.mock.timers.tick(STUCK_LOADING_MS * 3);
  assert.equal(fired, 1);
});

test('a break in loading restarts the clock', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let fired = 0;
  const watchdog = new LoadingWatchdog(() => fired++, 100);
  watchdog.update(true);
  t.mock.timers.tick(90);
  watchdog.update(false);
  watchdog.update(true);
  t.mock.timers.tick(90);
  assert.equal(fired, 0);
  t.mock.timers.tick(10);
  assert.equal(fired, 1);
});

test('dispose cancels a pending fire', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let fired = 0;
  const watchdog = new LoadingWatchdog(() => fired++, 100);
  watchdog.update(true);
  watchdog.dispose();
  t.mock.timers.tick(500);
  assert.equal(fired, 0);
});
