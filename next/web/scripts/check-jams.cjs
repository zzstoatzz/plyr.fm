const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { authorizeFixture, fixtureAccounts, fixturePage } = require('./pds-browser-fixture.cjs');
const { tracks, serveAudio } = require('./fixture-catalog.cjs');

const site = 'https://next.plyr.fm';
const coordinator = 'https://jams.next.plyr.fm';
const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-svelte-jams';
const catalog = tracks.slice(0, 3).map(track => ({
  ...track, record: { ...track.record, cid: 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5kpqcsgz7soitae' }
}));

async function run(browser, accounts, { delayedSolo = false } = {}) {
  const host = 'sveltejamhost.test';
  const guest = 'sveltejamguest.test';
  const key = 'room-' + randomUUID();
  const slug = encodeURIComponent(accounts[host].did + '~' + key);
  const room = site + '/jam/' + slug;
  const sockets = new Set();
  const commands = [];
  const soloCommands = [];
  const errors = [];
  let state;
  let joins = 0;
  const firstAdd = Promise.withResolvers();

  async function setup(width, scheme) {
    const result = await fixturePage(browser, accounts, {
      dist: path.resolve(__dirname, '../build'),
      context: { viewport: { width, height: 844 }, colorScheme: scheme, isMobile: width === 390, hasTouch: width === 390 },
    });
    const { page, context } = result;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('https://typeahead.waow.tech/**', route => route.fulfill({ json: { actors: [] } }));
    await context.route('https://panel-fixture.invalid/**', route => route.request().url().endsWith('/audio.wav')
      ? serveAudio(route) : route.fulfill({ status: 404 }));
    await context.route('https://api.next.plyr.fm/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      const track = catalog.find(item => pathname === '/v1/tracks/' + item.id || pathname === '/v1/tracks/' + item.id + '/playback');
      if (track && pathname.endsWith('/playback')) return route.fulfill({ json: {
        availability: { status: 'available', delivery: { url: 'https://panel-fixture.invalid/audio.wav' } }
      } });
      if (track) return route.fulfill({ json: track });
      if (pathname === '/v1/tracks/resolve') {
        const { ids } = route.request().postDataJSON();
        const data = catalog.filter(item => ids.includes(item.id));
        return route.fulfill({ json: { data, missing: ids.filter(id => !data.some(item => item.id === id)) } });
      }
      if (pathname === '/v1/tracks') return route.fulfill({ json: { data: catalog, has_more: false } });
      return route.fulfill({ json: { data: [], has_more: false } });
    });
    await context.route(coordinator + '/v1/playback/join', route => delayedSolo ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({ json: { ticket: 'solo-ticket', connectionId: 'solo-connection' } }));
    await context.routeWebSocket('wss://jams.next.plyr.fm/v1/jams/socket?ticket=solo-ticket', socket => {
      const solo = catalog[1];
      socket.send(JSON.stringify({ type: 'state', state: {
        epoch: 'solo', revision: 1, occurrence: 1, index: 0, playing: false, positionMs: 34000, updatedAtMs: Date.now(),
        queue: [{ id: solo.id, uri: solo.record.uri, cid: solo.record.cid, durationMs: solo.metadata.duration_seconds * 1000, key: 'solo-track' }],
        personal: { explicitEnd: 1, tailKind: null, label: null, repeat: 'off', keepPlaying: false, cursor: null, output: null, disconnected: false },
      } }));
      socket.onMessage(payload => {
        const value = JSON.parse(String(payload));
        if (value.type !== 'ping') soloCommands.push(value);
      });
    });
    await context.route(coordinator + '/v1/jams/join', route => {
      const admission = route.request().postDataJSON();
      assert.equal(admission.host, accounts[host].did);
      assert.equal(admission.key, key);
      assert.equal(typeof admission.serviceToken, 'string');
      assert.equal(typeof admission.delegationToken, 'string');
      if (admission.initial) {
        assert.equal(admission.initial.queue[0].id, catalog[0].id);
        state ??= { ...admission.initial, epoch: 'room-epoch', revision: 1, occurrence: 1, updatedAtMs: Date.now() };
      }
      assert.ok(state);
      joins++;
      return route.fulfill({ json: { ticket: 'room-ticket' } });
    });
    await context.routeWebSocket('wss://jams.next.plyr.fm/v1/jams/socket?ticket=room-ticket', socket => {
      sockets.add(socket);
      socket.onClose(() => sockets.delete(socket));
      const send = data => socket.send(JSON.stringify(data));
      send({ type: 'state', state });
      socket.onMessage(async payload => {
        const command = JSON.parse(String(payload));
        if (command.type === 'ping') {
          send({ type: 'pong', id: command.id, serverTimeMs: Date.now() });
          return;
        }
        if (command.action === 'replaceQueue' && !commands.some(value => value.action === 'replaceQueue')) await firstAdd.promise;
        commands.push(command);
        state = { ...state, revision: state.revision + 1, updatedAtMs: Date.now() };
        if (command.action === 'play' || command.action === 'pause') state.playing = command.action === 'play';
        if (command.action === 'seek') state.positionMs = command.positionMs;
        if (command.action === 'replaceQueue') Object.assign(state, { queue: command.queue, index: command.index });
        if (command.action === 'selectTrack') Object.assign(state, {
          index: command.index, occurrence: state.occurrence + 1, positionMs: 0, playing: command.playing ?? state.playing
        });
        send({ type: 'result', id: command.id, outcome: 'applied', state });
        for (const peer of sockets) if (peer !== socket) peer.send(JSON.stringify({ type: 'state', state }));
      });
    });
    return result;
  }

  const hostTab = await setup(1280, 'light');
  const guestTab = await setup(390, 'dark');
  const hostPage = hostTab.page;
  const guestPage = guestTab.page;
  const hostLink = room + '?track=' + encodeURIComponent(catalog[0].id);
  try {
    await hostPage.goto(hostLink);
    await hostPage.getByRole('link', { name: 'sign in to join' }).click();
    await authorizeFixture(hostPage, accounts, host);
    await hostPage.waitForURL(hostLink);
    if (delayedSolo) {
      await verifySoloHandoff(hostTab, hostLink);
      return;
    }
    await hostPage.getByRole('button', { name: 'create jam with current track' }).click();
    await hostPage.getByText('connected', { exact: true }).waitFor();
    await hostPage.getByLabel('guest DID').fill(accounts[guest].did);
    await hostPage.getByRole('button', { name: 'invite guest' }).click();
    await hostPage.getByText('guest invited. send them the jam link.', { exact: true }).waitFor();

    await guestPage.goto(room);
    await guestPage.getByRole('link', { name: 'sign in to join' }).click();
    await authorizeFixture(guestPage, accounts, guest);
    await guestPage.waitForURL(room);
    const guestDock = guestPage.getByTestId('player-dock');
    await guestDock.getByText(catalog[1].metadata.title).waitFor();
    const guestPosition = guestDock.getByRole('slider', { name: 'Playback position' });
    assert.equal(await guestPosition.inputValue(), '34');
    await guestPage.getByRole('button', { name: 'join jam', exact: true }).click();
    await guestPage.getByText('connected', { exact: true }).waitFor();
    assert.equal(joins, 2);
    assert.equal(await guestPosition.isDisabled(), true);
    await hostPage.getByRole('button', { name: 'play jam' }).click();
    await guestPage.waitForFunction(() => window.jamAudio.some(audio => !audio.paused));
    await guestPage.getByRole('button', { name: 'pause jam' }).click();
    await hostPage.getByRole('button', { name: 'play jam' }).waitFor();
    await hostPage.waitForFunction(() => window.jamAudio.every(audio => audio.paused));
    await hostPage.getByTestId('player-dock').getByRole('slider', { name: 'Playback position' }).fill('12');
    await guestPage.waitForFunction(() => window.jamAudio.some(audio => audio.currentTime === 12));

    const navigation = guestPage.getByRole('navigation', { name: 'Main navigation' });
    await navigation.getByRole('link', { name: 'home', exact: true }).click();
    const add = index => guestPage.getByTestId('home-track-row').nth(index).getByRole('button', { name: /add .* to queue/i }).click();
    await add(1);
    await add(2);
    firstAdd.resolve();
    await navigation.getByRole('link', { name: 'library', exact: true }).click();
    await guestPage.getByRole('link', { name: 'open queue', exact: true }).click();
    const upcoming = guestPage.getByRole('region', { name: 'up next' });
    await upcoming.getByRole('link', { name: catalog[2].metadata.title }).waitFor();
    assert.deepEqual(await upcoming.getByRole('link').allTextContents(), catalog.slice(1).map(track => track.metadata.title));
    assert.deepEqual(commands.filter(command => command.action === 'replaceQueue').at(-1).queue.map(item => item.durationMs),
      catalog.map(track => track.metadata.duration_seconds * 1000));
    await guestPage.getByRole('region', { name: 'up next' }).getByRole('button', { name: 'Play ' + catalog[1].metadata.title }).click();
    await guestPage.getByRole('region', { name: 'now playing', exact: true }).getByRole('button', { name: 'Pause ' + catalog[1].metadata.title }).waitFor();
    await guestPage.getByRole('button', { name: 'Open Jam' }).click();
    await guestPage.waitForURL(room);

    await fs.mkdir(output, { recursive: true });
    await hostPage.screenshot({ path: path.join(output, '1280-light-host.png') });
    await guestPage.screenshot({ path: path.join(output, '390-dark-guest.png') });
    await guestPage.getByRole('button', { name: 'leave jam' }).click();
    await guestPage.getByRole('button', { name: 'join jam', exact: true }).waitFor();
    await guestDock.getByText(catalog[1].metadata.title).waitFor();
    assert.equal(await guestPosition.inputValue(), '34');
    await guestDock.getByRole('button', { name: 'Play', exact: true }).waitFor();
    await hostPage.getByRole('button', { name: 'leave jam' }).click();
    await hostPage.getByRole('button', { name: 'join jam', exact: true }).click();
    await hostPage.getByText('connected', { exact: true }).waitFor();
    assert.equal(joins, 3);
    assert.deepEqual(commands.map(command => command.action), ['play', 'pause', 'seek', 'replaceQueue', 'replaceQueue', 'selectTrack']);
    assert.deepEqual(soloCommands, [], 'room actions do not touch the personal queue');
    assert.deepEqual(errors, []);
    console.log('Jam host created a Space, invited a guest, and both clients followed play, pause and seek.');
  } finally {
    firstAdd.resolve();
    await hostTab.context.close();
    await guestTab.context.close();
  }
}

