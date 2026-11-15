import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dismissPlayerPull, pullDirection } from '../src/behaviors/player-pull.ts';

test('acquisition requires downward motion and rejects upward or sideways gestures', () => {
  assert.equal(pullDirection(0, -20), 'blocked');
  assert.equal(pullDirection(25, 20), 'blocked');
  assert.equal(pullDirection(20, 25), 'waiting');
  assert.equal(pullDirection(0, 10), 'waiting');
  assert.equal(pullDirection(20, 31), 'down');
});

test('the header dismisses on a deliberate pull or flick', () => {
  assert.equal(dismissPlayerPull(80, 0, 800, true), false);
  assert.equal(dismissPlayerPull(47, 1, 800, true), false);
  assert.equal(dismissPlayerPull(48, 0.8, 800, true), true);
  assert.equal(dismissPlayerPull(120, 0, 800, true), true);
  assert.equal(dismissPlayerPull(64, 0, 400, true), true);
});

test('the content pull uses smaller thresholds and snaps back on an upward release', () => {
  assert.equal(dismissPlayerPull(15, 0.8, 800, false), false);
  assert.equal(dismissPlayerPull(16, 0.3, 800, false), true);
  assert.equal(dismissPlayerPull(80, -0.4, 800, false), false);
  assert.equal(dismissPlayerPull(80, 0, 800, false), true);
});
