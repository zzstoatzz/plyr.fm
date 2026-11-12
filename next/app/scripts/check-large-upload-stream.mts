import { strict as assert } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { MAX_SERVICE_AUDIO_BYTES, UPLOAD_PART_BYTES, transferParts, uploadStatus, type UploadOperation, type UploadReceipt } from '../src/publishing/upload-model.ts';

const full = process.env.LARGE_FULLSIZE === '1';
if (full && process.env.GITHUB_ACTIONS !== 'true') throw new Error('full-size acceptance runs only in cloud CI.');
const size = full ? MAX_SERVICE_AUDIO_BYTES : UPLOAD_PART_BYTES + 13;
const operation: UploadOperation = { owner: 'did:plc:syntheticfixture', collection: 'fm.plyr.dev.track', rkey: '3jzfcijpj2z2a', uri: 'at://did:plc:syntheticfixture/fm.plyr.dev.track/3jzfcijpj2z2a',
  record: { $type: 'fm.plyr.dev.track', title: 'synthetic full-size fixture' }, uploadId: randomUUID(), name: 'synthetic.wav', sizeBytes: size, contentType: 'audio/wav', fileType: 'wav' };
const receipts = new Map<number, string>();
let complete = false, totalBytes = 0, requests = 0, maxRead = 0, readersClosed = 0, peakRss = process.memoryUsage().rss;
const lossPart = full ? 7 : 1;
let dropped = false;
const snapshot = () => ({ state: complete ? 'complete' : 'transferring', recoveryRequired: false, reservedBytes: size, partSizeBytes: UPLOAD_PART_BYTES,
  partCount: Math.ceil(size / UPLOAD_PART_BYTES), receivedParts: [...receipts].map(([number, sha256]) => ({ number, sha256 })),
  reservedDigests: [...receipts].map(([number, sha256]) => ({ number, sha256 })), ...(complete ? { audioUrl: 'https://synthetic.invalid/media/fixture' } : {}) });
const server = createServer(async (request, response) => {
  try {
    if (request.method === 'PUT') {
      const number = Number(request.url?.split('/').at(-1));
      assert.ok(Number.isInteger(number) && number > 0 && number <= Math.ceil(size / UPLOAD_PART_BYTES));
      const expected = Math.min(UPLOAD_PART_BYTES, size - (number - 1) * UPLOAD_PART_BYTES), hash = createHash('sha256');
      let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; assert.ok(bytes <= expected); hash.update(chunk); }
      assert.equal(bytes, expected); assert.ok(!receipts.has(number), 'resume should skip the server-acknowledged part');
      const sha256 = hash.digest('hex'); receipts.set(number, sha256); totalBytes += bytes; requests++;
      if (number === lossPart && !dropped) { dropped = true; request.socket.destroy(); return; }
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ number, sha256 })); return;
    }
    if (request.method === 'POST') { assert.equal(receipts.size, Math.ceil(size / UPLOAD_PART_BYTES)); complete = true; }
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(snapshot()));
  } catch (error) { response.statusCode = 500; response.end(String(error)); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); assert.ok(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`;
const timer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
const reader = () => ({ size, async read(offset: number, length: number) {
  assert.ok(length <= UPLOAD_PART_BYTES); maxRead = Math.max(maxRead, length);
  return new Uint8Array(length).fill((Math.floor(offset / UPLOAD_PART_BYTES) * 17) % 251);
}, close() { readersClosed++; } });
const transport = {
  async status() { return uploadStatus(await (await fetch(origin)).json(), operation); },
  async part(number: number, bytes: Uint8Array<ArrayBuffer>): Promise<UploadReceipt> {
    const response = await fetch(`${origin}/parts/${number}`, { method: 'PUT', body: bytes });
    assert.ok(response.ok); const value: unknown = await response.json();
    assert.ok(value && typeof value === 'object' && 'number' in value && value.number === number && 'sha256' in value && typeof value.sha256 === 'string');
    return { number, sha256: value.sha256 };
  },
  async finish() { return uploadStatus(await (await fetch(origin, { method: 'POST' })).json(), operation); },
};
const hash = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const started = performance.now();
try {
  await assert.rejects(transferParts(operation, reader(), transport, hash, new AbortController().signal, () => {}), /fetch failed/);
  const result = await transferParts(operation, reader(), transport, hash, new AbortController().signal, () => {});
  assert.equal(result.state, 'complete'); assert.equal(totalBytes, size); assert.equal(requests, Math.ceil(size / UPLOAD_PART_BYTES)); assert.equal(readersClosed, 2);
  console.log(JSON.stringify({ environment: 'synthetic loopback HTTP sink; no PDS or R2', bytes: totalBytes, parts: requests, maxReadBytes: maxRead,
    lostAcknowledgementRecovered: dropped, readersClosed, peakRssBytes: peakRss, elapsedMs: Math.round(performance.now() - started) }));
} finally {
  clearInterval(timer); receipts.clear(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
}
