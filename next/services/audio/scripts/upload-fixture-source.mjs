import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { transferParts, UPLOAD_PART_BYTES } from '../../../app/src/publishing/upload-model.ts';

export async function transferFixture(operation, source, transport, loseReply = false) {
  let lostAcknowledgement = false;
  const lostReply = new Error('deliberately lost acknowledged part');
  const transfer = {
    ...transport,
    async part(number, bytes) {
      const receipt = await transport.part(number, bytes);
      if (loseReply && number === 2 && !lostAcknowledgement) { lostAcknowledgement = true; throw lostReply; }
      return receipt;
    },
  };
  const send = () => transferParts(operation, source.reader(), transfer,
    bytes => createHash('sha256').update(bytes).digest('hex'), AbortSignal.timeout(12 * 60 * 1000), () => {});
  let finished;
  try { finished = await send(); }
  catch (error) { if (error !== lostReply) throw error; finished = await send(); }
  if (loseReply) assert.ok(lostAcknowledgement, 'missing lost acknowledgement exercise');
  return { finished, lostAcknowledgement };
}

export function waveSource(size) {
  assert.ok(Number.isSafeInteger(size) && size >= 44 && size <= 0xffffffff && (size - 44) % 4 === 0);
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(size - 8, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(192000, 24); header.writeUInt32LE(768000, 28);
  header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(size - 44, 40);
  let maxRead = 0, readersClosed = 0;
  function read(offset, length) {
    assert.ok(Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length > 0 && length <= UPLOAD_PART_BYTES && offset + length <= size);
    maxRead = Math.max(maxRead, length);
    const bytes = Buffer.alloc(length);
    if (offset < header.length) header.copy(bytes, 0, offset, Math.min(header.length, offset + length));
    for (let position = Math.max(4096, Math.ceil(offset / 4096) * 4096); position < offset + length; position += 4096) {
      bytes[position - offset] = Math.floor(position / 4096) % 128;
    }
    return bytes;
  }
  return {
    size,
    read,
    reader() {
      let closed = false;
      return {
        size,
        async read(offset, length) { assert.ok(!closed, 'fixture reader closed'); return read(offset, length); },
        close() { if (!closed) readersClosed++; closed = true; },
      };
    },
    sha256() {
      const digest = createHash('sha256');
      for (let offset = 0; offset < size; offset += UPLOAD_PART_BYTES) digest.update(read(offset, Math.min(UPLOAD_PART_BYTES, size - offset)));
      return digest.digest('hex');
    },
    metrics() { return { maxRead, readersClosed }; },
  };
}

export async function verifyStream(response, source) {
  assert.ok(response.body, 'missing audio body');
  const expected = source.sha256(), digest = createHash('sha256');
  const reader = response.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      assert.ok(size <= source.size, 'audio exceeds reservation');
      digest.update(value);
    }
  } finally { await reader.cancel(); }
  assert.equal(size, source.size, 'incomplete audio');
  assert.equal(digest.digest('hex'), expected, 'audio digest mismatch');
  return { sizeBytes: size, sha256: expected, ...source.metrics() };
}
