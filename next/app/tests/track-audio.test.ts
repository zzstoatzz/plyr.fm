import assert from 'node:assert/strict';
import test from 'node:test';
import { canReplaceTrackAudio, replacedTrackAudio, validateReplacementAudio, MAX_AUDIO_BYTES } from '../src/publishing/track-audio.ts';

const file = { name: 'new.WAV', type: 'audio/wav', size: 4, async arrayBuffer() { return new ArrayBuffer(4); } };
const blob = { $type: 'blob', ref: { $link: 'new-cid' }, mimeType: file.type, size: file.size };

test('replacement preserves identity metadata and warnings while removing obsolete audio references', () => {
  const record = { title: 'same song', createdAt: '2026-11-12T00:00:00Z', labels: { values: [{ val: 'porn' }] }, extra: { kept: true }, downloadPolicy: 'open', audioUrl: 'https://old.invalid/audio', audioBlob: { old: true }, fileType: 'flac', duration: 100 };
  const next = replacedTrackAudio(record, file, blob, 2.2);
  for (const key of ['title', 'createdAt', 'labels', 'extra', 'downloadPolicy'] as const) assert.deepEqual(next[key], record[key]);
  for (const key of ['audioUrl', 'audioFileId', 'originalAudioBlob', 'originalFileId', 'originalFileType']) assert.equal(Object.hasOwn(next, key), false);
  assert.equal(next.audioBlob, blob);
  assert.equal(next.fileType, 'wav');
  assert.equal(next.duration, 2);
  assert.equal(record.duration, 100);
  assert.equal(replacedTrackAudio(record, file, blob).duration, undefined, 'unknown replacement duration cannot retain the old duration');
});

test('protected, supporter, private and restricted records cannot publish replacement public blobs', () => {
  for (const record of [{ audioSpace: 'at://protected' }, { audioSpace: null }, { audioFileId: 'protected' }, { originalAudioBlob: {} }, { originalFileId: 'protected' }, { originalFileType: 'flac' }, { supportGate: {} }, { visibility: 'private' }, ...['ask', 'supporters', 'off', 'future-policy'].map(downloadPolicy => ({ downloadPolicy }))]) {
    assert.equal(canReplaceTrackAudio(record), false);
    assert.throws(() => validateReplacementAudio(record, file), /protected or restricted/);
  }
});

test('replacement validates the actual blob contract and rejects empty or non-audio input', () => {
  for (const size of [0, -1, 1.5, NaN, Infinity, MAX_AUDIO_BYTES + 1]) assert.throws(() => validateReplacementAudio({}, { ...file, size }));
  assert.throws(() => validateReplacementAudio({}, { ...file, type: 'image/png' }), /audio file/);
  validateReplacementAudio({}, { ...file, size: MAX_AUDIO_BYTES });
});
