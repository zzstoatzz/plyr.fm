import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { jobLine, outputBudget, processingStep, transient, uploadRoute } from '../src/publishing/upload-queue-model.ts';
import { MAX_SERVICE_AUDIO_BYTES, UPLOAD_PART_BYTES, type UploadStatus } from '../src/publishing/upload-model.ts';

const MIB = 1_048_576;

test('small playable audio goes to the PDS; lossless and large go through plyr storage', () => {
  assert.deepEqual(uploadRoute({ name: 'memo.m4a', type: 'audio/x-m4a', size: 2 * MIB }), { kind: 'pds' });
  assert.deepEqual(uploadRoute({ name: 'song.mp3', type: 'audio/mpeg', size: 90 * MIB }), { kind: 'pds' });
  assert.deepEqual(uploadRoute({ name: 'mix.mp3', type: 'audio/mpeg', size: 200 * MIB }), { kind: 'service' });
  for (const [name, type] of [['take.wav', 'audio/wav'], ['take.FLAC', 'audio/flac'], ['take.aiff', 'audio/aiff'], ['take.aif', 'audio/x-aiff'], ['rec.webm', 'audio/webm']]) {
    const route = uploadRoute({ name, type, size: 5 * MIB }, 30);
    assert.equal(route.kind, 'service', name);
    assert.equal(route.kind === 'service' && route.processing?.recipe, 'mp3-320k-44100-v1', name);
  }
  assert.throws(() => uploadRoute({ name: 'huge.wav', type: 'audio/wav', size: MAX_SERVICE_AUDIO_BYTES + 1 }), /1\.5 GiB/);
  assert.throws(() => uploadRoute({ name: 'empty.mp3', type: 'audio/mpeg', size: 0 }), /nonempty/);
  assert.throws(() => uploadRoute({ name: 'big.opus', type: 'audio/opus', size: 200 * MIB }), /choose an/);
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
