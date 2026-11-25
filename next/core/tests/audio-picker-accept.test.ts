import assert from 'node:assert/strict';
import test from 'node:test';
import { audioPickerAccept, claimedContainer } from '../src/publishing/upload-model.ts';

test('audio pickers never use a MIME wildcard, which iOS Safari treats as video', () => {
  for (const touch of [true, false]) {
    const tokens = audioPickerAccept(touch).split(',');
    assert.ok(tokens.every(token => /^\.[a-z0-9]+$/.test(token)), tokens.join(','));
  }
});

test('phones leave out WebM, desktops keep it', () => {
  assert.ok(!audioPickerAccept(true).split(',').includes('.webm'));
  assert.ok(audioPickerAccept(false).split(',').includes('.webm'));
  assert.ok(!audioPickerAccept(true).split(',').includes('.mp4'), '.mp4 opens the photo library on a phone');
});

test('every extension the picker offers is one an upload takes, including voice memo m4a', () => {
  const tokens = audioPickerAccept(false).split(',');
  assert.ok(tokens.includes('.m4a'));
  for (const token of tokens) assert.doesNotThrow(() => claimedContainer({ name: `song${token}`, type: '' }));
});
