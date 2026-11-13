import assert from 'node:assert/strict';
import test from 'node:test';
import { autoscrollVelocity, dragTarget, landingTop, rowShift, stepForKey } from '../src/behaviors/reorder.ts';

const rows = [0, 60, 120, 180].map(top => ({ top, height: 60 }));

test('arrow keys step one place and stop at the ends', () => {
  assert.equal(stepForKey('ArrowUp', 2, 4), -1);
  assert.equal(stepForKey('ArrowDown', 2, 4), 1);
  assert.equal(stepForKey('ArrowUp', 1, 4), null);
  assert.equal(stepForKey('ArrowDown', 4, 4), null);
});

test('Home and End move to the first and last place', () => {
  assert.equal(stepForKey('Home', 3, 4), -2);
  assert.equal(stepForKey('End', 2, 4), 2);
  assert.equal(stepForKey('Home', 1, 4), null);
  assert.equal(stepForKey('End', 4, 4), null);
  assert.equal(stepForKey('Enter', 2, 4), null);
});

test('a drag lands once the lifted row passes a neighbour’s middle', () => {
  assert.deepEqual(dragTarget(rows, 0, 29), { offset: 29, to: 0 });
  assert.deepEqual(dragTarget(rows, 0, 60), { offset: 60, to: 1 });
  assert.deepEqual(dragTarget(rows, 3, -120), { offset: -120, to: 1 });
});

test('a drag is clamped to the list', () => {
  assert.deepEqual(dragTarget(rows, 1, -500), { offset: -60, to: 0 });
  assert.deepEqual(dragTarget(rows, 1, 500), { offset: 120, to: 3 });
});

test('rows between the origin and target make room for the lifted row', () => {
  assert.deepEqual([0, 1, 2, 3].map(index => rowShift(rows, 0, 2, index)), [0, -60, -60, 0]);
  assert.deepEqual([0, 1, 2, 3].map(index => rowShift(rows, 3, 1, index)), [0, 60, 60, 0]);
  assert.equal(landingTop(rows, 0, 2), 120);
  assert.equal(landingTop(rows, 3, 1), 60);
  assert.equal(landingTop(rows, 2, 2), null);
});

test('autoscroll speeds up toward the edges and caps', () => {
  assert.equal(autoscrollVelocity(300, 0, 600), 0);
  assert.equal(autoscrollVelocity(36, 0, 600), -5);
  assert.equal(autoscrollVelocity(584, 0, 600), 10);
  assert.equal(autoscrollVelocity(-200, 0, 600), -14);
});
