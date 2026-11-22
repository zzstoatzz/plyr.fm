import assert from 'node:assert/strict';
import test from 'node:test';
import { useAdjustable } from '../src/behaviors/use-adjustable.ts';

const act = (props: ReturnType<typeof useAdjustable>, actionName: string) => props.onAccessibilityAction({ nativeEvent: { actionName } });

test('swiping an adjustable control nudges by one step and stays in range', () => {
  const seen: number[] = [];
  const at = (value: number, disabled = false) => useAdjustable({ label: 'Playback position', value, min: 0, max: 100, step: 10, text: '', onChange: next => seen.push(next), disabled });
  act(at(50), 'increment');
  act(at(50), 'decrement');
  act(at(95), 'increment');
  act(at(4), 'decrement');
  act(at(50, true), 'increment');
  assert.deepEqual(seen, [60, 40, 100, 0]);
  assert.equal(at(50).accessibilityRole, 'adjustable');
  assert.deepEqual(at(50).accessibilityValue, { min: 0, max: 100, now: 50, text: '' });
});
