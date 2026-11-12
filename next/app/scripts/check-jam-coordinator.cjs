const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const pds = process.env.JAM_TEST_PDS_ORIGIN || 'http://127.0.0.1:5197';
const ports = [Number(process.env.JAM_TEST_PORT || 5311), Number(process.env.JAM_TEST_PORT || 5311) + 1];
const [a, b] = ports.map(port => 'http://127.0.0.1:' + port);
async function rpc(method, body, token, query) { const r = await fetch(pds + '/xrpc/' + method + (query ? '?' + new URLSearchParams(query) : ''), { method: body === undefined ? 'GET' : 'POST', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); const data = await r.json(); if (!r.ok)
    throw Error(method + ' HTTP' + r.status + ' ' + JSON.stringify(data)); return data; }
async function account(name) { const data = await rpc('com.atproto.server.createAccount', { handle: name + '.test', email: name + '@example.test', password: 'fixture-only-password' }); return { did: data.did, token: data.accessJwt }; }
async function join(base, actor, host, key, initial) { const { token: serviceToken } = await rpc('com.atproto.server.getServiceAuth', undefined, actor.token, { aud: 'did:web:plyr-jams-next.fly.dev#jams', lxm: 'fm.plyr.stg.jam.join' }); const { token: delegationToken } = await rpc('com.atproto.space.getDelegationToken', undefined, actor.token, { space: `at://${host}/space/fm.plyr.stg.jam/${key}` }); const r = await fetch(base + '/v1/jams/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ host, key, serviceToken, delegationToken, initial }) }); const data = await r.json(); return { status: r.status, ...data }; }
async function socket(base, ticket) { const ws = new WebSocket(base.replace('http', 'ws') + '/v1/jams/socket?ticket=' + ticket); const frames = []; ws.addEventListener('message', e => frames.push(JSON.parse(e.data))); await once(ws, 'open'); const wait = async (predicate) => { const end = Date.now() + 5000; while (Date.now() < end) {
    const frame = frames.find(predicate);
    if (frame)
        return frame;
    await new Promise(r => setTimeout(r, 5));
} throw Error('frame timeout ' + JSON.stringify(frames)); }; await wait(f => f.type === 'state'); return { ws, frames, wait }; }
(async () => {
    const env = { ...process.env, MODE: 'jams', INDEX_MODE: 'disabled', DOCKET_URL: process.env.PLYR_ZIG_TEST_REDIS_URL || 'redis://:jam-fixture-pass@127.0.0.1:6393/0', TRACK_COLLECTION_NSID: 'fm.plyr.track', LIST_COLLECTION_NSID: 'fm.plyr.list', PROFILE_COLLECTION_NSID: 'fm.plyr.actor.profile', LIKE_COLLECTION_NSID: 'fm.plyr.like', CORS_ALLOWED_ORIGINS: 'https://next.plyr.fm', PLC_DIRECTORY_URL: 'http://127.0.0.1:5296', JAM_TEST_MODE: '1', JAM_TEST_PDS_ORIGIN: pds };
    const children = ports.map(port => spawn(path.resolve(__dirname, '../../backend/zig-out/bin/plyr-backend'), [], { env: { ...env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'inherit'] }));
    try {
        for (const url of [a, b]) {
            for (let i = 0; i < 50; i++) {
                try {
                    if ((await fetch(url + '/health')).ok)
                        break;
                }
                catch { }
                await new Promise(r => setTimeout(r, 50));
            }
        }
        const suffix = Date.now().toString(36), host = await account('jhost' + suffix), guest = await account('jguest' + suffix), key = 'room' + suffix;
        const space = `at://${host.did}/space/fm.plyr.stg.jam/${key}`;
        await rpc('com.atproto.space.createSpace', { spaceType: 'fm.plyr.stg.jam', skey: key, policy: { $type: 'com.atproto.memberspace.policy', publicRead: false, publicWrite: false, publishPolicy: false, publishMembers: false } }, host.token);
        const hits = await (await fetch('https://api.next.plyr.fm/v1/search?q=Sounds%20of%20the%20Drone%20Mix')).json();
        const found = hits.data.find(t => t.type === 'track' && t.title === 'Sounds of the Drone Mix');
        const track = await (await fetch('https://api.next.plyr.fm/v1/tracks/' + found.id)).json();
        const initial = { queue: [{ id: track.id, uri: track.record.uri, cid: track.record.cid, durationMs: Math.round(track.metadata.duration_seconds * 1000) }] };
        const denied = await join(a, guest, host.did, key);
        assert.equal(denied.status, 403);
        await rpc('com.atproto.memberspace.putMembers', { space, members: [{ did: guest.did, read: true, write: false }] }, host.token);
        const first = await join(a, host, host.did, key, initial);
        assert.equal(first.status, 200, JSON.stringify(first));
        const h = await socket(b, first.ticket);
        console.log('Host joined instanceB using ticket fromA');
        const second = await join(b, guest, host.did, key);
        assert.equal(second.status, 200, JSON.stringify(second));
        const g = await socket(a, second.ticket);
        let state = h.frames.find(f => f.type === 'state').state;
        let serial = 0;
        const cmd = (action, extra = {}) => ({ id: 'cmd' + (++serial), epoch: state.epoch, expectedRevision: state.revision, occurrence: state.occurrence, action, ...extra });
        const play = cmd('play');
        const sentAt = performance.now();
        h.ws.send(JSON.stringify(play));
        const ack = await h.wait(f => f.type === 'result' && f.id === play.id);
        assert.equal(ack.outcome, 'applied');
        state = ack.state;
        await g.wait(f => f.type === 'state' && f.state.revision === state.revision);
        console.log('Cross-instance play fanout ms', Math.round(performance.now() - sentAt));
        const pause1 = cmd('pause'), pause2 = cmd('pause');
        h.ws.send(JSON.stringify(pause1));
        g.ws.send(JSON.stringify(pause2));
        const [p1, p2] = await Promise.all([h.wait(f => f.type === 'result' && f.id === pause1.id), g.wait(f => f.type === 'result' && f.id === pause2.id)]);
        assert.ok([p1.outcome, p2.outcome].includes('applied'));
        assert.ok([p1.outcome, p2.outcome].includes('noop'));
        state = p1.state.revision > p2.state.revision ? p1.state : p2.state;
        assert.equal(state.playing, false);
        console.log('Concurrent explicit pause yields one transition plus no-op');
        const deniedSeek = cmd('seek', { positionMs: 10000 });
        g.ws.send(JSON.stringify(deniedSeek));
        assert.equal((await g.wait(f => f.type === 'result' && f.id === deniedSeek.id)).outcome, 'forbidden');
        const seek = cmd('seek', { positionMs: 12000 });
        h.ws.send(JSON.stringify(seek));
        const s = await h.wait(f => f.type === 'result' && f.id === seek.id);
        assert.equal(s.outcome, 'applied');
        assert.equal(s.state.positionMs, 12000);
        console.log('Host-only seek passed');
        h.ws.close();
        const recovery = await join(a, host, host.did, key);
        assert.equal(recovery.status, 200);
        const recovered = await socket(a, recovery.ticket);
        const resumed = recovered.frames.find(f => f.type === 'state').state;
        assert.equal(resumed.epoch, s.state.epoch);
        assert.equal(resumed.revision, s.state.revision);
        assert.equal(resumed.positionMs, 12000);
        console.log('Fresh admission on other instance preserved room state');
        recovered.ws.close();
        g.ws.close();
    }
    catch (e) {
        console.error(e);
        process.exitCode = 1;
    }
    finally {
        children.forEach(c => c.kill('SIGTERM'));
    }
})();
