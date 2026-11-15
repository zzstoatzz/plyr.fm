const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { fixtureAccounts, fixturePage, authorizeFixture } = require('./pds-browser-fixture.cjs');

const origin = process.env.NEXT_WEB_URL || 'https://next.plyr.fm';
const upload = origin + '/upload?mode=album';
const appView = 'https://api.next.plyr.fm';
const pds = 'http://127.0.0.1:5197/xrpc/';
const trackCollection = 'fm.plyr.track';
const listCollection = 'fm.plyr.list';
const cover = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMTsAAAAASUVORK5CYII=', 'base64');
const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-svelte-album-upload';
const idFromUri = (type, uri) => type + '_' + Buffer.from(uri).toString('base64url');

async function fixture(browser, accounts, handle, width, scheme, scenario, audio) {
  const did = accounts[handle].did;
  const failSong = scenario === 'partial' || scenario === 'stale';
  const session = await fetch(pds + 'com.atproto.server.createSession', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password: accounts[handle].pass })
  }).then(response => response.json());
  const { accessJwt } = session;
  assert.ok(accessJwt);
  const headers = { authorization: 'Bearer ' + accessJwt };
  async function records(collection) {
    const result = await fetch(pds + 'com.atproto.repo.listRecords?' + new URLSearchParams({ repo: did, collection }), { headers });
    assert.equal(result.status, 200);
    return (await result.json()).records;
  }
  const tracksAtStart = new Set((await records(trackCollection)).map(record => record.uri));
  const albumsAtStart = new Set((await records(listCollection)).map(record => record.uri));
  const pausedBlob = Promise.withResolvers();
  const releaseBlob = Promise.withResolvers();
  const lostAlbumReply = Promise.withResolvers();
  const errors = [];
  let blobCount = 0, albumAttempts = 0, albumLost = false, rejectAlbum = scenario === 'partial';
  let albumPending = scenario === 'pending';
  let activeWrite;
  let albumUri;
  const { page, context } = await fixturePage(browser, accounts, {
    origin, dist: path.resolve(__dirname, '../build'),
    context: { viewport: { width, height: 900 }, colorScheme: scheme, hasTouch: width === 390, isMobile: width === 390 },
    discardPdsResponse(endpoint) {
      if (scenario === 'pending') return false;
      if (endpoint !== '/xrpc/com.atproto.repo.createRecord' || activeWrite !== listCollection || albumLost) return false;
      albumLost = true;
      lostAlbumReply.resolve();
      return true;
    }
  });
  let projected = false;
  const write = 'https://pds.fixture.test/xrpc/com.atproto.repo.createRecord';
  const audioMime = 'audio/mpeg';
  const selection = ['alpha', 'beta', 'gamma'].map(name => ({ name: name + '.mp3', mimeType: name === 'gamma' ? 'application/octet-stream' : audioMime, buffer: audio }));
  const title = 'Field recordings';
  const signIn = origin + '/login';
  page.on('pageerror', error => errors.push(error.message));
  await context.route('https://jams.next.plyr.fm/**', route => route.fulfill({ status: 403, json: {} }));
  await context.route('https://typeahead.waow.tech/**', route => route.fulfill({ json: { actors: [] } }));
  await context.route('https://pds.fixture.test/xrpc/com.atproto.repo.uploadBlob', async route => {
    if (!(await route.request().allHeaders())['content-type']?.startsWith(audioMime)) return route.fallback();
    blobCount++;
    if (failSong && blobCount === 2) {
      return route.fulfill({ status: 400, json: { error: 'InvalidRequest', message: 'could not upload this audio file' } });
    }
    if (scenario === 'reload' && blobCount === 3) {
      pausedBlob.resolve();
      await releaseBlob.promise;
      return route.abort().catch(() => {});
    }
    return route.fallback();
  });
  await context.route(write, route => {
    const body = route.request().postDataJSON();
    activeWrite = body.collection;
    assert.equal(body.repo, did);
    if (body.collection === trackCollection) assert.equal(body.record.album, title);
    if (body.collection === listCollection) {
      albumAttempts++;
      albumUri = `at://${did}/${listCollection}/${body.rkey}`;
      if (rejectAlbum) {
        rejectAlbum = false;
        return route.fulfill({ status: 400, json: { error: 'InvalidRequest', message: 'could not save this album' } });
      }
    }
    return route.fallback();
  });
  await context.route(appView + '/**', async route => {
    const url = new URL(route.request().url());
    assert.equal(route.request().method(), 'GET', 'publishing never sends writes to the appview');
    if (url.pathname.endsWith('/v1/albums/' + idFromUri('alb', albumUri ?? ''))) {
      const album = (await records(listCollection)).find(item => item.uri === albumUri);
      assert.ok(album);
      const songs = await records(trackCollection);
      const members = album.value.items.map(({ subject }, position) => {
        const record = songs.find(item => item.uri === subject.uri);
        assert.equal(record.cid, subject.cid);
        return { position, subject, availability: 'available', track: {
          object: 'track', id: idFromUri('trk', subject.uri), record: { ...subject },
          metadata: { title: record.value.title, created_at: record.value.createdAt, duration_seconds: 1 },
          artist: { did, profile: { handle, display_name: 'Fixture Artist' } },
          access: { visibility: 'public' }, media: { artwork: null }, metrics: { play_count: 0, like_count: 0 }
        } };
      });
      return route.fulfill({ json: {
        object: 'album', id: idFromUri('alb', albumUri), record: { uri: album.uri, cid: album.cid, rkey: album.uri.split('/').at(-1) },
        metadata: { name: album.value.name }, owner: { did, profile: { handle, display_name: 'Fixture Artist' } },
        media: { artwork: null }, metrics: { member_count: members.length, available_count: members.length, total_plays: 0 }, members
      } });
    }
    if (url.pathname === '/v1/records/await') {
      if (url.searchParams.get('uri') === albumUri) {
        if (albumPending) return route.fulfill({ json: { status: 'pending' } });
        projected = true;
      }
      return route.fulfill({ json: { status: 'indexed' } });
    }
    if (url.pathname.startsWith('/v1/artists/')) return route.fulfill({ json: { did, handle, display_name: 'Fixture Artist' } });
    return route.fulfill({ json: { object: 'list', data: [], has_more: false } });
  });

  try {
    await page.goto(upload);
    await page.locator('main').getByRole('link', { name: 'sign in', exact: true }).click();
    await page.waitForURL(signIn + '?**');
    await authorizeFixture(page, accounts, handle);
    await page.waitForURL(upload);
    const fields = page.getByRole('textbox', { name: 'album name' });
    await fields.fill(title);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'choose songs', exact: true }).click();
    await (await chooser).setFiles([...selection, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') }]);
    await page.getByRole('alert').filter({ hasText: 'notes.txt' }).waitFor();
    assert.equal(await fields.inputValue(), title);
    await page.getByRole('textbox', { name: 'title for song 1' }).fill('Alpha remastered');
    await page.getByRole('button', { name: 'Move beta up' }).click();
    await page.locator('input[type="file"][accept^="image"]').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: cover });
    await page.getByRole('img', { name: 'selected cover preview' }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth), 'the album form fits the viewport');
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-${scenario}-editor.png`), fullPage: true });
    await page.getByRole('button', { name: 'upload songs' }).click();

    if (scenario === 'reload') {
      await pausedBlob.promise;
      assert.equal((await records(trackCollection)).filter(record => !tracksAtStart.has(record.uri)).length, 2);
      await page.reload();
      releaseBlob.resolve();
      await page.getByText('2 of 3 songs uploaded').waitFor();
      await page.getByText('choose cover.png again to include a cover.').waitFor();
      async function switchAccount(nextHandle) {
        await page.goto(origin + '/settings');
        await page.getByRole('button', { name: 'sign out', exact: true }).click();
        await page.locator('main').getByRole('link', { name: 'sign in', exact: true }).waitFor();
        await page.goto(signIn + '?return_to=%2Fupload%3Fmode%3Dalbum');
        await authorizeFixture(page, accounts, nextHandle);
        await page.waitForURL(upload);
      }
      await switchAccount('album-upload-other.test');
      await page.getByRole('textbox', { name: 'album name' }).waitFor();
      assert.equal(await page.getByRole('textbox', { name: 'album name' }).inputValue(), '');
      assert.equal(await page.getByRole('heading', { name: title }).count(), 0);
      await switchAccount(handle);
      await page.getByText('2 of 3 songs uploaded').waitFor();
      await page.getByLabel('original file for gamma').setInputFiles(selection[2]);
    }
    const count = failSong ? 2 : 3;
    await page.getByText(`${count} of 3 songs uploaded`).waitFor();
    if (scenario === 'reload') {
      await page.locator('input[type="file"][accept^="image"]').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: cover });
      await page.getByRole('img', { name: 'selected cover preview' }).waitFor();
    }
    assert.equal((await records(listCollection)).filter(record => !albumsAtStart.has(record.uri)).length, 0);
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-${scenario}-progress.png`), fullPage: true });

    if (scenario === 'pending') {
      await page.getByRole('button', { name: 'create album', exact: true }).click();
      const check = page.getByRole('button', { name: 'check status', exact: true });
      await check.waitFor();
      const view = page.getByRole('link', { name: 'view album', exact: true });
      assert.equal(await view.count(), 1, 'only one album action while the journal owns the result');
      await page.screenshot({ path: path.join(output, `${width}-${scheme}-pending-result.png`), fullPage: true });
      albumPending = false;
      const indexed = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/v1/records/await' && url.searchParams.get('uri') === albumUri && response.ok();
      });
      await check.click();
      assert.equal((await (await indexed).json()).status, 'indexed');
      await page.getByRole('button', { name: 'done', exact: true }).click();
      await check.waitFor({ state: 'detached' });
      await view.click();
      await page.waitForURL('**/album/**');
    } else if (scenario === 'partial') {
      await page.getByText('upload didn’t finish. choose alpha.mp3 to try again.').waitFor();
      await page.getByRole('button', { name: 'set aside album', exact: true }).click();
      await page.getByText('uploaded songs stay in your music. unfinished songs stay in upload recovery.').waitFor();
      await page.getByRole('button', { name: 'cancel', exact: true }).click();
      await page.getByRole('button', { name: 'create album with 2 songs' }).click();
      await page.getByRole('button', { name: 'try saving again' }).waitFor();
      await page.getByRole('button', { name: 'try saving again' }).click();
      await page.getByRole('link', { name: 'view album' }).waitFor();
      await page.getByRole('link', { name: 'view album' }).click();
    } else if (scenario === 'stale') {
      const other = await context.newPage();
      await other.goto(upload);
      await other.getByText('2 of 3 songs uploaded').waitFor();
      await other.getByLabel('original file for Alpha remastered').setInputFiles(selection[0]);
      await other.getByText('3 of 3 songs uploaded').waitFor();
      await other.close();
      await page.getByRole('button', { name: 'create album with 2 songs' }).click();
      await page.waitForURL('**/album/**');
    } else if (scenario === 'journal' || scenario === 'journal-other') {
      await page.evaluate(() => {
        const prototype = IDBTransaction.prototype;
        const original = Object.getOwnPropertyDescriptor(prototype, 'oncomplete');
        Object.defineProperty(prototype, 'oncomplete', {
          ...original,
          set(callback) {
            if (this.mode !== 'readwrite' || this.db.name !== 'plyr-next-pending-creates') return original.set.call(this, callback);
            return original.set.call(this, () => {
              Object.defineProperty(prototype, 'oncomplete', original);
              window.albumJournalCommitted = true;
            });
          }
        });
      });
      await page.getByRole('button', { name: 'create album', exact: true }).click();
      await page.waitForFunction(() => window.albumJournalCommitted === true);
      assert.equal(albumAttempts, 0, 'the album journal was durable before any record write');
      const elsewhere = scenario === 'journal-other';
      if (elsewhere) await page.goto(origin + '/create-album');
      else await page.reload();
      await page.getByRole('button', { name: 'try saving again' }).click();
      await page.getByRole('button', { name: 'done' }).click();
      if (elsewhere) {
        await page.goto(upload);
        await page.getByRole('link', { name: 'view album' }).waitFor();
      }
      await page.reload();
      assert.equal(await page.getByRole('textbox', { name: 'album name' }).inputValue(), '');
    } else {
      const other = await context.newPage();
      await other.goto(upload);
      await other.getByText('3 of 3 songs uploaded').waitFor();
      await other.locator('input[type="file"][accept^="image"]').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: cover });
      await other.getByRole('img', { name: 'selected cover preview' }).waitFor();
      await Promise.all([
        page.getByRole('button', { name: 'create album', exact: true }).click(),
        other.getByRole('button', { name: 'create album', exact: true }).click()
      ]);
      await lostAlbumReply.promise;
      await Promise.race([page.waitForURL('**/album/**'), other.waitForURL('**/album/**')]);
      await other.close();
    }
    assert.ok(projected);
    const created = (await records(listCollection)).filter(record => !albumsAtStart.has(record.uri));
    assert.equal(created.length, 1, 'only one album record exists');
    assert.equal(created[0].value.imageBlob.mimeType, 'image/png');
    assert.equal(albumAttempts, scenario === 'partial' ? 2 : 1);
    const uploaded = (await records(trackCollection)).filter(record => !tracksAtStart.has(record.uri));
    assert.equal(uploaded.length, scenario === 'stale' ? 3 : count, 'only successful songs created records');
    const expected = failSong ? ['beta', 'gamma'] : ['beta', 'Alpha remastered', 'gamma'];
    assert.deepEqual(created[0].value.items.map(item => uploaded.find(record => record.uri === item.subject.uri).value.title), expected);
    if (scenario === 'partial') {
      await page.goto(origin + '/upload');
      await page.getByRole('heading', { name: 'Alpha remastered' }).waitFor();
      await page.getByRole('button', { name: 'resume queued upload' }).waitFor();
    } else if (scenario === 'stale') {
      await page.goto(origin + '/upload');
      await page.getByRole('button', { name: 'choose audio', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'resume queued upload' }).count(), 0);
    }
    assert.deepEqual(errors, []);
    console.log(`${width}px ${scheme}: ${scenario}, ordered songs and exactly one album verified`);
  } finally {
    releaseBlob.resolve();
    await context.close();
  }
}

(async () => {
  await mkdir(output, { recursive: true });
  const frames = [
    [390, 'dark', 'pending'],
    [1280, 'light', 'pending'],
    [390, 'dark', 'reload'],
    [1280, 'light', 'partial'],
    [390, 'light', 'stale'],
    [1280, 'dark', 'journal'],
    [390, 'dark', 'journal-other']
  ];
  const handles = frames.map(([, , scenario]) => 'albqa-' + (scenario === 'journal-other' ? 'elsewhere' : scenario));
  const accounts = await fixtureAccounts([...handles, 'album-upload-other']);
  const audio = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-f', 'mp3', 'pipe:1']);
  const browser = await chromium.launch();
  try {
    for (const [index, [width, scheme, scenario]] of frames.entries()) {
      await fixture(browser, accounts, handles[index] + '.test', width, scheme, scenario, audio);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
