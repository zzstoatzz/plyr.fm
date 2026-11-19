import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAudio } from '../src/downloads/format.ts';

test('download choices name the format and size the way a person reads them', () => {
  assert.equal(formatAudio({ mime: 'audio/mpeg', sizeBytes: 7_400_000 }), 'MP3 · 7.4 MB');
  assert.equal(formatAudio({ mime: 'audio/x-flac', sizeBytes: 38_200_000 }), 'FLAC · 38.2 MB');
  assert.equal(formatAudio({ mime: 'audio/wav', sizeBytes: 512_000 }), 'WAV · 512 KB');
  assert.equal(formatAudio({ mime: 'audio/wav' }), 'WAV');
});
