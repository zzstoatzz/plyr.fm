import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';

const requireApp = createRequire(new URL('../../../app/package.json', import.meta.url));
const { TID } = requireApp('@atproto/common-web');
const coordinator = 'https://plyr-jams-next.fly.dev';
const audioOrigin = 'https://plyr-next-audio.n8-3e9.workers.dev';
const collection = 'fm.plyr.track';

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

function wave() {
  const bytes = Buffer.alloc(4044);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(4000, 40);
  return bytes;
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
  const pds = new URL(process.env.ZAT_TEST_PDS);
  assert.ok(pds.protocol === 'https:' && !pds.username && !pds.password, 'invalid fixture PDS');
  const xrpc = method => new URL(`/xrpc/${method}`, pds).href;
  const session = await json(xrpc('com.atproto.server.createSession'), post({ identifier: process.env.ZAT_TEST_HANDLE, password: process.env.ZAT_TEST_PASSWORD }));
  assert.ok(typeof session.did === 'string' && session.did.startsWith('did:'), 'invalid fixture DID');
  assert.ok(typeof session.accessJwt === 'string', 'missing fixture session');
  if (process.env.DIAGNOSE_UPLOAD === 'true') return diagnose(session.did, xrpc);
  const owner = session.did, rkey = TID.nextStr(), uploadId = randomUUID();
  const ownerHash = createHash('sha256').update(owner).digest('hex');
  const object = `plyr-next-audio/uploads/${ownerHash}/${uploadId}`;
  const recordUri = `at://${owner}/${collection}/${rkey}`;
  const expectedUploadUrl = `${audioOrigin}/v1/uploads/${ownerHash}/${uploadId}`;
  const audioUrl = `${audioOrigin}/media/${ownerHash}/${uploadId}`;
  const bytes = wave();
  await deleteObject(object);
  let capability, started = false, finishing = false, completed = false, published = false;
  let failure;
  try {
    const service = new URL(xrpc('com.atproto.server.getServiceAuth'));
    service.searchParams.set('aud', 'did:web:plyr-jams-next.fly.dev#jams');
    service.searchParams.set('lxm', 'fm.plyr.upload.authorize');
    const { token } = await json(service.href, { headers: { authorization: `Bearer ${session.accessJwt}` } });
    assert.ok(typeof token === 'string', 'missing service token');
    const admitted = await json(`${coordinator}/v1/uploads/authorize`, post({ serviceToken: token, uploadId, recordUri, sizeBytes: bytes.length, contentType: 'audio/wav', fileType: 'wav', visibility: 'public', downloadPolicy: 'open' }));
    assert.ok(admitted.uploadUrl === expectedUploadUrl && typeof admitted.capability === 'string', 'unexpected admission binding');
    const expiresInMs = admitted.expiresAt - Date.now();
    assert.ok(Number.isSafeInteger(admitted.expiresAt) && expiresInMs > 0 && expiresInMs <= 300000, 'invalid millisecond capability expiry');
    console.log(JSON.stringify({ admission: { expiresInMs, sizeBytes: bytes.length } }));
    capability = admitted.capability;
    const headers = { authorization: `Bearer ${capability}` };
    await json(expectedUploadUrl, { method: 'POST', headers }); started = true;
    await json(`${expectedUploadUrl}/parts/1`, { method: 'PUT', headers, body: bytes });
    const status = await json(expectedUploadUrl, { headers });
    assert.ok(status.partSizeBytes === 10485760 && status.partCount === 1 && status.reservedBytes === bytes.length && status.recoveryRequired === false, 'invalid transfer status');
    assert.deepEqual(status.reservedDigests, status.receivedParts);
    console.log(JSON.stringify({ status: { partSizeBytes: status.partSizeBytes, partCount: status.partCount, reservedBytes: status.reservedBytes, recoveryRequired: status.recoveryRequired, receivedParts: status.receivedParts, reservedDigests: status.reservedDigests } }));
    assert.ok(status.receivedParts.length === 1 && status.receivedParts[0].sha256 === createHash('sha256').update(bytes).digest('hex'), 'receipt digest mismatch');
    finishing = true;
    const finished = await json(`${expectedUploadUrl}/finish`, { method: 'POST', headers }); completed = true;
    assert.ok(finished.audioUrl === audioUrl, 'unexpected published URL');
    for (const method of ['GET', 'HEAD']) assert.equal((await request(audioUrl, { method })).status, 404);
    const record = { $type: collection, title: `next upload integration-test ${uploadId}`, artist: 'integration test', fileType: 'wav', createdAt: new Date().toISOString(), audioUrl, downloadPolicy: 'open', tags: ['integration-test'] };
    await json(xrpc('com.atproto.repo.createRecord'), post({ repo: owner, collection, rkey, record }, session.accessJwt));
    const activated = await json(`${expectedUploadUrl}/activate`, { method: 'POST', headers });
    assert.ok(activated.state === 'published' && activated.reservedBytes === 0, 'activation did not release quota'); published = true;
    const read = await request(audioUrl);
    assert.equal(read.status, 200); assert.equal(read.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), bytes);
    const head = await request(audioUrl, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(bytes.length));
    const range = await request(audioUrl, { headers: { range: 'bytes=0-43' } });
    assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), `bytes 0-43/${bytes.length}`);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 44));
    console.log('deployed admission, private staging, signed activation, bytes, HEAD and range passed');
  } catch (error) { failure = error; }
  finally {
    const cleanup = [];
    try {
      const deleted = await request(xrpc('com.atproto.repo.deleteRecord'), post({ repo: owner, collection, rkey }, session.accessJwt));
      assert.ok(deleted.ok || (await deleted.json()).error === 'RecordNotFound', 'exact fixture record cleanup failed');
    }
    catch (error) { cleanup.push(error); }
    if (started && !completed) {
      try { await json(expectedUploadUrl, { method: 'DELETE', headers: { authorization: `Bearer ${capability}` } }); }
      catch (error) { cleanup.push(error); }
    }
    try { await deleteObject(object); }
    catch { cleanup.push(new Error('exact fixture R2 cleanup failed')); }
    console.log(`fixture cleanup: exact record and object only; completed=${completed}, published=${published}; receipt metadata retained`);
    if (finishing && !published) console.error('failed activation may retain one 4044-byte quota reservation for fixture recovery');
    if (cleanup.length) throw new AggregateError([...(failure ? [failure] : []), ...cleanup], 'fixture cleanup failed');
  }
  if (failure) throw failure;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
