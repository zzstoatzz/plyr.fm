import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { main } from './verify-upload.mjs';

for (const failed of [false, true]) test(`processing fixture ${failed ? 'retains active originals on failure' : 'cleans only the published generation'}`, async t => {
  const env = { ZAT_TEST_PDS: 'https://fixture.invalid', ZAT_TEST_HANDLE: 'fixture.invalid', ZAT_TEST_PASSWORD: 'secret', CLOUDFLARE_API_TOKEN: 'secret', CLOUDFLARE_ACCOUNT_ID: 'fixture', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux', VERIFY_UPLOAD_PROCESSING: 'true' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const cwd = process.cwd(), directory = await mkdtemp(join(tmpdir(), 'processing-cleanup-'));
  Object.assign(process.env, env); process.chdir(directory);
  t.after(async () => { process.chdir(cwd); await rm(directory, { recursive: true }); for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', hash = createHash('sha256').update(owner).digest('hex');
  const deleted = [];
  let admission, bytes, finished = false, published = false, record, removedRecord, verified = false;
  const url = () => `https://plyr-next-audio.n8-3e9.workers.dev/media/${hash}/${admission.uploadId}`;
  const status = () => {
    const state = published ? 'published' : finished ? failed ? 'processing' : 'complete' : 'transferring';
    const parts = bytes ? [{ number: 1, sha256: createHash('sha256').update(bytes).digest('hex') }] : [];
    return { state, partSizeBytes: 10485760, partCount: 1, reservedBytes: published ? 0 : admission.sizeBytes + admission.processing.outputBudget,
      recoveryRequired: failed && finished, receivedParts: parts, reservedDigests: parts, processing: admission.processing,
      ...(finished ? { processingGeneration: 1 } : {}), ...(failed && finished ? { processingFailure: 'output_budget_exceeded' } : {}),
      ...(['complete', 'published'].includes(state) ? { audioUrl: url(), rendition: { fileType: 'mp3', contentType: 'audio/mpeg', duration: 1, sizeBytes: 40000 } } : {}) };
  };
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const path = new URL(input).pathname;
    const body = () => JSON.parse(init.body);
    if (path.endsWith('createSession')) return Response.json({ did: owner, accessJwt: 'session' });
    if (path.endsWith('getServiceAuth')) return Response.json({ token: 'scoped-token' });
    if (path.endsWith('/authorize')) { admission = body(); return Response.json({ capability: 'capability', expiresAt: Date.now() + 299000, uploadUrl: url().replace('/media/', '/v1/uploads/') }); }
    if (path.endsWith('createRecord')) { record = body(); return Response.json({}); }
    if (path.endsWith('deleteRecord')) { removedRecord = body(); return Response.json({}); }
    if (path.includes('/media/')) { assert.equal(published, false); return new Response(null, { status: 404 }); }
    if (path.endsWith('/parts/1')) { bytes = init.body; return Response.json(status().receivedParts[0]); }
    if (path.endsWith('/finish')) finished = true;
    if (path.endsWith('/activate')) published = true;
    assert.notEqual(init.method, 'DELETE', 'completed processing cannot be cancelled');
    return Response.json(status());
  });
  const result = main({ deleteObject: async key => { deleted.push(key); }, verifyProcessing: async (audioUrl, source, rendition) => {
    assert.equal(audioUrl, url()); assert.equal(source.size, 768044); assert.equal(rendition.fileType, 'mp3');
    verified = true; return { verified: true };
  } });
  if (failed) await assert.rejects(result, /output_budget_exceeded/); else await result;
  const original = `plyr-next-audio/uploads/${hash}/${admission.uploadId}`;
  assert.deepEqual(deleted, failed ? [original] : [original, `plyr-next-audio/processing/${hash}/${admission.uploadId}/1`, original]);
  assert.equal(verified, !failed);
  assert.equal(`at://${removedRecord.repo}/${removedRecord.collection}/${removedRecord.rkey}`, admission.recordUri);
  if (!failed) { assert.equal(record.record.fileType, 'mp3'); assert.equal(record.record.duration, 1); assert.equal(record.rkey, removedRecord.rkey); }
  const cleanup = JSON.parse(await readFile('upload-acceptance/cleanup.json', 'utf8'));
  assert.equal(cleanup.retainedQuotaPossible, failed);
  assert.equal(cleanup.published, !failed);
  assert.equal(cleanup.cleanupFailed, false);
});
