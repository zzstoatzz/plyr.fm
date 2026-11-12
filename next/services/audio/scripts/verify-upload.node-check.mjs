import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { main } from './verify-upload.mjs';

for (const failure of [undefined, 'part', 'create', 'activate', 'cleanup']) test(`deployed fixture exact cleanup: ${failure ?? 'success'}`, async t => {
  const env = { ZAT_TEST_PDS: 'https://fixture.invalid', ZAT_TEST_HANDLE: 'fixture.invalid', ZAT_TEST_PASSWORD: 'secret', CLOUDFLARE_API_TOKEN: 'secret', CLOUDFLARE_ACCOUNT_ID: 'fixture', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
  let admission, bytes, audioUrl, published = false, deleted, removed, cancelled = false;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const path = new URL(url).pathname;
    const response = (value, status = 200) => Response.json(value, { status });
    const body = () => JSON.parse(init.body);
    if (path.endsWith('createSession')) return response({ did: owner, accessJwt: 'session' });
    if (path.endsWith('getServiceAuth')) return response({ token: 'scoped-token' });
    if (path.endsWith('/authorize')) {
      admission = body();
      const hash = createHash('sha256').update(owner).digest('hex');
      audioUrl = `https://plyr-next-audio.n8-3e9.workers.dev/media/${hash}/${admission.uploadId}`;
      return response({ capability: 'capability', uploadUrl: audioUrl.replace('/media/', '/v1/uploads/') });
    }
    if (path.endsWith('deleteRecord')) { deleted = body(); return response({}); }
    if (path.endsWith('createRecord')) {
      assert.equal(`at://${body().repo}/${body().collection}/${body().rkey}`, admission.recordUri);
      assert.deepEqual(body().record.tags, ['integration-test']);
      if (failure === 'create') throw new TypeError('lost create response');
      return response({});
    }
    if (path.includes('/media/')) {
      if (!published) return new Response(null, { status: 404 });
      if (init.method === 'HEAD') return new Response(null, { headers: { 'content-length': String(bytes.length) } });
      if (init.headers?.range) return new Response(bytes.subarray(0, 44), { status: 206, headers: { 'content-range': `bytes 0-43/${bytes.length}` } });
      return new Response(bytes, { headers: { 'x-content-type-options': 'nosniff' } });
    }
    if (path.endsWith('/parts/1')) { bytes = init.body; return response({}, failure === 'part' ? 503 : 200); }
    if (path.endsWith('/finish')) return response({ audioUrl });
    if (path.endsWith('/activate')) {
      published = failure !== 'activate';
      return response({ state: 'published', reservedBytes: 0 }, published ? 200 : 503);
    }
    if (init.method === 'DELETE') { cancelled = true; return response({}); }
    if (!init.method) return response({ receivedParts: [{ sha256: createHash('sha256').update(bytes).digest('hex') }] });
    return response({});
  });
  let deletes = 0;
  const run = main({ deleteObject: async key => { removed = key; if (++deletes === 2 && failure === 'cleanup') throw new Error('denied'); } });
  if (failure) await assert.rejects(run); else await run;
  assert.equal(`at://${deleted.repo}/${deleted.collection}/${deleted.rkey}`, admission.recordUri);
  assert.equal(removed, `plyr-next-audio/uploads/${createHash('sha256').update(owner).digest('hex')}/${admission.uploadId}`);
  assert.equal(cancelled, failure === 'part');
});

test('fixture refuses nonmanual or nonmain use before network mutations', async t => {
  const env = { ZAT_TEST_PDS: 'https://fixture.invalid', ZAT_TEST_HANDLE: 'fixture.invalid', ZAT_TEST_PASSWORD: 'secret', CLOUDFLARE_API_TOKEN: 'secret', CLOUDFLARE_ACCOUNT_ID: 'fixture', GITHUB_REF: 'refs/heads/not-main', GITHUB_EVENT_NAME: 'workflow_dispatch' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  let called = false;
  t.mock.method(globalThis, 'fetch', async () => { called = true; throw new Error('unexpected request'); });
  await assert.rejects(main(), /manual main-only fixture/);
  assert.equal(called, false);
});
