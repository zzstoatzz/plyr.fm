const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { authorizeFixture, fixtureAccounts, fixturePage } = require('./pds-browser-fixture.cjs');

const origin = 'https://next.plyr.fm';
const pds = 'http://127.0.0.1:5197/xrpc/';
const collection = 'fm.plyr.track';
const profileCollection = 'fm.plyr.actor.profile';
const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-svelte-creator';
const author = 'A musician with a long display name';
const fixtureTime = '2026-11-05T18:00:00Z';

async function call(method, token, params, input) {
  const response = await fetch(pds + method + (params ? '?' + new URLSearchParams(params) : ''), {
    method: input ? 'POST' : 'GET',
    headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(input ? { 'content-type': 'application/json' } : {}) },
    body: input ? JSON.stringify(input) : undefined
  });
  const data = await response.json();
  if (!response.ok && data.error !== 'RecordNotFound') throw new Error(`${method} failed with ${response.status}: ${data.error}`);
  return data;
}

async function run(browser, accounts, width, theme, mp3) {
  const handle = 'creator-web.test';
  const did = accounts[handle].did;
  const { accessJwt } = await call('com.atproto.server.createSession', undefined, undefined, { identifier: handle, password: accounts[handle].pass });
  const pdsRecord = (recordCollection, key) => call('com.atproto.repo.getRecord', accessJwt, { repo: did, collection: recordCollection, rkey: key });
  const pdsWrite = (recordCollection, rkey, record, swapRecord) => call('com.atproto.repo.putRecord', accessJwt, undefined, { repo: did, collection: recordCollection, rkey, record, swapRecord });
  const rkey = `creator-${width}-${theme}-${Date.now().toString(36)}`;
  const seed = { $type: collection, title: 'late recording', artist: author, fileType: 'mp3', audioUrl: 'https://fixture.invalid/audio.mp3', createdAt: fixtureTime, tags: ['ambient'], unseen: { preserved: true } };
  const { uri } = await pdsWrite(collection, rkey, seed);
  const id = 'trk_' + Buffer.from(uri).toString('base64url');
  const seededProfile = await pdsWrite(profileCollection, 'self', {
    $type: profileCollection, bio: 'fixture profile bio', avatar: 'https://fixture.invalid/old.png', createdAt: fixtureTime, favoriteTrack: uri
  });
  let projected = { ...seed, cid: (await pdsRecord(collection, rkey)).cid };
  const row = index => ({
    object: 'track', id: index === 25 ? id : `trk_fixture_${index}`,
    record: { uri: index === 25 ? uri : `at://${did}/${collection}/t${index}`, cid: index === 25 ? projected.cid : 'fixture' + index, collection, revision: null },
    metadata: { title: index === 25 ? projected.title : `recording ${index}`, artist_name: author, album: null, duration_seconds: 180, description: null, created_at: fixtureTime },
    artist: { did, profile: { handle, display_name: author } }, media: { artwork: null }, access: { visibility: 'public' }, metrics: { play_count: index, like_count: 0 }
  });
  const album = { object: 'album', id: 'alb_sample', record: { uri: `at://${did}/fm.plyr.list/album` }, metadata: { name: 'demo album' }, owner: { did, profile: { handle, display_name: author } }, metrics: { member_count: 1, available_count: 1 }, media: { artwork: null } };
  const emptyAlbum = { ...album, id: 'alb_empty', record: { uri: `at://${did}/fm.plyr.list/empty` }, metadata: { name: 'draft album' }, metrics: { member_count: 0, available_count: 0 } };
  const list = (data, cursor) => ({ object: 'list', data, has_more: !!cursor, next_cursor: cursor });
  const { context, page } = await fixturePage(browser, accounts, {
    dist: path.resolve(__dirname, '../build'),
    context: { viewport: { width, height: 900 }, colorScheme: theme }
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let initialError = true, moreError = true, profileReadError = false, profileWrites = 0;
  let trackMissing = false;
  const albumRequests = [];
  await context.route('https://typeahead.waow.tech/**', route => route.fulfill({ json: { actors: [] } }));
  await context.route('https://jams.next.plyr.fm/**', route => route.fulfill({ status: 403, json: {} }));
  await context.route('https://fixture.invalid/**', route => route.fulfill({ status: 404, body: '' }));
  await context.route('https://api.next.plyr.fm/**', async route => {
    assert.equal(route.request().method(), 'GET', 'creator activity never writes to the AppView');
    const url = new URL(route.request().url());
    if ([`/v1/artists/${did}`, `/v1/artists/${handle}`].includes(decodeURIComponent(url.pathname))) return route.fulfill({ json: { display_name: author, handle, did } });
    if (url.pathname === '/v1/tracks') {
      assert.equal(url.searchParams.get('artist_did'), did);
      if (initialError) { initialError = false; return route.fulfill({ status: 503, json: { error: { message: 'fixture catalog unavailable' } } }); }
      if (url.searchParams.get('cursor') === 'next') {
        if (moreError) { moreError = false; return route.fulfill({ status: 503, json: { error: { message: 'fixture next page unavailable' } } }); }
        return route.fulfill({ json: list(trackMissing ? [] : [row(25)]) });
      }
      return route.fulfill({ json: list(Array.from({ length: 25 }, (_, index) => row(index)), 'next') });
    }
    if (url.pathname === '/v1/albums') {
      assert.equal(url.searchParams.get('artist_did'), did);
      albumRequests.push(url.search);
      return route.fulfill({ json: list([album, emptyAlbum]) });
    }
    if (url.pathname === `/v1/tracks/${id}`) return route.fulfill({ json: row(25) });
    if (url.pathname === '/v1/records/await') {
      const address = url.searchParams.get('uri');
      if (address === uri) {
        const record = await pdsRecord(collection, rkey);
        if (record.error === 'RecordNotFound') { trackMissing = true; return route.fulfill({ json: { status: 'deleted' } }); }
        assert.equal(url.searchParams.get('cid'), record.cid);
        projected = { ...record.value, cid: record.cid };
      }
      return route.fulfill({ json: { status: 'indexed' } });
    }
    return route.fulfill({ json: list([]) });
  });
  await context.route('https://pds.fixture.test/xrpc/com.atproto.repo.putRecord', route => {
    const input = route.request().postDataJSON();
    if (input.collection === profileCollection) {
      profileWrites++;
      assert.equal(input.swapRecord, seededProfile.cid);
      assert.equal(input.record.favoriteTrack, uri);
      profileReadError = true;
    }
    return route.fallback();
  });
  await context.route('https://pds.fixture.test/xrpc/com.atproto.repo.getRecord?**', route => {
    const url = new URL(route.request().url());
    if (profileReadError && url.searchParams.get('collection') === profileCollection) {
      profileReadError = false;
      return route.fulfill({ status: 503, json: { error: 'Unavailable', message: 'fixture profile read failed' } });
    }
    return route.fallback();
  });

  const main = page.locator('main');
  const capture = async name => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' fits the window');
    await page.screenshot({ path: path.join(output, `${width}-${theme}-${name}.png`) });
  };
  try {
    await page.goto(origin + '/portal');
    await main.getByText('sign in to manage your music.').waitFor();
    await capture('signed-out');
    await main.getByRole('link', { name: 'sign in', exact: true }).click();
    await authorizeFixture(page, accounts, handle);
    await page.waitForURL(origin + '/portal');
    await main.getByRole('heading', { name: author }).waitFor();
    await main.getByRole('button', { name: 'retry', exact: true }).click();
    await main.getByRole('link', { name: 'edit recording 24' }).waitFor();
    await capture('portal');
    assert.equal(albumRequests.length, 0, 'inactive albums stay unloaded');

    const tracksTab = main.getByRole('tab', { name: 'tracks' });
    const albumsTab = main.getByRole('tab', { name: 'albums' });
    await tracksTab.focus();
    await tracksTab.press('ArrowRight');
    await main.getByRole('link', { name: 'demo album' }).waitFor();
    assert.equal(await albumsTab.getAttribute('aria-selected'), 'true');
    await albumsTab.press('ArrowLeft');
    const more = main.getByRole('button', { name: 'more tracks' });
    await more.click();
    await main.getByRole('button', { name: 'retry', exact: true }).click();
    await main.getByRole('link', { name: 'edit late recording' }).waitFor();
    assert.equal(await main.getByRole('link', { name: 'edit recording 24' }).count(), 1);

    const editTrack = main.getByRole('link', { name: 'edit late recording' });
    await editTrack.scrollIntoViewIfNeeded();
    const previousScroll = await page.evaluate(() => scrollY);
    await editTrack.click();
    const title = main.getByRole('textbox', { name: 'title', exact: true });
    await title.waitFor();
    assert.equal(await title.inputValue(), 'late recording');
    await main.getByRole('link', { name: 'Close', exact: true }).click();
    await main.getByRole('link', { name: 'edit late recording' }).waitFor();
    await page.waitForFunction(previous => Math.abs(scrollY - previous) < 30, previousScroll);
    await editTrack.click();
    await title.waitFor();
    await pdsWrite(collection, rkey, { ...seed, description: 'edited elsewhere' }, projected.cid);
    await title.fill('draft survives conflict');
    await main.getByRole('button', { name: 'save', exact: true }).click();
    await main.getByText('this track changed elsewhere. reload the latest version before saving.').waitFor();
    assert.equal(await title.inputValue(), 'draft survives conflict');
    await capture('track-conflict');
    await main.getByRole('button', { name: 'discard draft and reload' }).click();
    await main.getByRole('textbox', { name: 'description' }).waitFor();
    assert.equal(await main.getByRole('textbox', { name: 'description' }).inputValue(), 'edited elsewhere');
    await title.fill('recording after edit');
    await main.getByLabel('replace audio', { exact: true }).setInputFiles({ name: 'replacement.mp3', mimeType: 'audio/mpeg', buffer: mp3 });
    await main.getByRole('button', { name: 'save', exact: true }).click();
    await page.waitForURL(origin + '/track/' + id);
    await main.getByRole('heading', { name: 'recording after edit' }).waitFor();
    const saved = await pdsRecord(collection, rkey);
    assert.equal(saved.uri, uri);
    assert.equal(saved.value.title, 'recording after edit');
    assert.equal(saved.value.audioBlob.size, mp3.length);
    assert.deepEqual(saved.value.unseen, seed.unseen);

    await page.goBack();
    await main.getByRole('link', { name: 'edit recording after edit' }).waitFor();
    await main.getByRole('link', { name: 'edit profile' }).click();
    const bio = main.getByRole('textbox', { name: 'bio', exact: true });
    await bio.fill('bio saved in Svelte');
    const avatar = main.getByRole('textbox', { name: 'avatar URL', exact: true });
    await avatar.fill('http://example.com/cover.png');
    await main.getByRole('button', { name: 'save profile' }).click();
    await main.getByText('use an HTTPS avatar URL.').waitFor();
    assert.equal(profileWrites, 0);
    assert.equal(await bio.inputValue(), 'bio saved in Svelte');
    await avatar.fill('https://fixture.invalid/new.png');
    await main.getByRole('button', { name: 'save profile' }).click();
    await main.getByText('your changes are saved, but the latest profile could not be loaded.').waitFor();
    assert.equal(profileWrites, 1);
    await main.getByRole('button', { name: 'retry loading profile' }).click();
    await main.getByRole('button', { name: 'edit again' }).waitFor();
    assert.equal(await bio.inputValue(), 'bio saved in Svelte');
    assert.equal((await pdsRecord(profileCollection, 'self')).value.favoriteTrack, uri);
    assert.equal(profileWrites, 1);
    await capture('profile-saved');

    await main.getByRole('link', { name: 'back to your music' }).click();
    await main.getByRole('link', { name: 'edit recording after edit' }).click();
    await main.getByRole('button', { name: 'delete track', exact: true }).click();
    await main.getByRole('button', { name: 'cancel delete' }).click();
    assert.equal((await pdsRecord(collection, rkey)).uri, uri);
    await main.getByRole('button', { name: 'delete track', exact: true }).click();
    await main.getByRole('button', { name: 'confirm delete' }).click();
    await page.waitForURL(origin + '/portal');
    await main.getByRole('link', { name: 'edit recording after edit' }).waitFor({ state: 'detached' });
    assert.equal((await pdsRecord(collection, rkey)).error, 'RecordNotFound');
    await main.getByRole('link', { name: /view your public profile/ }).click();
    await main.getByRole('link', { name: 'edit profile', exact: true }).waitFor();
    await main.getByRole('tab', { name: 'albums' }).click();
    await main.getByRole('link', { name: 'new album', exact: true }).waitFor();
    await main.getByRole('link', { name: 'draft album 0 tracks', exact: true }).waitFor();
    await capture('artist-owner');
    assert.deepEqual(errors, []);
    console.log(`creator portal, paging, track/profile edits and deletion passed at ${width}px (${theme})`);
  } finally { await context.close(); }
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const mp3 = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=430:duration=1', '-f', 'mp3', 'pipe:1']);
  const accounts = await fixtureAccounts(['creator-web']);
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
      await run(browser, accounts, width, theme, mp3);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
