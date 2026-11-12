import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createUploadTransport, UploadRequestError } from '../src/publishing/upload-transport.ts';
import { audioFormat, MAX_SERVICE_AUDIO_BYTES, UPLOAD_PART_BYTES, transferParts, uploadOperation, uploadStatus, uploadPublication, type UploadOperation } from '../src/publishing/upload-model.ts';
import { hasUploadGrant, UPLOAD_SCOPE, SYNC_SCOPE, SCOPE_PARTS, SYNC_SCOPE_PARTS } from '../src/auth-config.ts';

const operation: UploadOperation = { owner: 'did:plc:fixture', collection: 'fm.plyr.track', rkey: '3jzfcijpj2z2a', uri: 'at://did:plc:fixture/fm.plyr.track/3jzfcijpj2z2a',
  record: { $type: 'fm.plyr.track', title: 'fixture', artist: 'fixture', fileType: 'mp3', createdAt: '2026-11-12T00:00:00Z' },
  uploadId: '12345678-1234-4123-8123-123456789abc', name: 'fixture.mp3', sizeBytes: 25, fileType: 'mp3', contentType: 'audio/mpeg' };
const hash = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function fixture(input = operation) {
  const receipts = new Map<number, string>(), reserved = new Map<number, string>();
  const calls: { method: string; path: string; size: number }[] = [];
  const flags = { current: true, lostPart: false, lostFinish: false, rejectCapability: false, processingReady: false };
  let state = 'transferring', authorizations = 0, grants = 0;
  const base = `https://audio.fixture/v1/uploads/${'a'.repeat(64)}/${input.uploadId}`;
  const audioUrl = base.replace('/v1/uploads/', '/media/');
  const status = () => ({ state, processing: input.processing, recoveryRequired: false, reservedBytes: ['published', 'cancelled'].includes(state) ? 0 : input.sizeBytes + (input.processing?.outputBudget ?? 0), partSizeBytes: UPLOAD_PART_BYTES, partCount: Math.ceil(input.sizeBytes / UPLOAD_PART_BYTES),
    receivedParts: [...receipts].map(([number, sha256]) => ({ number, sha256 })), reservedDigests: [...reserved].map(([number, sha256]) => ({ number, sha256 })),
    ...(['complete', 'published'].includes(state) ? { audioUrl, ...(input.processing ? { rendition: { fileType: 'mp3', contentType: 'audio/mpeg', duration: 1, sizeBytes: 10 } } : {}) } : {}) });
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname, method = init?.method ?? 'GET';
    if (path === '/v1/uploads/authorize') {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.recordUri, input.uri); assert.equal(body.uploadId, input.uploadId);
      assert.equal(body.visibility, 'public'); assert.equal(body.downloadPolicy, 'open');
      assert.deepEqual(body.processing, input.processing);
      assert.equal(body.serviceToken, 'service-fixture'); authorizations++;
      return Response.json({ uploadUrl: base, capability: 'ephemeral-' + authorizations, expiresAt: Date.now() + 300000 });
    }
    assert.ok(String(url).startsWith(base));
    const bytes = init?.body instanceof Uint8Array ? init.body : undefined;
    calls.push({ method, path, size: bytes?.byteLength ?? 0 });
    if (flags.rejectCapability) { flags.rejectCapability = false; return Response.json({}, { status: 403 }); }
    if (method === 'PUT') {
      const number = Number(path.split('/').at(-1));
      assert.ok(bytes); assert.ok(bytes.byteLength <= UPLOAD_PART_BYTES);
      const sha256 = await hash(bytes);
      if (reserved.has(number) && reserved.get(number) !== sha256) return Response.json({ error: 'part differs from reserved bytes' }, { status: 409 });
      reserved.set(number, sha256); receipts.set(number, sha256);
      if (flags.lostPart) { flags.lostPart = false; throw new TypeError('lost part response'); }
      return Response.json({ number, sha256 });
    }
    if (path.endsWith('/finish')) {
      assert.equal(receipts.size, Math.ceil(input.sizeBytes / UPLOAD_PART_BYTES));
      state = input.processing && !flags.processingReady ? 'processing' : 'complete';
      if (flags.lostFinish) { flags.lostFinish = false; throw new TypeError('lost finish response'); }
    }
    if (path.endsWith('/activate')) state = 'published';
    if (method === 'DELETE') {
      if (state === 'complete') return Response.json({ error: 'completed upload requires publication recovery' }, { status: 409 });
      state = 'cancelled';
    }
    return Response.json(status());
  };
  const auth = { did: input.owner, uploadStorage: true, agent: { async handle(url: string) {
    const request = new URL(url, 'https://pds.fixture');
    assert.equal(request.pathname, '/xrpc/com.atproto.server.getServiceAuth');
    assert.equal(request.searchParams.get('lxm'), 'fm.plyr.upload.authorize'); grants++;
    return Response.json({ token: 'service-fixture' });
  } } };
  const assertCurrent = () => { if (!flags.current) throw new Error('account changed'); };
  const connect = (signal = new AbortController().signal) => createUploadTransport(auth, input, assertCurrent, signal, fetcher);
  return { connect, calls, flags, reserved, receipts, auth, status, counts: () => ({ grants, authorizations }) };
}
function reader(size: number, byte = 17) {
  const reads: { offset: number; length: number }[] = []; let closed = false;
  return { reads, closed: () => closed, source: { size, async read(offset: number, length: number) { reads.push({ offset, length }); return new Uint8Array(length).fill(byte); }, close() { closed = true; } } };
}

