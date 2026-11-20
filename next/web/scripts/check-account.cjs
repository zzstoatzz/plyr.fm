const restoredListening = require('./restored-listening-account.cjs');
const { EventEmitter, once } = require('node:events');
const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { fixtureAccounts, fixturePage, authorizeFixture } = require('./pds-browser-fixture.cjs');
const { tracks, serveAudio } = require('./fixture-catalog.cjs');
const { method, names, trackIdFromUri } = require('./xrpc-fixture.cjs');

const origin = 'https://next.plyr.fm';
const track = { ...tracks[0], record: { ...tracks[0].record, cid: 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5kpqcsgz7soitae' } };
const coordinator = 'https://jams.next.plyr.fm';

(async () => {
  const accounts = await fixtureAccounts(['sveltequeue']);
  const handle = 'sveltequeue.test';
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    let discardCommentReceipt = false;
    const { page, context } = await fixturePage(browser, accounts, {
      dist: process.env.PLAYER_DIST || path.resolve(__dirname, '../build'),
      discardPdsResponse(pathname) {
        if (!discardCommentReceipt || !pathname.endsWith('/com.atproto.repo.createRecord')) return false;
        discardCommentReceipt = false;
        return true;
      }
    });
    const errors = [];
    let failCommentsRead = true;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('https://typeahead.waow.tech/**', route => route.fulfill({ json: { actors: [] } }));
    await page.route('https://api.next.plyr.fm/**', route => {
      const url = new URL(route.request().url());
      if (method(url) === 'getTrackComments') return failCommentsRead ? route.fulfill({ status: 503, json: {} })
        : route.fulfill({ json: { object: 'list', data: [], has_more: false, comments_enabled: true } });
      if (method(url) === 'getArtist' && url.searchParams.get('actor') === accounts[handle].did) {
        return route.fulfill({ json: { avatar_url: 'https://panel-fixture.invalid/avatar.svg' } });
      }
      if (method(url) === 'resolveTracks') return route.fulfill({ json: { data: [track], missing: [] } });
      if (method(url) === 'getPlayback') return route.fulfill({ json: {
        availability: { status: 'available', delivery: { url: 'https://panel-fixture.invalid/audio.wav' } }
      } });
      if (method(url) === 'getTrack' && names(url, track.id)) return route.fulfill({ json: track });
      if (route.request().method() !== 'GET') return route.abort();
      return route.fulfill({ json: { data: [], has_more: false } });
    });
    await context.route('https://panel-fixture.invalid/**', route => route.request().url().endsWith('/audio.wav')
      ? serveAudio(route)
      : route.request().url().endsWith('/avatar.svg')
        ? route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#7a52ab"/><circle cx="12" cy="12" r="6" fill="#f9c5a3"/></svg>' })
        : route.fulfill({ status: 404 }));
    let client;
    let joins = 0;
    let continuation = false;
    const coordinatorEvents = new EventEmitter();
    const preferences = { theme: 'system', accent: '#6a9fff', scale: 100, playThrough: true };
    await context.route(coordinator + '/v1/preferences', route => {
      const request = route.request().postDataJSON();
      assert.match(request.serviceToken, /^[^.]+\.[^.]+\.[^.]+$/);
      Object.assign(preferences, request.patch);
      return route.fulfill({ json: { preferences } });
    });
    await context.route(coordinator + '/v1/playback/join', route => {
      const request = route.request().postDataJSON();
      assert.ok(typeof request.serviceToken === 'string' && request.serviceToken.split('.').length === 3);
      client = request.clientId;
      joins++;
      return route.fulfill({ json: { ticket: 'fixture-ticket', connectionId: 'fixture-socket' } });
    });
    await context.routeWebSocket('wss://jams.next.plyr.fm/v1/jams/socket?ticket=fixture-ticket', socket => {
      const personal = { explicitEnd: 1, tailKind: null, label: null, repeat: 'off', keepPlaying: continuation, cursor: null, output: null, disconnected: false };
      const state = {
        epoch: 'fixture-epoch', revision: 1, occurrence: 1,
        queue: [{ id: track.id, uri: track.record.uri, cid: track.record.cid, key: 'saved', durationMs: 240_000 }],
        index: 0, playing: false, positionMs: 12_000, updatedAtMs: Date.now(), personal
      };
      socket.send(JSON.stringify({ type: 'state', state }));
      socket.onMessage(message => {
        const command = JSON.parse(String(message));
        if (command.action === 'setContinuation') {
          continuation = command.keepPlaying;
          coordinatorEvents.emit('continuation');
          socket.send(JSON.stringify({ type: 'result', id: command.id, outcome: 'applied',
            state: { ...state, revision: 3, personal: { ...personal, keepPlaying: continuation } } }));
          return;
        }
        if (command.action === 'playContext') {
          coordinatorEvents.emit('playContext', command);
          Object.assign(state, { queue: command.queue, index: command.index, playing: command.playing, revision: state.revision + 1 });
        }
        if (command.action !== 'play' && command.action !== 'playContext') return;
        const playing = { ...state, playing: true, revision: 2, updatedAtMs: Date.now(),
          personal: { ...personal, output: { clientId: client, connectionId: 'fixture-socket' } } };
        socket.send(JSON.stringify({ type: 'result', id: command.id, outcome: 'applied', state: playing }));
      });
    });
    const trackPath = '/track/' + track.id;
    let oauthLoads = 0;
    await context.route(origin + '/oauth-client-metadata.json', route => { oauthLoads++; return route.fallback(); });
    await page.goto(origin + trackPath);
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'sign in' }).waitFor();
    await page.getByRole('heading', { name: track.metadata.title, exact: true }).waitFor();
    assert.equal(await page.evaluate(async () => (await indexedDB.databases()).some(database => database.name === '@atproto-oauth-client')), false);
    assert.equal(oauthLoads, 0, 'cold public pages skip the OAuth client');
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'sign in' }).click();
    await authorizeFixture(page, accounts, handle);
    await page.waitForURL(origin + trackPath);
    const dock = page.getByTestId('player-dock');
    await dock.getByText(track.metadata.title).waitFor();
    assert.ok(joins > 0, 'real PDS session minted a coordinator service token');
    assert.equal(await page.evaluate(() => window.jamAudio.length), 0, 'restored queue stays paused');
    const position = await dock.getByRole('slider', { name: 'Playback position' }).inputValue();
    assert.equal(Number(position), 12);
    await dock.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => window.jamAudio.some(audio => !audio.paused && audio.currentTime >= 12), undefined, { timeout: 10_000 })
      .catch(async error => {
        console.log('playback state', await page.evaluate(() => window.jamAudio.map(audio => ({
          paused: audio.paused, position: audio.currentTime, ready: audio.readyState, error: audio.error?.code
        }))));
        throw error;
      });
    const rejoin = page.waitForResponse(response => response.url() === coordinator + '/v1/playback/join' && response.ok());
    await page.reload();
    await rejoin;
    await dock.getByRole('button', { name: 'Play', exact: true }).waitFor();
    assert.ok(joins >= 2, 'SDK restores the OAuth session across reload');
    await context.addInitScript(() => {
      indexedDB.databases = () => Promise.reject(new DOMException('fixture cannot list databases', 'NotSupportedError'));
    });
    const fallbackJoin = page.waitForResponse(response => response.url() === coordinator + '/v1/playback/join' && response.ok());
    await page.reload();
    await fallbackJoin;
    await dock.getByRole('button', { name: 'Play', exact: true }).waitFor();
    assert.ok(joins >= 3, 'SDK restore still runs when database enumeration is unavailable');

    await page.getByRole('button', { name: 'comments', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'comments' });
    const draft = panel.getByRole('textbox', { name: 'add a comment' });
    await panel.getByText('could not load comments.', { exact: false }).waitFor();
    assert.equal(await draft.count(), 0, 'no composer until the artist is known to allow comments');
    failCommentsRead = false;
    await panel.getByRole('button', { name: 'try again', exact: true }).click();
    await draft.fill('fixture comment at the restored position');
    let failComment = true;
    await context.route('https://pds.fixture.test/xrpc/com.atproto.repo.createRecord', route => {
      if (route.request().method() !== 'POST' || !failComment) return route.fallback();
      failComment = false;
      return route.fulfill({ status: 400, json: { error: 'InvalidRequest' }, headers: { 'access-control-allow-origin': origin } });
    });
    await panel.getByRole('button', { name: 'post comment' }).click();
    await panel.getByText('could not post your comment. try again.').waitFor();
    assert.equal(await draft.inputValue(), 'fixture comment at the restored position');
    discardCommentReceipt = true;
    await panel.getByRole('button', { name: 'post comment' }).click();
    await panel.getByText('fixture comment at the restored position', { exact: true }).waitFor();
    assert.equal(discardCommentReceipt, false, 'the accepted PDS response was discarded');

    const pds = 'http://127.0.0.1:5197/xrpc/';
    const records = pds + 'com.atproto.repo.listRecords?' + new URLSearchParams({
      repo: accounts[handle].did, collection: 'fm.plyr.comment'
    });
    const published = await fetch(records).then(response => response.json());
    assert.equal(published.records.length, 1);
    assert.equal(published.records[0].value.timestampMs, 12_000);
    assert.deepEqual(published.records[0].value.subject, { uri: track.record.uri, cid: track.record.cid });
    const deleted = page.waitForResponse(response => response.url().endsWith('/com.atproto.repo.deleteRecord') && response.request().method() === 'POST' && response.ok());
    await panel.getByRole('button', { name: 'Delete comment', exact: true }).click();
    await panel.getByRole('button', { name: 'delete', exact: true }).click();
    await deleted;
    await panel.getByText('no comments yet.').waitFor();
    assert.deepEqual((await fetch(records).then(response => response.json())).records, []);
    await panel.getByRole('button', { name: 'Close comments' }).click();

    const desktopNav = page.getByRole('navigation', { name: 'Main navigation' });
    const you = desktopNav.getByRole('button', { name: /^you\b/ });
    const accountMenu = page.getByRole('dialog', { name: 'account', exact: true });
    assert.equal(await desktopNav.getByRole('link', { name: 'settings', exact: true }).count(), 0, 'settings lives in the account menu');
    await you.click();
    await accountMenu.getByRole('link', { name: 'portal @' + handle }).click();
    await page.waitForURL('**/portal');
    assert.equal(await you.getAttribute('aria-current'), 'page', 'the account card marks the portal as current');
    assert.equal(await desktopNav.locator('[aria-current="page"]:visible').count(), 1);
    await you.click();
    const menuBox = await accountMenu.boundingBox();
    assert.ok(menuBox.y + menuBox.height <= (await you.boundingBox()).y + 1, 'the desktop account menu opens above the account card');
    await accountMenu.getByRole('link', { name: /^settings/ }).click();
    await page.waitForURL('**/settings');
    assert.equal(await desktopNav.locator('[aria-current="page"]:visible').count(), 1);
    assert.equal(await you.getAttribute('aria-current'), 'page');
    await mkdir('/tmp/plyr-desktop-restoration', { recursive: true });
    await page.screenshot({ path: '/tmp/plyr-desktop-restoration/signed-in-settings.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const account = nav.getByRole('button', { name: /^you\b/ });
    const menu = page.getByRole('dialog', { name: 'account', exact: true });
    await page.waitForFunction(() => document.querySelector('.account img')?.naturalWidth > 0);
    const activePath = new URL(page.url()).pathname;
    await account.focus();
    await account.press('Enter');
    await menu.waitFor();
    assert.equal(new URL(page.url()).pathname, activePath, 'opening the account menu keeps the current page');
    await menu.getByRole('link', { name: 'portal @' + handle }).waitFor();
    assert.equal(await menu.getByRole('link', { name: /private music/ }).count(), 0);
    assert.ok(await menu.evaluate(node => node.scrollWidth <= node.clientWidth));
    if (process.env.SCREENS_OUTPUT) {
      await mkdir(process.env.SCREENS_OUTPUT, { recursive: true });
      await page.screenshot({ path: path.join(process.env.SCREENS_OUTPUT, 'next-account-mobile.png') });
    }
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    await page.waitForFunction(element => document.activeElement === element, await account.elementHandle());
    await nav.getByRole('link', { name: 'library', exact: true }).click();
    await page.waitForURL(origin + '/library');
    await account.click();
    await menu.waitFor();
    await page.goBack();
    await page.waitForURL(origin + activePath);
    await menu.waitFor({ state: 'hidden' });
    await account.click();
    await menu.getByRole('link', { name: /^settings/ }).click();
    await page.waitForURL(origin + '/settings');
    await menu.waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: 'appearance', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'playback', exact: true }).waitFor();
    assert.equal(await page.locator('main').getByRole('link', { name: /your music|upload|portal/i }).count(), 0);
    assert.equal(await page.getByText(/queue sync|queue stays|queue is saved/i).count(), 0);
    if (process.env.SCREENS_OUTPUT) {
      await page.screenshot({ path: path.join(process.env.SCREENS_OUTPUT, 'next-settings-mobile.png') });
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.getByRole('radio', { name: 'dark', exact: true }).check();
    const swatches = await page.locator('.swatch i').evaluateAll(items => items.map(item => getComputedStyle(item).backgroundColor));
    assert.equal(new Set(swatches).size, 4, 'the color buttons show distinct colors');
    await page.getByRole('radio', { name: 'violet', exact: true }).check();
    await page.getByRole('radio', { name: 'large', exact: true }).check();
    const playThrough = page.getByRole('switch', { name: 'play through collections' });
    await playThrough.uncheck();
    const keepPlaying = page.getByRole('switch', { name: 'keep playing' });
    const updated = once(coordinatorEvents, 'continuation', { signal: AbortSignal.timeout(10_000) });
    const synced = page.waitForResponse(response => response.url() === coordinator + '/v1/preferences'
      && response.request().postDataJSON().patch?.keepPlaying === true && response.ok());
    await keepPlaying.check();
    await updated;
    assert.equal(continuation, true, 'continuation updates the personal playback service');
    await synced;
    assert.deepEqual(preferences, { theme: 'dark', accent: '#c2a2ff', scale: 115, playThrough: false, keepPlaying: true });
    await page.evaluate(did => localStorage.removeItem('plyr-next:prefs:' + did), accounts[handle].did);
    await page.reload();
    await page.locator('input[aria-label="keep playing"]:checked').waitFor();
    await playThrough.waitFor();
    assert.equal(await playThrough.isChecked(), false);
    assert.equal(await page.getByRole('radio', { name: 'dark', exact: true }).isChecked(), true);
    assert.equal(await page.getByRole('radio', { name: 'violet', exact: true }).isChecked(), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'dark');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '18.4px');
    if (process.env.SCREENS_OUTPUT) {
      await page.screenshot({ path: path.join(process.env.SCREENS_OUTPUT, 'next-settings-mobile-dark.png') });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await nav.getByRole('button', { name: /^you\b/ }).waitFor();
    await restoredListening({ page, context, origin, coordinatorEvents, track, did: accounts[handle].did });
    const revoked = page.waitForResponse(response => response.url() === 'https://pds.fixture.test/oauth/revoke' && response.ok());
    await page.getByRole('button', { name: 'sign out' }).click();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'sign in' }).waitFor();
    await revoked;
    await dock.waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
    console.log('Svelte OAuth, queue restoration, timed PDS comment and sign-out passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
