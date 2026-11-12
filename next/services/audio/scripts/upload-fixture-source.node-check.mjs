import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { UPLOAD_PART_BYTES } from '../../../app/src/publishing/upload-model.ts';
import { waveSource, verifyStream, transferFixture } from './upload-fixture-source.mjs';

test('lost acknowledged multipart response resumes with the same receipts', async () => {
  const source = waveSource(UPLOAD_PART_BYTES + 44), receipts = [], writes = [];
  let finishes = 0;
  const status = () => ({ state: 'transferring', recoveryRequired: false, reservedBytes: source.size,
    partSizeBytes: UPLOAD_PART_BYTES, partCount: 2, receivedParts: [...receipts], reservedDigests: [...receipts] });
  const transport = {
    async status() { return status(); },
    async part(number, bytes) {
      writes.push(number);
      const receipt = { number, sha256: createHash('sha256').update(bytes).digest('hex') };
      receipts.push(receipt);
      return receipt;
    },
    async finish() { finishes++; return { ...status(), state: 'complete', audioUrl: 'https://audio.example/media/fixture' }; },
  };
  const result = await transferFixture({ sizeBytes: source.size }, source, transport, true);
  assert.equal(result.finished.state, 'complete');
  assert.equal(result.lostAcknowledgement, true);
  assert.deepEqual(writes, [1, 2]);
  assert.equal(finishes, 1);
  assert.deepEqual(source.metrics(), { maxRead: UPLOAD_PART_BYTES, readersClosed: 2 });
});

test('generated WAV reads stay bounded and reproduce arbitrary ranges', async () => {
  const source = waveSource(UPLOAD_PART_BYTES + 44);
  const header = source.read(0, 44);
  assert.equal(header.toString('ascii', 0, 4), 'RIFF');
  assert.equal(header.readUInt32LE(40), source.size - 44);
  assert.equal(header.readUInt32LE(28), 768000);
  const whole = Buffer.concat([source.read(0, UPLOAD_PART_BYTES), source.read(UPLOAD_PART_BYTES, 44)]);
  for (const offset of [1, 43, 4095, 4096, UPLOAD_PART_BYTES - 10]) {
    assert.deepEqual(source.read(offset, 20), whole.subarray(offset, offset + 20));
  }
  assert.throws(() => source.read(0, UPLOAD_PART_BYTES + 1));
  assert.throws(() => source.read(source.size - 1, 2));
  const reader = source.reader();
  reader.close(); reader.close();
  await assert.rejects(reader.read(0, 1), /closed/);
  assert.equal(source.metrics().readersClosed, 1);
});

test('stream verification rejects truncation and corruption without arrayBuffer', async () => {
  const source = waveSource(4044);
  const response = bytes => {
    const value = new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 40)); controller.enqueue(bytes.subarray(40)); controller.close(); } }));
    value.arrayBuffer = () => { throw new Error('whole-body reads forbidden'); };
    return value;
  };
  const bytes = source.read(0, source.size);
  assert.equal((await verifyStream(response(bytes), source)).sizeBytes, source.size);
  await assert.rejects(verifyStream(response(bytes.subarray(0, -1)), source), /incomplete/);
  bytes[100] ^= 1;
  await assert.rejects(verifyStream(response(bytes), source), /digest mismatch/);
});