test('dedicated upload grant is advertised and requested without borrowing Jam permission', () => {
  assert.ok(hasUploadGrant(UPLOAD_SCOPE)); assert.ok(!hasUploadGrant(SYNC_SCOPE));
  assert.ok(SCOPE_PARTS.includes(UPLOAD_SCOPE)); assert.ok(SYNC_SCOPE_PARTS.includes(UPLOAD_SCOPE));
  assert.ok(!hasUploadGrant(UPLOAD_SCOPE.replace('aud=', 'other=')));
});
test('upload metadata validates limits and account without retaining credentials or media', () => {
  assert.equal(uploadOperation({ ...operation, sizeBytes: MAX_SERVICE_AUDIO_BYTES }, operation.owner).sizeBytes, MAX_SERVICE_AUDIO_BYTES);
  assert.throws(() => uploadOperation({ ...operation, sizeBytes: MAX_SERVICE_AUDIO_BYTES + 1 }, operation.owner));
  assert.throws(() => uploadOperation(operation, 'did:plc:other'));
  assert.deepEqual(audioFormat('audio.WAV', 'audio/x-wav'), { fileType: 'wav', contentType: 'audio/wav' });
  assert.throws(() => audioFormat('audio.mp3', 'audio/wav'));
});
test('persisted uploads never downgrade restricted policies or protected sources', () => {
  for (const fields of [
    ...['off', 'ask', 'supporters', 'future-policy', null].map(downloadPolicy => ({ downloadPolicy })),
    ...['private', 'unlisted', 'supporters', 'future-policy', null].map(visibility => ({ visibility })),
    ...['audioBlob', 'audioSpace', 'audioFileId', 'supportGate', 'audioPayload', 'privateAudio', 'originalAudioBlob', 'originalFileId', 'originalFileType'].map(key => ({ [key]: null })),
  ]) assert.throws(() => uploadOperation({ ...operation, record: { ...operation.record, ...fields } }, operation.owner), /public, open audio only/);
  assert.equal(uploadOperation({ ...operation, record: { ...operation.record, downloadPolicy: 'open', visibility: 'public', futureMetadata: true } }, operation.owner).record.futureMetadata, true);
});
test('sequential reads are bounded at10MiB including the final part and release the reader', async () => {
  const input = { ...operation, sizeBytes: UPLOAD_PART_BYTES + 13 }, f = fixture(input), r = reader(input.sizeBytes), signal = new AbortController().signal;
  const result = await transferParts(input, r.source, f.connect(signal), hash, signal, () => {});
  assert.equal(result.state, 'complete'); assert.ok(r.closed());
  assert.deepEqual(r.reads, [{ offset: 0, length: UPLOAD_PART_BYTES }, { offset: UPLOAD_PART_BYTES, length: 13 }]);
  assert.deepEqual(f.calls.filter(call => call.method === 'PUT').map(call => call.size), [UPLOAD_PART_BYTES, 13]);
});
test('lost part acknowledgement resumes by checking every server digest before new bytes', async () => {
  const f = fixture(); f.flags.lostPart = true;
  const first = reader(operation.sizeBytes);
  await assert.rejects(transferParts(operation, first.source, f.connect(), hash, new AbortController().signal, () => {}), /lost part/);
  const mismatch = reader(operation.sizeBytes, 18), before = f.calls.filter(call => call.method === 'PUT').length;
  await assert.rejects(transferParts(operation, mismatch.source, f.connect(), hash, new AbortController().signal, () => {}), /differs/);
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, before);
  assert.ok(mismatch.closed());
  const same = reader(operation.sizeBytes);
  assert.equal((await transferParts(operation, same.source, f.connect(), hash, new AbortController().signal, () => {})).state, 'complete');
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, before, 'acknowledged bytes are not uploaded again');
});
test('reserved digest without a receipt still protects uncertain bytes', async () => {
  const f = fixture(); f.reserved.set(1, await hash(new Uint8Array(operation.sizeBytes).fill(17)));
  await assert.rejects(transferParts(operation, reader(operation.sizeBytes, 18).source, f.connect(), hash, new AbortController().signal, () => {}), /differs/);
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 0);
});
test('lost completion response recovers the stable audio URL and cancellation conflict stays explicit', async () => {
  const f = fixture(); f.flags.lostFinish = true;
  await assert.rejects(transferParts(operation, reader(operation.sizeBytes).source, f.connect(), hash, new AbortController().signal, () => {}), /lost finish/);
  const status = await f.connect().status(); assert.equal(status.state, 'complete');
  await assert.rejects(f.connect().cancel(), error => error instanceof UploadRequestError && error.status === 409 && error.message.includes('publication recovery'));
  assert.equal((await f.connect().status()).audioUrl, status.audioUrl);
});
test('expired capability refreshes with the dedicated grant; account change prevents refresh and bytes', async () => {
  const f = fixture(); f.flags.rejectCapability = true;
  await f.connect().status(); assert.deepEqual(f.counts(), { grants: 2, authorizations: 2 });
  f.flags.current = false;
  await assert.rejects(f.connect().start(), /account changed/);
  assert.deepEqual(f.counts(), { grants: 2, authorizations: 2 });
});
test('pause after a read closes the file without sending that part', async () => {
  const f = fixture(), abort = new AbortController(), r = reader(operation.sizeBytes);
  const read = r.source.read;
  r.source.read = async (offset, length) => { const result = await read(offset, length); abort.abort(); return result; };
  await assert.rejects(transferParts(operation, r.source, f.connect(abort.signal), hash, abort.signal, () => {}), /paused/);
  assert.ok(r.closed()); assert.equal(f.calls.filter(call => call.method === 'PUT').length, 0);
});

