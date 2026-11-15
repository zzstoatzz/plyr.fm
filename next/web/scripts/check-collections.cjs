const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { authorizeFixture, fixtureAccounts, fixturePage } = require('./pds-browser-fixture.cjs');
const { serveAudio } = require('./fixture-catalog.cjs');

const origin = 'https://next.plyr.fm';
const pds = 'http://127.0.0.1:5197/xrpc/';
const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-svelte-collections';
const time = '2026-11-09T12:00:00Z';
const trackCollection = 'fm.plyr.track';
const listCollection = 'fm.plyr.list';
const likeCollection = 'fm.plyr.like';
const typePrefix = { track: 'trk', playlist: 'pls', album: 'alb' };
const itemId = (kind, uri) => typePrefix[kind] + '_' + Buffer.from(uri).toString('base64url');

async function xrpc(method, { token, params, input } = {}) {
  const response = await fetch(pds + method + (params ? '?' + new URLSearchParams(params) : ''), {
    method: input ? 'POST' : 'GET',
    headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(input ? { 'content-type': 'application/json' } : {}) },
    body: input ? JSON.stringify(input) : undefined
  });
  const data = await response.json();
  if (!response.ok && data.error !== 'RecordNotFound') throw new Error(`${method} failed: ${response.status} ${data.error}`);
  return data;
}