async function verifySoloHandoff({ page, context }, room) {
  const solo = Promise.withResolvers();
  const jam = Promise.withResolvers();
  const soloPlayback = 'https://api.next.plyr.fm/v1/tracks/' + catalog[1].id + '/playback';
  const join = coordinator + '/v1/jams/join';
  await context.route(soloPlayback, async route => { await solo.promise; await route.fallback(); });
  await context.route(join, async route => { await jam.promise; await route.fallback(); });
  try {
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'home', exact: true }).click();
    const requested = page.waitForRequest(soloPlayback);
    await page.getByTestId('home-track-row').nth(1).getByRole('button', { name: /^play/i }).click();
    await requested;
    await page.goBack();
    await page.waitForURL(room);
    const admitting = page.waitForRequest(join);
    await page.getByRole('button', { name: 'create jam with current track' }).click();
    await admitting;
    await page.getByText('connecting to the jam…', { exact: true }).waitFor();
    solo.resolve();
    const leaked = await page.waitForFunction(() => window.jamAudio.some(audio => !audio.paused), undefined, { timeout: 4000 })
      .then(() => true, error => { if (error.name !== 'TimeoutError') throw error; return false; });
    assert.equal(leaked, false, 'a late personal audio load must not start while the Jam is connecting');
    console.log('A delayed personal audio load stayed paused during Jam admission.');
  } finally { solo.resolve(); jam.resolve(); }
}

(async () => {
  const accounts = await fixtureAccounts(['sveltejamhost', 'sveltejamguest']);
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try { await run(browser, accounts); await run(browser, accounts, { delayedSolo: true }); }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