test('processing recovery preserves the recipe and original identity without reading the file again', async () => {
  const input: UploadOperation = { ...operation, name: 'original.aiff', fileType: 'aiff', contentType: 'audio/aiff',
    processing: { recipe: 'mp3-320k-44100-v1', outputBudget: 128 }, record: { ...operation.record, fileType: 'aiff', futureMetadata: true } };
  assert.deepEqual(uploadOperation(JSON.parse(JSON.stringify(input)), input.owner), input);
  assert.deepEqual(audioFormat(input.name, 'audio/x-aiff', true), { fileType: 'aiff', contentType: 'audio/aiff' });
  const f = fixture(input), first = reader(input.sizeBytes);
  const processing = await transferParts(input, first.source, f.connect(), hash, new AbortController().signal, () => {});
  assert.equal(processing.state, 'processing'); assert.equal(processing.audioUrl, undefined);
  assert.throws(() => uploadPublication(input, processing), /not ready/);
  const pending = reader(input.sizeBytes);
  assert.equal((await transferParts(input, pending.source, f.connect(), hash, new AbortController().signal, () => {})).state, 'processing');
  assert.equal(pending.reads.length, 0); assert.ok(pending.closed());
  f.flags.processingReady = true;
  const completed = await f.connect().finish(), publication = uploadPublication(input, completed);
  assert.equal(publication.uri, input.uri); assert.equal(publication.rkey, input.rkey);
  assert.deepEqual(publication.record, { ...input.record, fileType: 'mp3', duration: 1 });
  assert.equal(input.record.fileType, 'aiff');
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
});

test('processing status rejects a changed recipe, incomplete artifact and prematurely public URL', () => {
  const input: UploadOperation = { ...operation, processing: { recipe: 'mp3-320k-44100-v1', outputBudget: 128 } };
  const f = fixture(input), value = f.status();
  assert.throws(() => uploadStatus({ ...value, processing: { ...input.processing, outputBudget: 129 } }, input), /differs/);
  assert.throws(() => uploadStatus({ ...value, audioUrl: 'https://audio.fixture/media/early' }, input), /unfinished/);
  assert.throws(() => uploadStatus({ ...value, state: 'complete', audioUrl: 'https://audio.fixture/media/ready' }, input), /no playback rendition/);
  for (const rendition of [
    { fileType: 'mp3', contentType: 'audio/mpeg', duration: -1, sizeBytes: 10 },
    { fileType: 'mp3', contentType: 'audio/mpeg', duration: 1, sizeBytes: 129 },
    { fileType: 'aiff', contentType: 'audio/aiff', duration: 1, sizeBytes: 10 },
  ]) assert.throws(() => uploadStatus({ ...value, rendition }, input), /invalid playback/);
  assert.throws(() => uploadOperation({ ...input, processing: { ...input.processing, outputBudget: 2 * MAX_SERVICE_AUDIO_BYTES } }, input.owner), /reservation/);
  assert.throws(() => uploadOperation({ ...input, processing: { recipe: 'unknown', outputBudget: 128 } }, input.owner), /reservation/);
  assert.equal(uploadStatus({ ...value, state: 'processing', recoveryRequired: true, processingFailure: 'output_budget_exceeded' }, input).processingFailure, 'output_budget_exceeded');
  assert.throws(() => uploadStatus({ ...value, state: 'processing', processingFailure: 'arbitrary upstream message' }, input), /invalid processing failure/);
});