async function check(browser, accounts, width, scheme) {
  const handle = `col${width}${scheme}.test`;
  const did = accounts[handle].did;
  const { accessJwt: token } = await xrpc('com.atproto.server.createSession', { input: { identifier: handle, password: accounts[handle].pass } });
  const read = uri => xrpc('com.atproto.repo.getRecord', { token, params: { repo: did, collection: uri.split('/').at(-2), rkey: uri.split('/').at(-1) } });
  const list = collection => xrpc('com.atproto.repo.listRecords', { token, params: { repo: did, collection } });
  const put = (collection, key, record) => xrpc('com.atproto.repo.putRecord', { token, input: { repo: did, collection, rkey: key, record } });
  const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMTsAAAAASUVORK5CYII=';
  const identity = { handle, display_name: 'Fixture Artist', avatar_url: avatar };
  const tracks = [];
  for (const [index, title] of ['Alpha', 'Beta', 'Gamma'].entries()) {
    const rkey = 'demo-' + (index + 1);
    const { uri, cid } = await put(trackCollection, rkey, { $type: trackCollection, title, fileType: 'mp3', audioUrl: 'https://fixture.invalid/audio.wav', createdAt: time });
    tracks.push({
      object: 'track', id: itemId('track', uri), record: { uri, cid, collection: trackCollection, rkey, revision: null },
      metadata: { title, created_at: time, duration_seconds: 240, artist_name: identity.display_name },
      artist: { did, profile: identity }, access: { visibility: 'public' }, media: { artwork: null },
      metrics: { play_count: 1, like_count: 0 }
    });
  }
  const subject = track => ({ uri: track.record.uri, cid: track.record.cid });
  const staleCid = tracks[1].record.cid;
  const stale = await put(listCollection, 'outdated', {
    $type: listCollection, listType: 'playlist', name: 'Unavailable recordings', createdAt: time, items: [{ subject: { uri: tracks[0].record.uri, cid: staleCid } }]
  });
  const projection = new Map([[stale.uri, await read(stale.uri)]]);
  let deferred = new Set();
  const listPage = rows => ({ object: 'list', data: rows, has_more: false });
  function listDetail({ uri, cid, value }) {
    const id = itemId(value.listType, uri);
    const members = value.items.map(({ subject }, position) => {
      const track = tracks.find(track => track.record.uri === subject.uri && track.record.cid === subject.cid) ?? null;
      return { position, subject, track, availability: track ? 'available' : 'unavailable' };
    });
    return {
      object: value.listType, id, record: { uri, cid, collection: listCollection, rkey: uri.split('/').at(-1) },
      metadata: { name: value.name, created_at: time, cover_blob_cid: value.imageBlob?.ref?.$link }, owner: { did, profile: identity },
      media: { artwork: null }, members,
      metrics: { member_count: members.length, available_count: members.filter(member => member.track).length, total_plays: 0 }
    };
  }
  let loseCreate = true, creates = 0, playlistUri, albumUri;
  let createBody;
  const { page, context } = await fixturePage(browser, accounts, {
    dist: path.resolve(__dirname, '../build'), context: { viewport: { width, height: 900 }, colorScheme: scheme },
    discardPdsResponse(endpoint) {
      if (!loseCreate || endpoint !== '/xrpc/com.atproto.repo.createRecord' || createBody?.record?.listType !== 'playlist') return false;
      loseCreate = false;
      return true;
    }
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('https://typeahead.waow.tech/**', route => route.fulfill({ json: { actors: [] } }));
  await context.route('https://jams.next.plyr.fm/**', route => route.fulfill({ status: 403, json: {} }));
  await context.route('https://pds.fixture.test/xrpc/com.atproto.repo.createRecord', route => {
    createBody = route.request().postDataJSON();
    if (createBody.collection === listCollection) {
      creates++;
      const uri = `at://${did}/${listCollection}/${createBody.rkey}`;
      if (createBody.record.listType === 'album') albumUri = uri;
      else playlistUri = uri;
    }
    return route.fallback();
  });
  await context.route('https://fixture.invalid/audio.wav', serveAudio);
  await context.route('https://api.next.plyr.fm/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/v1/tracks/resolve') {
      const { ids } = route.request().postDataJSON();
      return route.fulfill({ json: { data: tracks.filter(track => ids.includes(track.id)), missing: [] } });
    }
    assert.equal(route.request().method(), 'GET', 'the AppView only receives reads');
    if (url.pathname === '/v1/records/await') {
      const uri = url.searchParams.get('uri');
      if (deferred.has(uri)) return route.fulfill({ json: { status: 'pending' } });
      if (uri.includes('/' + listCollection + '/')) {
        const record = await read(uri);
        if (record.error === 'RecordNotFound') { projection.delete(uri); return route.fulfill({ json: { status: 'deleted' } }); }
        assert.equal(record.cid, url.searchParams.get('cid'));
        projection.set(uri, record);
      }
      return route.fulfill({ json: { status: 'indexed' } });
    }
    if (url.pathname === '/v1/playlists' || url.pathname === '/v1/albums') {
      const kind = url.pathname === '/v1/albums' ? 'album' : 'playlist';
      return route.fulfill({ json: listPage([...projection.values()].filter(record => record.value.listType === kind).map(listDetail)) });
    }
    if (/^\/v1\/(albums|playlists)\//.test(url.pathname)) {
      const detail = [...projection.values()].map(listDetail).find(item => url.pathname.endsWith('/' + item.id));
      return detail ? route.fulfill({ json: detail }) : route.fulfill({ status: 404, json: {} });
    }
    if (url.pathname.endsWith('/likes') && url.pathname.startsWith('/v1/actors/')) {
      const likes = (await list(likeCollection)).records;
      return route.fulfill({ json: listPage(tracks.filter(track => likes.some(({ value }) => value.subject.uri === track.record.uri))) });
    }
    if (url.pathname.endsWith('/playback')) return route.fulfill({ json: { availability: { status: 'available', delivery: { url: 'https://fixture.invalid/audio.wav' } } } });
    if (url.pathname === '/v1/tracks') return route.fulfill({ json: listPage(tracks) });
    const track = tracks.find(item => url.pathname.endsWith('/' + item.id));
    if (track) return route.fulfill({ json: track });
    return route.fulfill({ json: listPage([]) });
  });

  let staleTrack = false;
  await context.route('https://pds.fixture.test/xrpc/com.atproto.repo.getRecord?*', route => {
    const url = new URL(route.request().url());
    if (!staleTrack || url.searchParams.get('collection') !== trackCollection) return route.fallback();
    const uri = 'at://' + did + '/' + trackCollection + '/' + url.searchParams.get('rkey');
    return route.fulfill({ json: { uri, cid: staleCid, value: { $type: trackCollection, title: 'Changed' } } });
  });

  let failCover = false;
  let holdCover;
  await context.route('https://pds.fixture.test/xrpc/com.atproto.repo.uploadBlob', async route => {
    if (holdCover) await holdCover();
    if (!failCover) return route.fallback();
    return route.fulfill({ status: 503, json: { error: 'Unavailable', message: 'cover upload unavailable' } });
  });

  const main = page.locator('main');
  const cover = main.locator('header .cover img');
  const image = async (name, color) => {
    const data = await page.evaluate(color => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 32, 32);
      return canvas.toDataURL('image/png').split(',')[1];
    }, color);
    return { name, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
  };
  async function readCover() {
    const ref = (await read(albumUri)).value.imageBlob?.ref?.$link;
    assert.ok(ref, 'the signed album has a cover blob');
    await cover.waitFor();
    await page.waitForFunction(cid => [...document.querySelectorAll('main header .cover img')].some(img =>
      img.complete && img.naturalWidth === 32 && new URL(img.currentSrc).searchParams.get('cid') === cid), ref);
    return ref;
  }
  const button = name => main.getByRole('button', { name, exact: true });
  const capture = async label => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label + ' fits');
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-${label}.png`) });
  };
  try {
    await page.goto(origin + '/library');
    await main.getByText('sign in to see your liked tracks and playlists.').waitFor();
    await capture('signed-out');
    await main.getByRole('link', { name: 'sign in', exact: true }).click();
    await authorizeFixture(page, accounts, handle);
    await page.waitForURL(origin + '/library');
    await main.getByRole('link', { name: /Unavailable recordings/ }).click();
    await main.getByText('track unavailable').waitFor();
    assert.ok(await button('Play Unavailable recordings').isDisabled(), 'a superseded CID cannot play another version');
    await page.goBack();

    await button('new playlist').click();
    await main.getByRole('textbox', { name: 'playlist name' }).fill('Ordered playlist');
    await button('create playlist').click();
    await main.getByRole('heading', { name: 'Ordered playlist' }).waitFor();
    assert.equal(creates, 1, 'recovering a lost create response uses the same record address');
    assert.equal(loseCreate, false);
    assert.deepEqual((await read(playlistUri)).value.items, []);
    for (const track of tracks.slice(0, 2)) {
      await page.goto(origin + '/track/' + track.id);
      await button('add to playlist').click();
      await button('Ordered playlist').click();
      await main.getByText('added to playlist.', { exact: true }).waitFor();
      await button('Ordered playlist').click();
      await main.getByText('added to playlist.', { exact: true }).waitFor();
    }
    assert.deepEqual((await read(playlistUri)).value.items.map(item => item.subject), tracks.slice(0, 2).map(subject));

    await page.goto(origin + '/track/' + tracks[0].id);
    await button('Like track').click();
    await button('Unlike track').waitFor();
    assert.equal((await list(likeCollection)).records.length, 1);
    await page.goto(origin + '/liked');
    await main.getByRole('link', { name: 'Alpha', exact: true }).click();
    await button('Unlike track').click();
    await button('Like track').waitFor();
    assert.equal((await list(likeCollection)).records.length, 0);

    await page.goto(origin + '/playlist/' + itemId('playlist', playlistUri));
    await button('edit playlist').click();
    await main.getByRole('textbox', { name: 'playlist name' }).fill('Their order');
    await button('Move Beta up').click();
    await capture('playlist-editor');
    deferred = new Set([playlistUri]);
    await button('save changes').click();
    await main.getByRole('heading', { name: 'Their order' }).waitFor();
    const expected = tracks.slice(0, 2).reverse().map(subject);
    assert.deepEqual((await read(playlistUri)).value.items.map(item => item.subject), expected);
    assert.deepEqual((projection.get(playlistUri)).value.items.map(item => item.subject), tracks.slice(0, 2).map(subject));
    await button('Play Their order').click();
    await page.getByTestId('player-dock').getByText('Beta').waitFor();
    await page.waitForFunction(() => window.jamAudio.some(audio => !audio.paused && audio.currentTime > 0.01));
    await capture('playlist');
    deferred.clear();
    await button('edit playlist').click();
    await button('delete playlist').click();
    await button('confirm delete').click();
    await page.waitForURL(origin + '/library');
    assert.equal((await read(playlistUri)).error, 'RecordNotFound');

    await page.goto(origin + '/create-album');
    await main.getByRole('textbox', { name: 'album name' }).fill('Chosen tracks');
    await button('Add Alpha').click();
    await button('Add Beta').click();
    await button('Move Beta up').click();
    const albumCover = main.getByLabel('cover art (optional)');
    await albumCover.setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not a PNG') });
    await main.getByText('could not open this image.', { exact: false }).waitFor();
    assert.equal(await main.getByRole('textbox', { name: 'album name' }).inputValue(), 'Chosen tracks');
    await albumCover.setInputFiles(await image('first.png', '#f6635f'));
    await main.getByRole('img', { name: 'selected cover preview' }).waitFor();
    const beforeAlbum = creates;
    const coverEntered = Promise.withResolvers();
    const coverReleased = Promise.withResolvers();
    holdCover = () => {
      coverEntered.resolve();
      return coverReleased.promise;
    };
    await button('create album').click();
    await coverEntered.promise;
    staleTrack = true;
    coverReleased.resolve();
    await main.getByText('a selected track changed.', { exact: false }).waitFor();
    assert.equal(creates, beforeAlbum, 'a changed track cannot publish an album');
    assert.equal(await main.getByRole('textbox', { name: 'album name' }).inputValue(), 'Chosen tracks');
    await main.getByRole('img', { name: 'selected cover preview' }).waitFor();
    staleTrack = false;
    holdCover = undefined;
    await button('create album').click();
    await main.getByRole('heading', { name: 'Chosen tracks' }).waitFor();
    assert.deepEqual((await read(albumUri)).value.items.map(item => item.subject), expected);
    const originalCover = await readCover();
    await button('edit album').click();
    const replacementFile = await image('replacement.png', '#5277f5');
    await main.getByLabel('change album cover').setInputFiles(replacementFile);
    await button('keep current cover').click();
    assert.equal(await main.getByRole('img', { name: 'selected cover preview' }).count(), 0);
    assert.ok(await button('save changes').isDisabled());
    await main.getByLabel('change album cover').setInputFiles(replacementFile);
    await main.getByRole('img', { name: 'selected cover preview' }).waitFor();
    await capture('album-cover-editor');
    failCover = true;
    await button('save changes').click();
    await main.getByText('could not upload the cover. try saving again.', { exact: true }).waitFor();
    assert.equal((await read(albumUri)).value.imageBlob.ref.$link, originalCover);
    failCover = false;
    await button('save changes').click();
    await button('edit album').waitFor();
    const replacement = await readCover();
    assert.notEqual(replacement, originalCover);
    await page.reload();
    assert.equal(await readCover(), replacement);
    await button('edit album').click();
    await button('Remove Beta').click();
    await button('add tracks').click();
    await button('Add Gamma').click();
    await button('save changes').click();
    await button('edit album').waitFor();
    assert.deepEqual((await read(albumUri)).value.items.map(item => item.subject), [tracks[0], tracks[2]].map(subject));
    await main.getByRole('link', { name: 'Gamma', exact: true }).waitFor();
    assert.equal(await readCover(), replacement, 'membership-only edits preserve the cover');
    for (const track of tracks) assert.equal((await read(track.record.uri)).cid, track.record.cid, 'album edits leave track metadata alone');
    await capture('album');
    await context.route('https://pds.fixture.test/xrpc/com.atproto.sync.getBlob?*', route => route.fulfill({ status: 404 }));
    await page.reload();
    await page.waitForFunction(avatar => {
      const image = document.querySelector('main header .cover img');
      return image?.currentSrc === avatar && image.complete && image.naturalWidth === 1;
    }, avatar);
    assert.deepEqual(errors, []);
    console.log(`library, likes, playlist and album writes passed at ${width}px (${scheme})`);
  } finally { await context.close(); }
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const widths = [390, 1280], themes = ['light', 'dark'];
  const accounts = await fixtureAccounts(widths.flatMap(width => themes.map(scheme => `col${width}${scheme}`)));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    for (const width of widths) for (const scheme of themes) await check(browser, accounts, width, scheme);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
