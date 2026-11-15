const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Transform } = require('node:stream');
const { chromium } = require('playwright');
const { fixtureAccounts, fixturePage, authorizeFixture } = require('./pds-browser-fixture.cjs');

const pds = process.env.PRIVATE_AUDIO_PDS || 'http://127.0.0.1:5197';
const origin = process.env.PRIVATE_AUDIO_ORIGIN || 'http://127.0.0.1:5310';
const phone = process.env.PRIVATE_AUDIO_PHONE === '1';
const ownerFlow = process.env.PRIVATE_AUDIO_OWNER === '1';
const ownerTitle = 'Owner-only recording fixture';
const dist = process.env.PRIVATE_AUDIO_DIST || path.resolve(__dirname, '../build');
const output = process.env.PRIVATE_AUDIO_OUTPUT || '/tmp/plyr-private-audio-zds';
const list = data => ({ object: 'list', data, has_more: false });
async function rpc(method, body, token) {
  const response = await fetch(pds + '/xrpc/' + method, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(method + ' failed: ' + response.status + ' ' + (value.error || ''));
  return value;
}
async function checkOwnerTrack(page, audio, previousSource, origin, appView, coordinator) {
  await page.getByRole('link', { name: 'upload', exact: true }).last().click();
  await page.getByRole('navigation', { name: 'Who can listen' }).getByRole('link', { name: 'only you' }).click();
  await page.waitForURL('**/upload?visibility=only-you');
  const shortAudio = Buffer.from(audio.subarray(0, 44 + 8000 * 2 * 4));
  shortAudio.writeUInt32LE(shortAudio.length - 8, 4);
  shortAudio.writeUInt32LE(shortAudio.length - 44, 40);
  await page.getByLabel('audio', { exact: true }).setInputFiles({ name: 'fixture.wav', mimeType: 'audio/wav', buffer: shortAudio });
  await page.getByLabel('title', { exact: true }).fill(ownerTitle);
  await page.getByLabel('artist', { exact: true }).fill('fixture artist');
  await page.getByRole('button', { name: 'upload', exact: true }).click();
  await page.waitForURL('**/portal');
  const row = page.getByRole('list', { name: 'Your tracks' }).getByRole('listitem').filter({ hasText: ownerTitle });
  await row.getByText('only you', { exact: true }).waitFor();
  await row.getByRole('link', { name: ownerTitle }).click();
  await page.getByRole('heading', { name: ownerTitle, exact: true }).waitFor();
  const play = page.locator('article').getByRole('button', { name: 'Play', exact: true });
  await play.click();
  await page.getByTestId('player-dock').getByText(ownerTitle).waitFor();
  await page.waitForFunction(() => window.jamAudio.some(media => !media.paused && media.currentTime > 2.2));
  const source = await page.evaluate(() => window.jamAudio.find(media => !media.paused).src);
  assert.ok(source.startsWith(origin + '/__plyr_private_audio/'));
  assert.notEqual(source, previousSource);
  assert.equal(await page.evaluate(async url => (await fetch(url)).status, previousSource), 410);
  const publicCheckpoints = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('plyr-next-queue', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const items = database.transaction('checkpoints').objectStore('checkpoints').getAll();
      items.onsuccess = () => { database.close(); resolve(JSON.stringify(items.result)); };
      items.onerror = () => { database.close(); reject(items.error); };
    };
  }));
  for (const messages of [appView, coordinator, [publicCheckpoints]]) {
    assert.ok(!messages.some(message => /private_|privateMedia|Owner-only recording fixture/i.test(message)),
      'private track stayed out of public API requests, queue messages and checkpoints');
  }
  await page.screenshot({ path: output + '/track-visibility-only-you.png' });
  const anonymous = await page.context().browser().newContext({ ignoreHTTPSErrors: true });
  try {
    await anonymous.route(origin + '/**', async route => {
      const request = route.request();
      if (request.isNavigationRequest()) return route.fulfill({ path: path.join(dist, 'index.html') });
      const filename = path.join(dist, new URL(request.url()).pathname);
      await route.fulfill({ path: filename }).catch(() => route.abort());
    });
    await anonymous.route('https://api.next.plyr.fm/**', route => route.abort());
    const guest = await anonymous.newPage();
    await guest.goto(page.url());
    await guest.getByRole('heading', { name: 'track not found' }).waitFor();
    assert.equal(await guest.getByText(ownerTitle, { exact: true }).count(), 0);
  } finally { await anonymous.close(); }
  await page.getByRole('button', { name: 'delete track', exact: true }).click();
  await page.getByRole('button', { name: 'delete track', exact: true }).click();
  await page.getByText('no tracks yet.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(async url => (await fetch(url)).status, source), 410);
  await page.getByTestId('player-dock').getByText('Protected streaming fixture').waitFor();
  console.log('Track visibility passed upload, catalog, detail, signed-out access, isolated playback, deletion and queue restoration');
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const accounts = await fixtureAccounts(['mvpjamhost']);
  const handle = 'mvpjamhost.test', did = accounts[handle].did;
  const session = await rpc('com.atproto.server.createSession', { identifier: handle, password: accounts[handle].pass });
  const key = 'streaming-' + Date.now().toString(36), space = `at://${did}/space/fm.plyr.next.audio/${key}`;
  const privateUri = `${space}/${did}/fm.plyr.track/${key}`;
  const canonicalUri = `at://${did}/fm.plyr.track/${key}`;
  const id = 'trk_' + Buffer.from(canonicalUri).toString('base64url');
  const audio = Buffer.alloc(44 + 8000 * 300 * 2);
  audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
  const upload = await fetch(pds + '/xrpc/com.atproto.repo.uploadBlob', { method: 'POST', headers: { authorization: 'Bearer ' + session.accessJwt, 'content-type': 'audio/wav' }, body: audio });
  assert.equal(upload.status, 200);
  const { blob } = await upload.json();
  await rpc('com.atproto.space.createSpace', { spaceType: 'fm.plyr.next.audio', skey: key,
    policy: { $type: 'com.atproto.managedspace.policy', managingApp: 'did:web:api.next.plyr.fm#plyr_space', publishPolicy: false } }, session.accessJwt);
  const record = { $type: 'fm.plyr.track', title: 'Protected streaming fixture', artist: 'fixture artist', duration: 300, fileType: 'wav', createdAt: new Date().toISOString() };
  const stored = await rpc('com.atproto.space.putRecord', { space, repo: did, collection: 'fm.plyr.track', rkey: key, validate: false, record: { ...record, audioBlob: blob } }, session.accessJwt);
  const canonical = await rpc('com.atproto.repo.putRecord', { repo: did, collection: 'fm.plyr.track', rkey: key, validate: false, record: { ...record, audioSpace: privateUri } }, session.accessJwt);
  const track = { object: 'track', id, record: { uri: canonicalUri, cid: canonical.cid, revision: null, collection: 'fm.plyr.track', rkey: key },
    metadata: { title: record.title, artist_name: record.artist, description: null, album: null, duration_seconds: 300, created_at: record.createdAt },
    artist: { did, profile: { handle, display_name: 'fixture artist', avatar_url: null } }, media: { artwork: null }, access: { visibility: 'public' }, metrics: { play_count: 0, like_count: 0 } };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'plyr-audio-proxy-'));
  await fs.chmod(directory, 0o700);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem'), '-subj', '/CN=pds.fixture.test', '-addext', 'subjectAltName=DNS:pds.fixture.test,IP:127.0.0.1'], { stdio: 'ignore' });
  const requests = [];
  let sent = 0;
  const proxy = https.createServer({ key: await fs.readFile(path.join(directory, 'key.pem')), cert: await fs.readFile(path.join(directory, 'cert.pem')) }, (request, response) => {
    if (request.method === 'OPTIONS') { response.writeHead(204, { 'access-control-allow-origin': origin, 'access-control-allow-headers': request.headers['access-control-request-headers'] || '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS' }); response.end(); return; }
    const upstream = http.request(pds + request.url, { method: request.method, headers: { ...request.headers, host: 'pds.fixture.test', 'x-forwarded-proto': 'https' } }, result => {
      requests.push({ method: request.method, range: request.headers.range, status: result.statusCode, contentRange: result.headers['content-range'] });
      response.writeHead(result.statusCode, { ...result.headers, 'access-control-allow-origin': origin, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS' });
      const throttle = new Transform({ transform(chunk, _encoding, done) { setTimeout(() => { sent += chunk.length; done(null, chunk); }, 20); } });
      result.pipe(throttle).pipe(response);
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    response.on('close', () => upstream.destroy()); request.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const proxyOrigin = `https://127.0.0.1:${proxy.address().port}`;
  const workerServer = http.createServer(async (request, response) => {
    if (request.url !== '/private-audio-worker.js') { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    response.end(await fs.readFile(path.join(__dirname, '../static/private-audio-worker.js')));
  });
  await new Promise(resolve => workerServer.listen(Number(new URL(origin).port), '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-features=LocalNetworkAccessChecks', '--ignore-certificate-errors', '--no-proxy-server', `--host-rules=MAP pds.fixture.test:443 127.0.0.1:${proxy.address().port}`] });
  try {
    const { page, context } = await fixturePage(browser, accounts, { origin, dist, context: { viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 900 }, colorScheme: phone ? 'dark' : 'light', isMobile: phone, hasTouch: phone, ignoreHTTPSErrors: true } });
    const requestsToAppView = [], coordinatorMessages = [];
    let clientId;
    await context.route('https://jams.next.plyr.fm/v1/playback/join', route => {
      const request = route.request().postDataJSON();
      coordinatorMessages.push(JSON.stringify(request.initial));
      clientId = request.clientId;
      return route.fulfill({ json: { ticket: 'protected-fixture', connectionId: 'protected-fixture' } });
    });
    await context.routeWebSocket('wss://jams.next.plyr.fm/v1/jams/socket?ticket=protected-fixture', socket => {
      const personal = { explicitEnd: 0, tailKind: null, label: null, repeat: 'off', keepPlaying: false, cursor: null, output: null, disconnected: false };
      let state = { epoch: 'protected-fixture', revision: 0, occurrence: 0, queue: [], index: 0, playing: false, positionMs: 0, updatedAtMs: Date.now(), personal };
      socket.send(JSON.stringify({ type: 'state', state }));
      socket.onMessage(message => {
        coordinatorMessages.push(String(message));
        const command = JSON.parse(String(message));
        if (command.action === 'playContext') {
          state = { ...state, revision: 1, occurrence: 1, queue: command.queue, index: command.index, playing: true,
            updatedAtMs: Date.now(), personal: { ...personal, explicitEnd: command.queue.length, output: { clientId, connectionId: 'protected-fixture' } } };
        }
        if (command.id && command.action) socket.send(JSON.stringify({ type: 'result', id: command.id, outcome: 'applied', state }));
      });
    });
    await context.route('https://typeahead.waow.tech/**', route => route.fulfill({ json: { actors: [] } }));
    await context.route('https://api.next.plyr.fm/**', route => {
      requestsToAppView.push(route.request().url() + (route.request().postData() ?? ''));
      const url = new URL(route.request().url());
      if (route.request().method() !== 'GET') return route.abort();
      if (url.pathname === `/v1/tracks/${id}`) return route.fulfill({ json: track });
      if (url.pathname === `/v1/tracks/${id}/playback`) return route.fulfill({ json: { object: 'playback', track_id: id, record: track.record,
        availability: { status: 'gated', space: { uri: space, record: privateUri, gate: 'signed-in' } } } });
      if (url.pathname.endsWith('/likes')) return route.fulfill({ json: list([]) });
      return route.fallback();
    });
    await context.route('https://pds.fixture.test/xrpc/com.atproto.space.getBlob?**', route => {
      const url = new URL(route.request().url());
      return route.continue({ url: proxyOrigin + url.pathname + url.search });
    });
    const failures = []; page.on('console', message => { if (message.text().includes('[playback]')) console.log(message.text()); }); page.on('pageerror', error => failures.push(error.message));
    await page.goto(origin + '/login?return_to=' + encodeURIComponent('/track/' + id));
    await authorizeFixture(page, accounts, handle); await page.waitForURL('**/track/' + id);
    page.setDefaultTimeout(20000);
    const start = Date.now(); await page.getByRole('button', { name: 'Play', exact: true }).last().click();
    try {
      await page.waitForFunction(() => window.jamAudio.some(a => !a.paused && a.currentTime > .1), null, { timeout: 20000 });
    } catch (error) {
      console.error('playback status', await page.getByRole('status').allTextContents());
      throw error;
    }
    const startupMs = Date.now() - start, startupBytes = sent;
    const active = await page.evaluate(() => window.jamAudio.find(a => !a.paused).src);
    assert.ok(active.includes('/__plyr_private_audio/'), 'Real protected playback uses the streaming worker');
    assert.ok(startupBytes < audio.length, 'Playback starts before the full protected source is transferred');
    await page.getByRole('button', { name: 'Open now playing', exact: true }).click(); await page.getByRole('dialog').waitFor();
    const controls = page.getByRole('dialog', { name: 'Now playing' });
    const slider = controls.getByRole('slider', { name: 'Playback position', exact: true });
    const seekMs = [];
    for (const target of [240, 15, 270]) {
      const before = Date.now();
      await slider.fill(String(target));
      const selected = Number(await slider.inputValue());
      await page.waitForFunction(target => window.jamAudio.some(a => !a.paused && !a.seeking && Math.abs(a.currentTime - target) < 2), selected, { timeout: 15000 });
      seekMs.push(Date.now() - before);
    }
    assert.ok(requests.some(r => r.status === 206 && Number(/^bytes=(\d+)/.exec(r.range || '')?.[1]) > audio.length / 2));
    await page.screenshot({ path: output + '/protected-playing.png' });
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    async function settings() {
      const nav = page.getByRole('navigation', { name: 'Main navigation' });
      if (phone) {
        await nav.getByRole('button', { name: 'account', exact: true }).click();
        await page.getByRole('dialog', { name: 'account', exact: true }).getByRole('link', { name: 'settings', exact: true }).click();
      } else await nav.getByRole('link', { name: 'settings', exact: true }).click();
    }
    await settings();
    if (ownerFlow) {
      await checkOwnerTrack(page, audio, active, origin, requestsToAppView, coordinatorMessages);
      await settings();
    }
    await page.getByRole('button', { name: 'sign out', exact: true }).click();
    await page.getByTestId('player-dock').waitFor({ state: 'detached' });
    const status = await page.evaluate(async source => (await fetch(source)).status, active);
    assert.equal(status, 410, 'sign-out releases the protected source');
    assert.deepEqual(failures, []);
    const result = { spaceType: 'fm.plyr.next.audio', policy: 'com.atproto.managedspace.policy', recordCid: stored.cid, browser: 'Chrome', startupMs, startupBytes, fileBytes: audio.length, seekMs, source: 'real ZDS, OAuth, MAC and range body; appview catalog fixture', requests };
    await fs.writeFile(output + '/result.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
    await context.close();
  } finally {
    await browser.close(); workerServer.closeAllConnections(); proxy.closeAllConnections(); await new Promise(resolve => workerServer.close(resolve)); await new Promise(resolve => proxy.close(resolve)); await fs.rm(directory, { recursive: true, force: true });
    await rpc('com.atproto.repo.deleteRecord', { repo: did, collection: 'fm.plyr.track', rkey: key }, session.accessJwt).catch(() => undefined);
    await rpc('com.atproto.space.deleteSpace', { space }, session.accessJwt).catch(() => undefined);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
