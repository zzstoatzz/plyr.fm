import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { MAX_SERVICE_AUDIO_BYTES, UPLOAD_PART_BYTES } from '../../../app/src/publishing/upload-model.ts';
import { createUploadTransport } from '../../../app/src/publishing/upload-transport.ts';
import { waveSource, verifyStream, transferFixture } from './upload-fixture-source.mjs';

const requireApp = createRequire(new URL('../../../app/package.json', import.meta.url));
const { TID } = requireApp('@atproto/common-web');
const coordinator = 'https://plyr-jams-next.fly.dev';
const audioOrigin = 'https://plyr-next-audio.n8-3e9.workers.dev';
const collection = 'fm.plyr.track';

export function fixtureIdentity(env = process.env) {
  const uploadId = env.RESUME_UPLOAD_ID || '', rkey = env.RESUME_RECORD_RKEY || '';
  if (!uploadId && !rkey) return { uploadId: randomUUID(), rkey: TID.nextStr(), resume: false };
  assert.ok(env.VERIFY_UPLOAD_FULLSIZE === 'true', 'resume requires the full-size fixture');
  assert.match(uploadId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.match(rkey, /^[234567abcdefghijklmnopqrstuvwxyz]{13}$/);
  return { uploadId, rkey, resume: true };
}

async function request(url, init = {}) {
  return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) });
}

async function json(url, init = {}) {
  const response = await request(url, init);
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const known = ['record authority unavailable', 'invalid authority response', 'upload unavailable'];
    const reason = known.includes(failure.error) ? ` (${failure.error})` : '';
    throw new Error(`${new URL(url).pathname}: HTTP ${response.status}${reason}`);
  }
  return response.json();
}

function post(value, token) {
  return { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(value) };
}

