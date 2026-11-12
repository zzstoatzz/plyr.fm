const assert = require('node:assert/strict');
const { once } = require('node:events');
const { identity, serviceToken, startQueueFixture } = require('./queue-fixture.cjs');

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
  const host = identity(), guest = identity('k256');
  const fixture = await startQueueFixture([host, guest]);
  const bases = fixture.bases;
  const sockets = [];
  try {
    const found = (await (await fetch('https://api.next.plyr.fm/v1/search?q=Sounds%20of%20the%20Drone%20Mix')).json()).data.find(hit => hit.type === 'track' && hit.title === 'Sounds of the Drone Mix');
    const track = await (await fetch('https://api.next.plyr.fm/v1/tracks/' + found.id)).json();
    const reference = { id: track.id, uri: track.record.uri, cid: track.record.cid, durationMs: Math.round(track.metadata.duration_seconds * 1000), key: 'current' };
    async function join(base, token, clientId, initial, path = '/v1/playback/join', extra = {}) {
      const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceToken: token, clientId, initial, ...extra }) });
      return { status: response.status, ...await response.json() };
    }
    assert.equal((await join(bases[0], serviceToken(host, { key: guest.privateKey }), 'forged')).status, 403, 'a token signed by another key is refused');
    assert.equal((await join(bases[0], serviceToken(host, { aud: 'did:web:elsewhere.example#jams' }), 'audience')).status, 403, 'a token for another service is refused');
    assert.equal((await join(bases[0], serviceToken(host, { lxm: 'fm.plyr.other' }), 'method')).status, 403, 'a token for another method is refused');
    assert.equal((await join(bases[0], serviceToken(host, { lifetime: -5 }), 'expired')).status, 403, 'an expired token is refused');
    assert.equal((await join(bases[0], serviceToken(host), 'jam', undefined, '/v1/jams/join', { host: host.did, key: 'personal-queue' })).status, 403, 'Jam admission still requires a Space delegation');
    const first = await join(bases[0], serviceToken(host), 'device-a', { queue: [reference], positionMs: 5432, personal: { explicitEnd: 1 } });
    assert.equal(first.status, 200);
    const a = await socket(bases[1], first.ticket); sockets.push(a.ws);
    const second = await join(bases[1], serviceToken(host), 'device-b'); assert.equal(second.status, 200);
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
    const rejoin = await join(bases[0], serviceToken(host), 'device-b'); assert.equal(rejoin.status, 200);
    const resumed = await socket(bases[1], rejoin.ticket); sockets.push(resumed.ws);
    state = resumed.frames.find(frame => frame.type === 'state').state;
    assert.equal(state.playing, false, 'reconnect alone does not autoplay');
    assert.equal(state.queue.length, 3);
    let recorded;
    for (const until = Date.now() + 5000; Date.now() < until; await new Promise(resolve => setTimeout(resolve, 100))) { recorded = fixture.record(host); if (recorded?.revision === state.revision) break; }
    assert.equal(recorded?.revision, state.revision, 'the latest revision reaches PostgreSQL');
    assert.equal(recorded.state.queue.length, 3);
    assert.equal(recorded.state.playing, false); assert.equal(recorded.state.personal.output, null);
    for (const ws of sockets.splice(0)) ws.close();
    await new Promise(resolve => setTimeout(resolve, 1500));
    const resting = fixture.record(host);
    fixture.forget();
    const restored = await join(bases[1], serviceToken(host), 'device-c', { queue: [], personal: { explicitEnd: 0 } }); assert.equal(restored.status, 200);
    const back = await socket(bases[0], restored.ticket); sockets.push(back.ws);
    const returned = back.frames.find(frame => frame.type === 'state').state;
    assert.deepEqual(returned.queue.map(entry => entry.key), resting.state.queue.map(entry => entry.key), 'a queue Redis no longer holds is restored from PostgreSQL, not from the joining device');
    assert.equal(returned.epoch, resting.state.epoch); assert.equal(returned.revision, resting.revision);
    assert.equal(returned.playing, false); assert.equal(returned.positionMs, resting.state.positionMs);
    const other = await join(bases[0], serviceToken(guest), 'guest-device'); assert.equal(other.status, 200);
    const separate = await socket(bases[0], other.ticket); sockets.push(separate.ws);
    assert.equal(separate.frames.find(frame => frame.type === 'state').state.queue.length, 0, 'another account, signing with a secp256k1 key, gets its own empty queue');
    const settings = async (token, patch) => { const response = await fetch(bases[0] + '/v1/preferences', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceToken: token, ...(patch ? { patch } : {}) }) }); return { status: response.status, ...await response.json() }; };
    assert.deepEqual((await settings(serviceToken(host))).preferences, {}, 'an account starts with no saved settings');
    assert.deepEqual((await settings(serviceToken(host), { theme: 'dark', scale: 115 })).preferences, { theme: 'dark', scale: 115 });
    assert.deepEqual((await settings(serviceToken(host), { theme: 'light', keepPlaying: true })).preferences, { theme: 'light', scale: 115, keepPlaying: true }, 'a patch merges into saved settings');
    assert.equal((await settings(serviceToken(host), { font: 'papyrus' })).status, 400, 'an unknown value is refused');
    assert.equal((await settings(serviceToken(host, { key: guest.privateKey }), { theme: 'dark' })).status, 403, 'a forged token cannot write settings');
    assert.deepEqual((await settings(serviceToken(guest))).preferences, {}, 'settings are per account');
    console.log('Identity-only admission with no Space; two coordinators; PostgreSQL record restores a queue after Redis loses it: forged, foreign and expired tokens refused, concurrent additions, duplicate retry, output fencing, paused reconnect, per-account isolation and account settings passed');
  } finally {
    for (const ws of sockets) ws.close();
    await new Promise(resolve => setTimeout(resolve, 100));
    await fixture.stop();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
