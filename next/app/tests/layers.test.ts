import assert from 'node:assert/strict';
import test from 'node:test';
import { createLayerStack } from '../src/behaviors/layers.ts';

test('a layer is open until every opened layer closes', () => {
  const stack = createLayerStack();
  assert.equal(stack.isOpen(), false);
  const closeMenu = stack.open();
  const closePicker = stack.open();
  closeMenu();
  assert.equal(stack.isOpen(), true);
  closePicker();
  assert.equal(stack.isOpen(), false);
});

test('closing the same layer twice leaves the others open', () => {
  const stack = createLayerStack();
  const closeFirst = stack.open();
  stack.open();
  closeFirst();
  closeFirst();
  assert.equal(stack.isOpen(), true);
});
