const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { fixtureAccounts, fixturePage, authorizeFixture } = require('./pds-browser-fixture.cjs');
const { tracks, serveAudio } = require('./fixture-catalog.cjs');

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
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith('/comments') && failCommentsRead) return route.fulfill({ status: 503, json: {} });
      if (pathname === '/v1/tracks/resolve') return route.fulfill({ json: { data: [track], missing: [] } });
      if (pathname.endsWith('/playback')) return route.fulfill({ json: {
        availability: { status: 'available', delivery: { url: 'https://panel-fixture.invalid/audio.wav' } }
      } });
      if (pathname === '/v1/tracks/' + track.id) return route.fulfill({ json: track });
      if (route.request().method() !== 'GET') return route.abort();
      return route.fulfill({ json: { data: [], has_more: false } });
    });
    await context.route('https://panel-fixture.invalid/**', route => route.request().url().endsWith('/audio.wav')
      ? serveAudio(route)
      : route.fulfill({ status: 404 }));
    let client;
    let joins = 0;
    await context.route(coordinator + '/v1/playback/join', route => {
      const request = route.request().postDataJSON();
      assert.ok(typeof request.serviceToken === 'string' && request.serviceToken.split('.').length === 3);
      client = request.clientId;
      joins++;
      return route.fulfill({ json: { ticket: 'fixture-ticket', connectionId: 'fixture-socket' } });
    });
    await context.routeWebSocket('wss://jams.next.plyr.fm/v1/jams/socket?ticket=fixture-ticket', socket => {
      const personal = { explicitEnd: 1, tailKind: null, label: null, repeat: 'off', keepPlaying: false, cursor: null, output: null, disconnected: false };
      const state = {
        epoch: 'fixture-epoch', revision: 1, occurrence: 1,
        queue: [{ id: track.id, uri: track.record.uri, cid: track.record.cid, key: 'saved', durationMs: 240_000 }],
        index: 0, playing: false, positionMs: 12_000, updatedAtMs: Date.now(), personal
      };
      socket.send(JSON.stringify({ type: 'state', state }));
      socket.onMessage(message => {
        const command = JSON.parse(String(message));
        if (command.action !== 'play') return;
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
    await panel.getByText('could not load comments.', { exact: false }).waitFor();

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
    failCommentsRead = false;
    await panel.getByRole('button', { name: 'try again', exact: true }).click();
    await panel.getByText('no comments yet.').waitFor();
    assert.deepEqual((await fetch(records).then(response => response.json())).records, []);
    await panel.getByRole('button', { name: 'Close comments' }).click();

    await page.getByRole('link', { name: 'settings' }).click();
    await page.getByText('your queue syncs across devices.').waitFor();
    const revoked = page.waitForResponse(response => response.url() === 'https://pds.fixture.test/oauth/revoke' && response.ok());
    await page.getByRole('button', { name: 'sign out' }).click();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'sign in' }).waitFor();
    await revoked;
    await dock.waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
    console.log('Svelte OAuth, queue restoration, timed PDS comment and sign-out passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
