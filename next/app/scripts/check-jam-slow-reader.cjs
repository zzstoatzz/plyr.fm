const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const WebSocket = require(path.join(root, 'next/app/node_modules/ws'));
const pds = process.env.JAM_TEST_PDS_ORIGIN || 'http://127.0.0.1:5197';
const ports = [5311, 5312];
const bases = ports.map(port => 'http://127.0.0.1:' + port);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let processFailure;
let cleaning = false;
async function rpc(method, body, token, query) {
  const response = await fetch(pds + '/xrpc/' + method + (query ? '?' + new URLSearchParams(query) : ''), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert.ok(response.ok, method + ' HTTP ' + response.status);
  return data;
}
async function account(name) {
  const data = await rpc('com.atproto.server.createAccount', { handle: name + '.test', email: name + '@example.test', password: 'fixture-only-password' });
  return { did: data.did, token: data.accessJwt };
}
async function join(base, actor, host, key, initial) {
  const { token: serviceToken } = await rpc('com.atproto.server.getServiceAuth', undefined, actor.token, { aud: 'did:web:plyr-jams-next.fly.dev#jams', lxm: 'fm.plyr.next.jam.join' });
  const { token: delegationToken } = await rpc('com.atproto.space.getDelegationToken', undefined, actor.token, { space: `at://${host}/space/fm.plyr.next.jam/${key}` });
  const response = await fetch(base + '/v1/jams/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ host, key, serviceToken, delegationToken, initial }) });
  const data = await response.json();
  assert.equal(response.status, 200, 'join HTTP ' + response.status + ' ' + JSON.stringify(data));
  return data.ticket;
}
async function connect(base, ticket) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/v1/jams/socket?ticket=' + ticket);
  const frames = [];
  ws.on('message', data => frames.push({ frame: JSON.parse(data), at: performance.now() }));
  ws.on('error', () => {});
  const wait = async predicate => {
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      if (processFailure) throw processFailure;
      const value = frames.find(item => predicate(item.frame));
      if (value) return value;
      await sleep(2);
    }
    throw Error('Expected socket frame not received; readyState=' + ws.readyState);
  };
  await once(ws, 'open');
  const first = await wait(frame => frame.type === 'state');
  return { ws, frames, wait, state: first.frame.state };
}
function remotePresent(pid, localPort) {
  const output = execFileSync('lsof', ['-nP', '-a', '-p', String(pid), '-iTCP'], { encoding: 'utf8' });
  return output.includes(`127.0.0.1:5312->127.0.0.1:${localPort}`);
}
(async () => {
  const env = { ...process.env, MODE: 'jams', INDEX_MODE: 'disabled', DOCKET_URL: process.env.PLYR_ZIG_TEST_REDIS_URL || 'redis://:jam-fixture-pass@127.0.0.1:6393/0', TRACK_COLLECTION_NSID: 'fm.plyr.track', LIST_COLLECTION_NSID: 'fm.plyr.list', PROFILE_COLLECTION_NSID: 'fm.plyr.actor.profile', LIKE_COLLECTION_NSID: 'fm.plyr.like', CORS_ALLOWED_ORIGINS: 'https://next.plyr.fm', PLC_DIRECTORY_URL: 'http://127.0.0.1:5296', JAM_TEST_MODE: '1', JAM_TEST_PDS_ORIGIN: pds };
  const children = ports.map(port => spawn(path.join(root, 'next/backend/zig-out/bin/plyr-backend'), [], { env: { ...env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] }));
  for (const child of children) {
    child.stderr.on('data', data => process.stderr.write(data));
    child.on('error', error => { processFailure = error; });
    child.on('exit', (code, signal) => { if (!cleaning) processFailure = Error('Coordinator exited during pressure: code=' + code + ' signal=' + signal); });
  }
  const sockets = [];
  try {
    for (const base of bases) {
      let ready = false;
      for (let index = 0; index < 100; index++) {
        try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
        await sleep(50);
      }
      assert.ok(ready, base + ' failed startup');
    }
    const suffix = Date.now().toString(36), host = await account('slowhost' + suffix), guest = await account('slowguest' + suffix), key = 'slow' + suffix;
    const space = `at://${host.did}/space/fm.plyr.next.jam/${key}`;
    await rpc('com.atproto.space.createSpace', { spaceType: 'fm.plyr.next.jam', skey: key, policy: { $type: 'com.atproto.memberspace.policy', publicRead: false, publicWrite: false, publishPolicy: false, publishMembers: false } }, host.token);
    await rpc('com.atproto.memberspace.putMembers', { space, members: [{ did: guest.did, read: true, write: false }] }, host.token);
    const hits = await (await fetch('https://api.next.plyr.fm/v1/search?q=Sounds%20of%20the%20Drone%20Mix')).json();
    const found = hits.data.find(hit => hit.type === 'track' && hit.title === 'Sounds of the Drone Mix');
    const track = await (await fetch('https://api.next.plyr.fm/v1/tracks/' + found.id)).json();
    const ref = { id: track.id, uri: track.record.uri, cid: track.record.cid, durationMs: Math.round(track.metadata.duration_seconds * 1000) };
    const queue = Array.from({ length: 200 }, () => ({ ...ref }));
    const producer = await connect(bases[0], await join(bases[0], host, host.did, key, { queue })); sockets.push(producer.ws);
    const active = await connect(bases[1], await join(bases[1], guest, host.did, key)); sockets.push(active.ws);
    const slow = await connect(bases[1], await join(bases[1], guest, host.did, key)); sockets.push(slow.ws);
    assert.equal(producer.state.queue.length, 200);
    assert.equal(active.state.queue.length, 200);
    const slowPort = slow.ws._socket.localPort;
    assert.ok(remotePresent(children[1].pid, slowPort), 'Slow peer must exist before pressure');
    let closeCode;
    slow.ws.on('close', code => { closeCode = code; });
    slow.ws._socket.pause();
    const latencies = [], acknowledgements = [];
    let state = producer.state;
    const began = performance.now();
    const count = 110;
    for (let index = 0; index < count; index++) {
      await sleep(Math.max(0, began + index * (1000 / 22) - performance.now()));
      const command = { id: 'pressure-' + index, epoch: state.epoch, expectedRevision: state.revision, occurrence: state.occurrence, action: state.playing ? 'pause' : 'play' };
      const sent = performance.now();
      producer.ws.send(JSON.stringify(command));
      const ack = await producer.wait(frame => frame.type === 'result' && frame.id === command.id);
      assert.equal(ack.frame.outcome, 'applied');
      state = ack.frame.state;
      const delivered = await active.wait(frame => frame.type === 'state' && frame.state.revision === state.revision);
      latencies.push(delivered.at - sent);
      acknowledgements.push(ack.at - sent);
    }
    await sleep(600);
    const serverClosedSlowPeer = !remotePresent(children[1].pid, slowPort);
    slow.ws._socket.resume();
    for (let index = 0; index < 100 && closeCode === undefined; index++) await sleep(10);
    const sorted = [...latencies].sort((a, b) => a - b);
    const ackSorted = [...acknowledgements].sort((a, b) => a - b);
    const metrics = { queue: queue.length, commands: count, commandHz: 22, snapshotBytes: Buffer.byteLength(JSON.stringify({ type: 'state', state, serverTimeMs: Date.now() })), elapsedMs: Math.round(performance.now() - began), activeDeliveryP50Ms: sorted[Math.floor(sorted.length * .5)], activeDeliveryP95Ms: sorted[Math.floor(sorted.length * .95)], activeDeliveryMaxMs: sorted.at(-1), ackP95Ms: ackSorted[Math.floor(ackSorted.length * .95)], serverClosedSlowPeer, slowCloseCode: closeCode, activeOpen: active.ws.readyState === WebSocket.OPEN, activeRevision: state.revision };
    console.log(JSON.stringify(metrics, null, 2));
    assert.ok(serverClosedSlowPeer, 'Server must disconnect a backpressured slow peer');
    assert.ok(closeCode !== undefined, 'Slow peer must observe closure after reading resumes');
    assert.ok(metrics.activeOpen, 'Active peer must remain connected');
    assert.ok(metrics.activeDeliveryP95Ms < 100, 'Active delivery p95 must stay below100ms locally');
    console.log('Slow-reader isolation passed');
  } finally {
    cleaning = true;
    for (const ws of sockets) ws.terminate();
    const alive = children.filter(child => child.exitCode === null && child.signalCode === null);
    const exits = alive.map(child => once(child, 'exit').catch(() => {}));
    for (const child of alive) child.kill('SIGTERM');
    await Promise.all(exits);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