async function bounded(url, maximum) {
  const response = await request(url);
  assert.ok(response.ok, `${new URL(url).pathname}: HTTP ${response.status}`);
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      assert.ok(length <= maximum, 'public diagnostic response too large');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

async function diagnose(owner, xrpc) {
  const output = 'upload-diagnostic';
  await mkdir(output, { recursive: true });
  let stage = 'public identity';
  try {
    assert.ok(owner.startsWith('did:plc:'), 'diagnostic supports the configured PLC fixture account');
    const document = JSON.parse(await bounded(`https://plc.directory/${encodeURIComponent(owner)}`, 65536));
    assert.ok(document.id === owner, 'identity mismatch');
    const endpoint = document.service?.find(item => item.id === '#atproto_pds' || item.id === `${owner}#atproto_pds`)?.serviceEndpoint;
    assert.ok(typeof endpoint === 'string' && new URL(endpoint).protocol === 'https:', 'missing public PDS endpoint');
    assert.ok(!new URL(endpoint).username && !new URL(endpoint).password, 'public PDS endpoint must not contain credentials');
    await writeFile(`${output}/identity.json`, JSON.stringify({ id: owner, endpoint, verificationMethod: document.verificationMethod }));
    stage = 'public collections';
    const described = JSON.parse(await bounded(`${xrpc('com.atproto.repo.describeRepo')}?repo=${encodeURIComponent(owner)}`, 65536));
    assert.ok(Array.isArray(described.collections), 'missing collections');
    const collections = [...new Set([collection, ...described.collections])].slice(0, 3);
    for (const candidate of collections) {
      assert.ok(typeof candidate === 'string', 'invalid collection');
      stage = 'public record listing';
      const listing = JSON.parse(await bounded(`${xrpc('com.atproto.repo.listRecords')}?repo=${encodeURIComponent(owner)}&collection=${encodeURIComponent(candidate)}&limit=1`, 1024 * 1024));
      assert.ok(Array.isArray(listing.records), 'missing records');
      if (!listing.records.length) continue;
      const record = listing.records[0];
      const prefix = `at://${owner}/${candidate}/`;
      assert.ok(typeof record.uri === 'string' && record.uri.startsWith(prefix), 'unexpected public record URI');
      const key = record.uri.slice(prefix.length);
      stage = 'public record proof';
      const proof = await bounded(`${endpoint}/xrpc/com.atproto.sync.getRecord?did=${encodeURIComponent(owner)}&collection=${encodeURIComponent(candidate)}&rkey=${encodeURIComponent(key)}`, 4 * 1024 * 1024);
      await writeFile(`${output}/record.car`, proof);
      await writeFile(`${output}/record.json`, JSON.stringify({ uri: record.uri, cid: record.cid, bytes: proof.length }));
      console.log(`read-only public proof captured: ${proof.length} bytes; no records or uploads created`);
      return;
    }
    console.log('read-only diagnostic: no record in the three bounded public collections');
  } catch (error) {
    await writeFile(`${output}/failure.json`, JSON.stringify({ stage, error: error.name, message: error.message }));
    throw error;
  }
}

function deleteFixtureObject(object) {
  try { execFileSync('npx', ['--no-install', 'wrangler', 'r2', 'object', 'delete', object, '--remote'], { stdio: 'pipe', timeout: 60000 }); }
  catch { throw new Error('fixture R2 cleanup requires object-delete permission'); }
}

export async function main({ deleteObject = deleteFixtureObject } = {}) {
  for (const name of ['ZAT_TEST_PDS', 'ZAT_TEST_HANDLE', 'ZAT_TEST_PASSWORD', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) assert.ok(process.env[name], `missing ${name}`);
  assert.ok(process.env.GITHUB_REF === 'refs/heads/main' && process.env.GITHUB_EVENT_NAME === 'workflow_dispatch', 'manual main-only fixture');
  const fullSize = process.env.VERIFY_UPLOAD_FULLSIZE === 'true';
  if (fullSize) assert.ok(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_OS === 'Linux', 'full-size fixture is cloud-only');
  const identity = fixtureIdentity();
  const pds = new URL(process.env.ZAT_TEST_PDS);
  assert.ok(pds.protocol === 'https:' && !pds.username && !pds.password, 'invalid fixture PDS');
  const xrpc = method => new URL(`/xrpc/${method}`, pds).href;
  const session = await json(xrpc('com.atproto.server.createSession'), post({ identifier: process.env.ZAT_TEST_HANDLE, password: process.env.ZAT_TEST_PASSWORD }));
  assert.ok(typeof session.did === 'string' && session.did.startsWith('did:'), 'invalid fixture DID');
  assert.ok(typeof session.accessJwt === 'string', 'missing fixture session');
  if (process.env.DIAGNOSE_UPLOAD === 'true') return diagnose(session.did, xrpc);
  const owner = session.did, { rkey, uploadId, resume } = identity;
  const ownerHash = createHash('sha256').update(owner).digest('hex');
  const object = `plyr-next-audio/uploads/${ownerHash}/${uploadId}`;
  const recordUri = `at://${owner}/${collection}/${rkey}`;
  const expectedUploadUrl = `${audioOrigin}/v1/uploads/${ownerHash}/${uploadId}`;
  const audioUrl = `${audioOrigin}/media/${ownerHash}/${uploadId}`;
  const source = waveSource(fullSize ? MAX_SERVICE_AUDIO_BYTES : 4044);
  const operation = { owner, collection, rkey, uri: recordUri, uploadId, name: 'fixture.wav', sizeBytes: source.size, contentType: 'audio/wav', fileType: 'wav', record: {} };
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const auth = { did: owner, uploadStorage: true, agent: {
    handle(path, init) {
      const endpoint = new URL(path, pds);
      assert.equal(endpoint.origin, pds.origin);
      assert.equal(endpoint.pathname, '/xrpc/com.atproto.server.getServiceAuth');
      return request(endpoint.href, { ...init, headers: { authorization: `Bearer ${session.accessJwt}` } });
    },
  } };
  const observedFetch = async (url, init) => {
    const response = await fetch(url, init);
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      const known = ['record authority unavailable', 'invalid authority response', 'upload unavailable', 'upload operation in progress', 'upload not accepting parts', 'part differs from reserved bytes', 'upload reservation mismatch', 'completed upload requires publication recovery'];
      console.log(JSON.stringify({ failedRequest: { method: init.method, path: new URL(url).pathname, status: response.status, error: known.includes(failure.error) ? failure.error : 'upload request failed' } }));
      return Response.json({ error: known.includes(failure.error) ? failure.error : 'upload request failed' }, { status: response.status });
    }
    if (String(url) === `${coordinator}/v1/uploads/authorize` && response.ok) {
      const admission = await response.clone().json();
      const expiresInMs = admission.expiresAt - Date.now();
      assert.equal(admission.uploadUrl, expectedUploadUrl);
      assert.ok(Number.isSafeInteger(admission.expiresAt) && expiresInMs > 0 && expiresInMs <= 300000);
      console.log(JSON.stringify({ admission: { expiresInMs, sizeBytes: source.size } }));
    }
    return response;
  };
  const makeTransport = (timeout = 12 * 60 * 1000) => createUploadTransport(auth, operation, () => {}, AbortSignal.timeout(timeout), observedFetch);
  const transport = makeTransport();
  const artifact = fullSize ? 'upload-acceptance/reservation.json' : null;
  if (artifact) {
    await mkdir('upload-acceptance', { recursive: true });
    await writeFile(artifact, JSON.stringify({ owner, uploadId, recordUri, object, sizeBytes: source.size }));
  }
  if (!resume) await deleteObject(object);
  let resumedParts = 0;
  if (resume) {
    const existing = await transport.status();
    assert.equal(existing.state, 'transferring', 'resume only an unfinished fixture');
    const record = await request(`${xrpc('com.atproto.repo.getRecord')}?${new URLSearchParams({ repo: owner, collection, rkey })}`);
    assert.equal(record.status, 400);
    assert.equal((await record.json()).error, 'RecordNotFound', 'resume requires absent canonical record');
    resumedParts = existing.receivedParts.length;
    console.log(JSON.stringify({ resumedParts, uploadId, recordUri }));
  }
  let started = false, completed = false, published = false, cancelled = false;
  let failure;
  try {
    started = true;
    if (!resume) await transport.start();
    const transfer = {
      status: transport.status,
      part: transport.part,
      async finish() {
        const status = await transport.finish(); completed = true;
        return status;
      },
    };
    const { finished, lostAcknowledgement } = await transferFixture(operation, source, transfer, fullSize && !resume);
    assert.equal(finished.audioUrl, audioUrl);
    const status = await transport.status();
    assert.equal(status.partSizeBytes, UPLOAD_PART_BYTES);
    assert.equal(status.partCount, Math.ceil(source.size / UPLOAD_PART_BYTES));
    assert.equal(status.reservedBytes, source.size);
    assert.equal(status.recoveryRequired, false);
    assert.deepEqual(status.reservedDigests, status.receivedParts);
    assert.equal(status.receivedParts.length, status.partCount);
    for (const part of status.receivedParts) {
      const offset = (part.number - 1) * UPLOAD_PART_BYTES;
      assert.equal(part.sha256, digest(source.read(offset, Math.min(UPLOAD_PART_BYTES, source.size - offset))));
    }
    console.log(JSON.stringify({ status: { partSizeBytes: status.partSizeBytes, partCount: status.partCount, reservedBytes: status.reservedBytes, recoveryRequired: status.recoveryRequired, receiptCount: status.receivedParts.length } }));
    for (const method of ['GET', 'HEAD']) assert.equal((await request(audioUrl, { method })).status, 404);
    const record = { $type: collection, title: `next upload integration-test ${uploadId}`, artist: 'integration test', fileType: 'wav', createdAt: new Date().toISOString(), audioUrl, downloadPolicy: 'open', tags: ['integration-test'] };
    await json(xrpc('com.atproto.repo.createRecord'), post({ repo: owner, collection, rkey, record }, session.accessJwt));
    const activated = await transport.activate();
    assert.ok(activated.state === 'published' && activated.reservedBytes === 0, 'activation did not release quota'); published = true;
    const read = await fetch(audioUrl, { redirect: 'error', signal: AbortSignal.timeout(5 * 60 * 1000) });
    assert.equal(read.status, 200); assert.equal(read.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(read.headers.get('content-disposition'), null);
    const verified = await verifyStream(read, source);
    const downloadUrl = `${audioUrl}?download=1`;
    const head = await request(downloadUrl, { method: 'HEAD', headers: { origin: 'https://next.plyr.fm' } });
    assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(source.size));
    assert.equal(head.headers.get('content-disposition'), 'attachment; filename="audio.wav"');
    assert.equal(head.headers.get('access-control-allow-origin'), '*');
    assert.ok(head.headers.get('access-control-expose-headers')?.split(',').map(value => value.trim().toLowerCase()).includes('content-disposition'));
    const range = await request(downloadUrl, { headers: { range: 'bytes=0-43' } });
    assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), `bytes 0-43/${source.size}`);
    assert.equal(range.headers.get('content-disposition'), 'attachment; filename="audio.wav"');
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), source.read(0, 44));
    const receipt = { ...verified, partCount: status.partCount, resumedParts, lostAcknowledgement, peakRssBytes: process.resourceUsage().maxRSS * 1024 };
    if (artifact) await writeFile('upload-acceptance/receipt.json', JSON.stringify(receipt));
    console.log(JSON.stringify(receipt));
    console.log('deployed client transfer, signed activation, streaming bytes, attachment HEAD and range passed');
  } catch (error) { failure = error; }
  finally {
    const cleanup = [];
    try {
      const deleted = await request(xrpc('com.atproto.repo.deleteRecord'), post({ repo: owner, collection, rkey }, session.accessJwt));
      assert.ok(deleted.ok || (await deleted.json()).error === 'RecordNotFound', 'exact fixture record cleanup failed');
    }
    catch (error) { cleanup.push(error); }
    if (started && !completed) {
      try {
        const status = await makeTransport(20000).cancel();
        assert.ok(status.state === 'cancelled' && status.reservedBytes === 0, 'fixture cancellation is unresolved');
        cancelled = true;
      }
      catch (error) { cleanup.push(error); }
    }
    try { await deleteObject(object); }
    catch { cleanup.push(new Error('exact fixture R2 cleanup failed')); }
    console.log(`fixture cleanup: exact record and object only; completed=${completed}, published=${published}; receipt metadata retained`);
    const retainedQuotaPossible = started && !published && !cancelled;
    if (retainedQuotaPossible) console.error(`failed fixture may retain one ${source.size}-byte quota reservation; do not start another full-size fixture`);
    if (artifact) await writeFile('upload-acceptance/cleanup.json', JSON.stringify({ completed, published, cancelled, retainedQuotaPossible, cleanupFailed: cleanup.length > 0 }));
    if (cleanup.length) throw new AggregateError([...(failure ? [failure] : []), ...cleanup], 'fixture cleanup failed');
  }
  if (failure) throw failure;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
