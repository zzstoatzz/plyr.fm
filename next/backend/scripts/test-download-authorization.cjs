const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { identity, serviceToken } = require('../../app/scripts/queue-fixture.cjs');

async function main() {
  const viewer = identity();
  const document = { id: viewer.did, verificationMethod: [{ id: `${viewer.did}#atproto`, type: 'Multikey', controller: viewer.did, publicKeyMultibase: viewer.multibase }], service: [] };
  let hold = true, started;
  const began = new Promise(resolve => { started = resolve; });
  const directory = http.createServer((request, response) => {
    if (hold) { started(); return; }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(document));
  });
  await new Promise(resolve => directory.listen(0, '127.0.0.1', resolve));
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const env = { ...process.env, MODE: 'jams', INDEX_MODE: 'disabled', PORT: String(port), DOCKET_URL: process.env.DOWNLOAD_TEST_REDIS_URL || 'redis://127.0.0.1:6380/0', TRACK_COLLECTION_NSID: 'fm.plyr.dev.track', LIST_COLLECTION_NSID: 'fm.plyr.dev.list', PROFILE_COLLECTION_NSID: 'fm.plyr.dev.actor.profile', LIKE_COLLECTION_NSID: 'fm.plyr.dev.like', PLC_DIRECTORY_URL: `http://127.0.0.1:${directory.address().port}`, DOWNLOAD_AUTH_BUDGET_MS: '400', CORS_ALLOWED_ORIGINS: 'https://next.plyr.fm' };
  assert.equal(new URL(env.DOCKET_URL).hostname, '127.0.0.1');
  for (const key of ['DATABASE_URL', 'WORKER_DATABASE_URL', 'FLY_APP_NAME', 'FLY_PROCESS_GROUP', 'JAM_TEST_MODE', 'JAM_TEST_PDS_ORIGIN', 'UPLOAD_BASE_URL', 'UPLOAD_CAPABILITY_SECRET']) delete env[key];
  const child = spawn(path.resolve(__dirname, '../zig-out/bin/plyr-backend'), [], { env, stdio: ['ignore', 'ignore', 'inherit'] });
  const base = `http://127.0.0.1:${port}`;
  const request = { recordUri: `at://${viewer.did}/fm.plyr.dev.track/3abc`, recordCid: 'bafyreidc7zmv7lj6g63hax6koyclbsbmicrmsh6fqzgkfmg6ju7gxgvcmu', serviceToken: serviceToken(viewer, { lxm: 'fm.plyr.dev.download.authorize' }) };
  const post = body => fetch(`${base}/v1/downloads/authorize`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://next.plyr.fm' }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) });
  try {
    let ready = false;
    for (let n = 0; n < 100 && !ready; n++) {
      try { ready = (await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
      if (!ready) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready);
    const start = performance.now();
    const pending = post(request);
    void pending.catch(() => {});
    await Promise.race([began, new Promise((_, reject) => setTimeout(() => reject(new Error('identity lookup not started')), 2000))]);
    assert.equal((await fetch(`${base}/ready`, { signal: AbortSignal.timeout(500) })).status, 200, 'ready remains responsive while identity stalls');
    assert.equal((await post(request)).status, 503, 'only one download admission');
    const timedOut = await pending;
    assert.equal(timedOut.status, 503);
    assert.equal(timedOut.headers.get('cache-control'), 'no-store');
    assert.ok(performance.now() - start < 2000, 'total budget cancels stalled identity lookup');
    hold = false;
    assert.equal((await post({ ...request, serviceToken: serviceToken(viewer) })).status, 403, 'slot released; Jam token cannot authorize download');
    assert.equal((await post({ ...request, serviceToken: serviceToken(viewer, { key: identity().privateKey, lxm: 'fm.plyr.dev.download.authorize' }) })).status, 403, 'forged viewer signature rejected');
    assert.equal((await post({ ...request, viewer: viewer.did })).status, 400, 'supplied viewer is not accepted');
    assert.equal((await post({ ...request, recordCid: 'invalid' })).status, 400);
    assert.equal((await post({ ...request, serviceToken: serviceToken(viewer, { lxm: 'fm.plyr.dev.download.authorize', aud: 'did:web:other.example#jams' }) })).status, 403);
    console.log('download authorization HTTP: signed viewer scope/audience, input binding, total deadline, isolation and released slot pass');
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => child.once('exit', resolve));
    }
    directory.closeAllConnections();
    await new Promise(resolve => directory.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
