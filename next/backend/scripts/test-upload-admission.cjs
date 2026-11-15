const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHmac, randomUUID, randomBytes } = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { identity, serviceToken } = require('../../app/scripts/queue-fixture.cjs');

async function main() {
  const owner = identity(), paused = identity();
  paused.did = 'did:plc:so3ysj7gypel6w7mixdfjhkh';
  const documents = new Map([owner, paused].map(account => [account.did, {
    id: account.did, verificationMethod: [{ id: `${account.did}#atproto`, type: 'Multikey', controller: account.did, publicKeyMultibase: account.multibase }], service: [],
  }]));
  let hold = false;
  const held = [];
  let bothHeld;
  const heldReady = new Promise(resolve => { bothHeld = resolve; });
  const directory = http.createServer((request, response) => {
    const document = documents.get(decodeURIComponent(request.url.slice(1)));
    const respond = () => response.writeHead(document ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(document ?? {}));
    if (hold && document?.id === owner.did) { held.push(respond); if (held.length === 2) bothHeld(); }
    else respond();
  });
  await new Promise(resolve => directory.listen(0, '127.0.0.1', resolve));
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const secret = randomBytes(32).toString('hex');
  const environment = { ...process.env, MODE: 'jams', INDEX_MODE: 'disabled', PORT: String(port), DOCKET_URL: process.env.UPLOAD_TEST_REDIS_URL || 'redis://127.0.0.1:6380/0', TRACK_COLLECTION_NSID: 'fm.plyr.dev.track', LIST_COLLECTION_NSID: 'fm.plyr.dev.list', PROFILE_COLLECTION_NSID: 'fm.plyr.dev.actor.profile', LIKE_COLLECTION_NSID: 'fm.plyr.dev.like', PLC_DIRECTORY_URL: `http://127.0.0.1:${directory.address().port}`, UPLOAD_BASE_URL: 'https://audio.example', UPLOAD_CAPABILITY_SECRET: secret };
  assert.equal(new URL(environment.DOCKET_URL).hostname, '127.0.0.1');
  for (const key of ['DATABASE_URL', 'WORKER_DATABASE_URL', 'FLY_APP_NAME', 'FLY_PROCESS_GROUP', 'JAM_TEST_MODE', 'JAM_TEST_PDS_ORIGIN']) delete environment[key];
  const child = spawn(path.resolve(__dirname, '../zig-out/bin/plyr-backend'), [], { env: environment, stdio: ['ignore', 'ignore', 'inherit'] });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100 && !ready; attempt++) {
      try { ready = (await fetch(`${base}/health`)).ok; } catch {}
      if (!ready) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, 'local coordinator ready');
    const reservation = { uploadId: randomUUID(), recordUri: `at://${owner.did}/fm.plyr.dev.track/3mtest`, sizeBytes: 1610612736, contentType: 'audio/mpeg', fileType: 'mp3', visibility: 'public', downloadPolicy: 'open' };
    const post = async (body) => fetch(`${base}/v1/uploads/authorize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const authorized = { ...reservation, serviceToken: serviceToken(owner, { lxm: 'fm.plyr.dev.upload.authorize' }) };
    const response = await post(authorized);
    assert.equal(response.status, 200);
    const result = await response.json();
    const [payload, signature] = result.capability.split('.');
    assert.equal(signature, createHmac('sha256', secret).update(payload).digest('base64url'));
    const capability = JSON.parse(Buffer.from(payload, 'base64url'));
    assert.equal(capability.owner, owner.did);
    assert.equal(capability.recordUri, reservation.recordUri);
    assert.equal(capability.sizeBytes, 1610612736);
    assert.equal((await post({ ...reservation, serviceToken: serviceToken(owner) })).status, 403, 'Jam scope cannot authorize uploads');
    assert.equal((await post({ ...authorized, sizeBytes: 1610612737 })).status, 400);
    assert.equal((await post({ ...authorized, downloadPolicy: 'off' })).status, 400);
    assert.equal((await post({ ...authorized, recordUri: `at://${paused.did}/fm.plyr.dev.track/3mtest` })).status, 400);
    assert.equal((await post({ ...reservation, recordUri: `at://${paused.did}/fm.plyr.dev.track/3mtest`, serviceToken: serviceToken(paused, { lxm: 'fm.plyr.dev.upload.authorize' }) })).status, 403, 'operator pause preserved');
    assert.equal((await fetch(`${base}/internal/uploads/inspect`, { method: 'POST', body: '{}' })).status, 403);
    hold = true;
    const pending = [post(authorized), post(authorized)];
    try {
      await Promise.race([heldReady, new Promise((_, reject) => setTimeout(() => reject(new Error('two uploads did not reach authority')), 3000))]);
      const playback = await fetch(`${base}/v1/playback/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceToken: serviceToken(paused), clientId: 'upload-isolation-test' }) });
      assert.equal(playback.status, 200, 'held upload authorities must not exhaust personal playback admission');
      await playback.arrayBuffer();
    } finally {
      hold = false;
      for (const respond of held) respond();
      await Promise.all(pending.map(async result => (await result).arrayBuffer()));
    }
    console.log('upload admission HTTP: valid capability, distinct scope, owner/bounds/policy/pause, internal auth passed');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    await new Promise(resolve => directory.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
