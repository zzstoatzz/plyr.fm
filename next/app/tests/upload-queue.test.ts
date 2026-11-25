import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { canonicalAudioType, genreTags, jobLine, outputBudget, processingStep, transient, uploadRoute } from '@plyr/next-core/publishing/upload-queue-model';
import { claimedContainer, MAX_SERVICE_AUDIO_BYTES, UPLOAD_PART_BYTES, type UploadStatus } from '@plyr/next-core/publishing/upload-model';
import type { AudioFormat } from '@plyr/next-core/audio-format';

const MIB = 1_048_576;

const as = (container: AudioFormat['container'], codec: AudioFormat['codec']): AudioFormat => ({ container, codec });

test('small playable audio goes to the PDS; lossless, ALAC and large go through plyr storage', () => {
  assert.deepEqual(uploadRoute({ size: 2 * MIB }, as('mp4', 'aac')), { kind: 'pds' });
  assert.deepEqual(uploadRoute({ size: 90 * MIB }, as('mp3', 'mp3')), { kind: 'pds' });
  assert.deepEqual(uploadRoute({ size: 200 * MIB }, as('mp3', 'mp3')), { kind: 'service' });
  for (const format of [as('wav', 'pcm'), as('flac', 'flac'), as('aiff', 'pcm'), as('webm', 'opus'), as('ogg', 'vorbis'), as('mp4', 'alac'), as('mp4', 'unknown')]) {
    const route = uploadRoute({ size: 5 * MIB }, format, 30);
    assert.equal(route.kind === 'service' && route.processing?.recipe, 'mp3-320k-44100-v1', `${format.container} ${format.codec}`);
  }
  assert.throws(() => uploadRoute({ size: MAX_SERVICE_AUDIO_BYTES + 1 }, as('wav', 'pcm')), /1\.5 GiB/);
  assert.throws(() => uploadRoute({ size: 0 }, as('mp3', 'mp3')), /nonempty/);
  assert.throws(() => uploadRoute({ size: 2 * MIB }, undefined), /isn't audio/, 'bytes that are no audio are refused');
});

test('mp3 budget follows duration, falls back to source size, and stays inside the admission bound', () => {
  assert.equal(outputBudget(50 * MIB, 'wav', 300), Math.ceil(300 * 40_000 * 1.1) + 4 * MIB);
  assert.equal(outputBudget(50 * MIB, 'flac'), 54 * MIB);
  assert.equal(outputBudget(2 * MIB, 'webm'), 8 * MIB);
  assert.equal(outputBudget(10, 'wav', 0.0001), 4 * MIB + 5);
  assert.equal(outputBudget(MAX_SERVICE_AUDIO_BYTES, 'wav'), MAX_SERVICE_AUDIO_BYTES);
  assert.ok(outputBudget(MAX_SERVICE_AUDIO_BYTES, 'wav', 1e9) <= 2 * MAX_SERVICE_AUDIO_BYTES - MAX_SERVICE_AUDIO_BYTES);
});

const base: UploadStatus = { state: 'processing', recoveryRequired: false, reservedBytes: 1, partSizeBytes: UPLOAD_PART_BYTES, partCount: 1, receivedParts: [], reservedDigests: [] };
test('processing polls until the rendition is ready, retries a stalled conversion, and stops on a budget miss', () => {
  assert.equal(processingStep(base), 'wait');
  assert.equal(processingStep({ ...base, processingFailure: 'executor_failed' }), 'wait');
  assert.equal(processingStep({ ...base, processingFailure: 'executor_failed', recoveryRequired: true }), 'retry');
  assert.equal(processingStep({ ...base, processingFailure: 'output_budget_exceeded', recoveryRequired: true }), 'stop');
  assert.equal(processingStep({ ...base, state: 'complete', audioUrl: 'https://a/media/x' }), 'publish');
  assert.equal(processingStep({ ...base, state: 'cancelled' }), 'stop');
});

test('only network drops and server errors are retried', () => {
  assert.equal(transient(new TypeError('Failed to fetch')), true);
  assert.equal(transient(Object.assign(new Error('x'), { status: 503 })), true);
  assert.equal(transient(Object.assign(new Error('x'), { status: 429 })), true);
  assert.equal(transient(Object.assign(new Error('x'), { status: 403 })), false);
  assert.equal(transient(new Error('a different record already uses this address')), false);
});

test('one toast line per phase', () => {
  const job = { id: '1', owner: 'did:plc:a', title: 'jimmy john’s 28' };
  assert.equal(jobLine({ ...job, phase: 'uploading', progress: 0.426 }), 'uploading "jimmy john’s 28" 42%');
  assert.equal(jobLine({ ...job, phase: 'uploading' }), 'uploading "jimmy john’s 28"…');
  assert.equal(jobLine({ ...job, phase: 'processing' }), 'converting "jimmy john’s 28" to mp3…');
  assert.equal(jobLine({ ...job, phase: 'done' }), '"jimmy john’s 28" uploaded');
  assert.equal(jobLine({ ...job, phase: 'failed', error: 'finish the earlier upload first' }), '"jimmy john’s 28" didn\'t upload: finish the earlier upload first');
});

test('iOS picker types and bare names are claims the picker takes', () => {
  for (const [name, type, container] of [['Queue test – wav ’26.wav', 'audio/vnd.wave', 'wav'], ['rec.webm', 'video/webm', 'webm'], ['take.flac', 'audio/x-flac', 'flac'],
    ['song.mp3', 'audio/mp3', 'mp3'], ['take.aif', 'audio/x-aiff', 'aiff'], ['memo', 'audio/x-m4a', 'mp4']]) {
    assert.equal(claimedContainer({ name, type }), container, name);
  }
  assert.throws(() => claimedContainer({ name: 'notes.txt', type: 'text/plain' }), /choose an/);
  assert.throws(() => claimedContainer({ name: 'notes', type: 'application/octet-stream' }), /choose an/);
});

test('auto-tag adds genres within half the top score, at most five, after the artist\'s own tags', () => {
  const genres = [{ name: 'electronic', confidence: 0.8 }, { name: 'ambient', confidence: 0.6 }, { name: 'idm', confidence: 0.41 }, { name: 'rock', confidence: 0.39 }];
  assert.deepEqual(genreTags(['field recording'], genres), ['field recording', 'electronic', 'ambient', 'idm']);
  assert.deepEqual(genreTags(['ambient'], genres), ['ambient', 'electronic', 'idm']);
  const many = Array.from({ length: 8 }, (_, index) => ({ name: `g${index}`, confidence: 0.9 }));
  assert.equal(genreTags([], many).length, 5);
  const full = Array.from({ length: 20 }, (_, index) => `t${index}`);
  assert.deepEqual(genreTags(full, genres), full);
  assert.deepEqual(genreTags(['x'], []), ['x']);
});

test('files whose picker sends no real type are named by their extension, and Opus voice notes are Ogg', () => {
  assert.equal(canonicalAudioType({ name: 'demo.mp3', type: 'application/octet-stream' }), 'audio/mpeg');
  assert.equal(canonicalAudioType({ name: 'demo.MP3', type: '' }), 'audio/mpeg');
  assert.equal(canonicalAudioType({ name: 'note.opus', type: 'audio/ogg' }), 'audio/ogg');
  assert.equal(canonicalAudioType({ name: 'take.ogg', type: 'audio/ogg' }), 'audio/ogg');
});
