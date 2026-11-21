import assert from 'node:assert/strict';
import test from 'node:test';
import { deletedScreens } from '../src/publishing/deleted-screens.ts';

const route = (name: string, id?: string) => ({ name, params: id ? { id } : undefined });

test('pops the editor and the deleted track page under it', () => {
  assert.equal(deletedScreens({ routes: [route('portal'), route('track/[id]', '7'), route('edit-track/[id]', '7')] }, '7'), 2);
});

test('pops only the editor when it was opened from the portal', () => {
  assert.equal(deletedScreens({ routes: [route('portal'), route('edit-track/[id]', '7')] }, '7'), 1);
});

test('keeps a different track page under the editor', () => {
  assert.equal(deletedScreens({ routes: [route('index'), route('track/[id]', '3'), route('edit-track/[id]', '7')] }, '7'), 1);
});

test('counts a stack that holds nothing but the deleted track', () => {
  assert.equal(deletedScreens({ routes: [route('track/[id]', '7'), route('edit-track/[id]', '7')] }, '7'), 2);
});
