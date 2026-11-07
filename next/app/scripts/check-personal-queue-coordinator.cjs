const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const path = require('node:path');
const pds = process.env.QUEUE_TEST_PDS || 'https://pds.zat.dev';
const ports = [Number(process.env.QUEUE_TEST_PORT || 5351), Number(process.env.QUEUE_TEST_PORT || 5351) + 1];
const bases = ports.map(port => `http://127.0.0.1:${port}`);
const spaceType = process.env.EXPO_PUBLIC_JAM_SPACE_TYPE || 'fm.plyr.stg.jam';
const key = 'personal-queue';

async function rpc(method, body, token, query) {
  const response = await fetch(`${pds}/xrpc/${method}${query ? '?' + new URLSearchParams(query) : ''}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  const value = await response.json();
  if (!response.ok) throw Error(`${method}: HTTP ${response.status} ${value.error || ''}`);
  return value;
}
async function socket(base, ticket) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/v1/jams/socket?ticket=' + ticket);
  const frames = [];
  ws.addEventListener('message', event => frames.push(JSON.parse(event.data)));
  await once(ws, 'open');
  const wait = async predicate => {
    const until = Date.now() + 7000;
    while (Date.now() < until) { const frame = frames.find(predicate); if (frame) return frame; await new Promise(resolve => setTimeout(resolve, 5)); }
    throw Error('queue event timed out');
  };
  await wait(frame => frame.type === 'state');
  return { ws, frames, wait };
}
(async () => {
  assert.ok(process.env.QUEUE_TEST_ACCOUNTS, 'set QUEUE_TEST_ACCOUNTS to disposable account JSON');
  const accounts = JSON.parse(await fs.readFile(process.env.QUEUE_TEST_ACCOUNTS, 'utf8'));
  for (const name of ['host', 'guest']) {
    const account = accounts[name];
    const session = await rpc('com.atproto.server.createSession', { identifier: account.handle, password: account.password });
    assert.equal(session.did, account.did);
    account.token = session.accessJwt;
  }
  const host = accounts.host;
  const space = `at://${host.did}/space/${spaceType}/${key}`;
  try { await rpc('com.atproto.space.createSpace', { spaceType, skey: key, policy: { $type: 'com.atproto.memberspace.policy', publicRead: false, publicWrite: false, publishPolicy: false, publishMembers: false } }, host.token); }
  catch (error) { if (!error.message.includes('SpaceAlreadyExists')) throw error; }
  const hash = createHash('sha256').update(space).digest('hex');
  const keys = ['state', 'commands', 'command-order', 'events'].map(suffix => `plyr:next:jam:${hash}:${suffix}`);
  const cleanup = () => execFileSync('docker', ['compose', '-f', path.resolve(__dirname, '../../backend/compose.yaml'), 'exec', '-T', 'test-redis', 'redis-cli', 'DEL', ...keys], { stdio: 'ignore' });
  cleanup();
  const environment = { ...process.env, MODE: 'jams', INDEX_MODE: 'disabled', DOCKET_URL: 'redis://127.0.0.1:6380/0', TRACK_COLLECTION_NSID: 'fm.plyr.track', LIST_COLLECTION_NSID: 'fm.plyr.list', PROFILE_COLLECTION_NSID: 'fm.plyr.actor.profile', LIKE_COLLECTION_NSID: 'fm.plyr.like', CORS_ALLOWED_ORIGINS: 'https://next.plyr.fm' };
  delete environment.JAM_TEST_MODE; delete environment.JAM_TEST_PDS_ORIGIN; delete environment.PLC_DIRECTORY_URL;
  const children = ports.map(port => spawn(path.resolve(__dirname, '../../backend/zig-out/bin/plyr-backend'), [], { env: { ...environment, PORT: String(port) }, stdio: ['ignore', 'ignore', 'inherit'] }));
  const sockets = [];
  try {
    for (const base of bases) {
      let healthy = false;
      for (let i = 0; i < 100; i++) { try { healthy = (await fetch(base + '/health')).ok; } catch {} if (healthy) break; await new Promise(resolve => setTimeout(resolve, 50)); }
      assert.ok(healthy, 'local coordinator ready');
    }
    const found = (await (await fetch('https://api.next.plyr.fm/v1/search?q=Sounds%20of%20the%20Drone%20Mix')).json()).data.find(hit => hit.type === 'track' && hit.title === 'Sounds of the Drone Mix');
    const track = await (await fetch('https://api.next.plyr.fm/v1/tracks/' + found.id)).json();
    const reference = { id: track.id, uri: track.record.uri, cid: track.record.cid, durationMs: Math.round(track.metadata.duration_seconds * 1000), key: 'current' };
    async function join(base, account, clientId, initial, normal = false) {
      const { token: serviceToken } = await rpc('com.atproto.server.getServiceAuth', undefined, account.token, { aud: 'did:web:plyr-jams-next.fly.dev#jams', lxm: 'fm.plyr.stg.jam.join' });
      const { token: delegationToken } = await rpc('com.atproto.space.getDelegationToken', undefined, account.token, { space });
      const response = await fetch(base + (normal ? '/v1/jams/join' : '/v1/playback/join'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ host: host.did, key, serviceToken, delegationToken, clientId, initial }) });
      return { status: response.status, ...await response.json() };
    }
    assert.equal((await join(bases[0], accounts.guest, 'guest')).status, 403, 'another account cannot enter a personal queue');
    assert.equal((await join(bases[0], host, 'a', undefined, true)).status, 403, 'Jam admission cannot bypass personal ownership');
    const first = await join(bases[0], host, 'device-a', { queue: [reference], positionMs: 5432, personal: { explicitEnd: 1 } });
    assert.equal(first.status, 200);
    const a = await socket(bases[1], first.ticket); sockets.push(a.ws);
    const second = await join(bases[1], host, 'device-b'); assert.equal(second.status, 200);
    const b = await socket(bases[0], second.ticket); sockets.push(b.ws);
    let state = a.frames.find(frame => frame.type === 'state').state;
    let serial = 0;
    const command = (action, fields = {}) => ({ id: `personal-${++serial}`, epoch: state.epoch, expectedRevision: state.revision, occurrence: state.occurrence, action, expectedOutput: state.personal.output?.connectionId ?? null, ...fields });
    const addA = command('enqueue', { entry: { ...reference, key: 'pick-a' } });
    const addB = command('enqueue', { entry: { ...reference, key: 'pick-b' } });
    a.ws.send(JSON.stringify(addA)); b.ws.send(JSON.stringify(addB));
    const [left, right] = await Promise.all([a.wait(frame => frame.id === addA.id), b.wait(frame => frame.id === addB.id)]);
    assert.equal(left.outcome, 'applied'); assert.equal(right.outcome, 'applied');
    state = left.state.revision > right.state.revision ? left.state : right.state;
    assert.equal(state.queue.length, 3); assert.equal(state.personal.explicitEnd, 3);
    assert.deepEqual(new Set(state.queue.map(entry => entry.key)), new Set(['current', 'pick-a', 'pick-b']));
    await a.wait(frame => frame.state?.revision === state.revision); await b.wait(frame => frame.state?.revision === state.revision);
    b.ws.send(JSON.stringify(addA)); assert.equal((await b.wait(frame => frame.id === addA.id)).outcome, 'duplicate');
    const playA = command('play'); a.ws.send(JSON.stringify(playA));
    state = (await a.wait(frame => frame.id === playA.id)).state;
    assert.equal(state.personal.output.clientId, 'device-a');
    const latePause = command('pause');
    const playB = command('play'); b.ws.send(JSON.stringify(playB));
    state = (await b.wait(frame => frame.id === playB.id)).state;
    assert.equal(state.personal.output.clientId, 'device-b');
    a.ws.send(JSON.stringify(latePause)); assert.equal((await a.wait(frame => frame.id === latePause.id)).outcome, 'conflict');
    const beforeClose = state.revision;
    b.ws.close();
    state = (await a.wait(frame => frame.type === 'state' && frame.state.revision > beforeClose && frame.state.personal.disconnected)).state;
    assert.equal(state.playing, false);
    const rejoin = await join(bases[0], host, 'device-b'); assert.equal(rejoin.status, 200);
    const resumed = await socket(bases[1], rejoin.ticket); sockets.push(resumed.ws);
    state = resumed.frames.find(frame => frame.type === 'state').state;
    assert.equal(state.playing, false, 'reconnect alone does not autoplay');
    assert.equal(state.queue.length, 3);
    console.log('Real PDS identity and Space admission; two coordinators: concurrent additions, duplicate retry, output fencing, paused reconnect and personal isolation passed');
  } finally {
    for (const ws of sockets) ws.close();
    await new Promise(resolve => setTimeout(resolve, 100));
    for (const child of children) child.kill('SIGTERM');
    cleanup();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
