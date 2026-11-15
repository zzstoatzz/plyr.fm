const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { fixtureAccounts, fixturePage, authorizeFixture } = require('./pds-browser-fixture.cjs');

const origin = 'https://next.plyr.fm';
const appView = 'https://api.next.plyr.fm';
const coordinator = 'https://jams.next.plyr.fm';
const pds = 'http://localhost:5197/xrpc/';
const collection = 'fm.plyr.track';
const handle = 'mvpjamhost.test';
const partSize = 10485760;
const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-svelte-upload';

function audio(format) {
  return execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-f', format, 'pipe:1']);
}

async function verify(browser, accounts, width, theme, mp3, wav) {
  const did = accounts[handle].did;
  let loseReply = true, blobWrites = 0;
  const writes = [];
  const { page, context } = await fixturePage(browser, accounts, {
    dist: path.resolve(__dirname, '../build'),
    context: { viewport: { width, height: 900 }, colorScheme: theme },
    discardPdsResponse(endpoint) {
      if (!loseReply || endpoint !== '/xrpc/com.atproto.repo.createRecord') return false;
      loseReply = false;
      return true;
    }
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const session = await fetch(pds + 'com.atproto.server.createSession', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password: accounts[handle].pass })
  }).then(response => response.json());
  const getRecord = async uri => {
    const url = pds + 'com.atproto.repo.getRecord?' + new URLSearchParams({ repo: did, collection, rkey: uri.split('/').at(-1) });
    const response = await fetch(url, { headers: { authorization: 'Bearer ' + session.accessJwt } });
    assert.equal(response.status, 200);
    return response.json();
  };

  await context.route(appView + '/**', route => {
    assert.equal(route.request().method(), 'GET', 'catalog traffic is read-only');
    const url = new URL(route.request().url());
    if (decodeURIComponent(url.pathname) === '/v1/artists/' + did) return route.fulfill({ json: { display_name: 'Fixture Artist' } });
    if (url.pathname === '/v1/records/await') return route.fulfill({ json: { status: 'indexed' } });
    return route.fulfill({ json: { object: 'list', data: [], has_more: false } });
  });
  await context.route('https://typeahead.waow.tech/**', route => route.fulfill({ json: { actors: [] } }));
  await context.route(coordinator + '/v1/playback/join', route => route.fulfill({ status: 403, json: {} }));
  const blobRoute = 'https://pds.fixture.test/xrpc/com.atproto.repo.uploadBlob';
  await context.route(blobRoute, route => { blobWrites++; return route.fallback(); });
  await context.route('https://pds.fixture.test/xrpc/com.atproto.repo.createRecord', route => {
    writes.push(route.request().postDataJSON());
    return route.fallback();
  });
  let upload, receipt;
  const partStarted = Promise.withResolvers();
  const releasePart = Promise.withResolvers();
  let state = 'transferring';
  const worker = 'https://audio.fixture';
  await context.route(coordinator + '/v1/uploads/authorize', route => {
    const request = route.request().postDataJSON();
    assert.equal(request.serviceToken.split('.').length, 3);
    assert.equal(request.visibility, 'public');
    assert.equal(request.downloadPolicy, 'open');
    assert.equal(request.contentType, 'audio/wav');
    assert.equal(request.sizeBytes, wav.length);
    assert.equal(request.processing.recipe, 'mp3-320k-44100-v1');
    const uploadUrl = worker + '/v1/uploads/' + 'a'.repeat(64) + '/' + request.uploadId;
    upload = { ...request, uploadUrl, audioUrl: uploadUrl.replace('/v1/uploads/', '/media/') };
    return route.fulfill({ json: { uploadUrl, capability: 'fixture-capability', expiresAt: Date.now() + 300000 } });
  });
  await context.route(worker + '/v1/uploads/**', async route => {
    const request = route.request();
    assert.ok(upload);
    assert.equal(request.headers().authorization, 'Bearer fixture-capability');
    if (request.method() === 'PUT') {
      const bytes = request.postDataBuffer();
      assert.deepEqual(bytes, wav);
      receipt = { number: 1, sha256: createHash('sha256').update(bytes).digest('hex') };
      partStarted.resolve();
      await releasePart.promise;
      return route.fulfill({ json: receipt });
    }
    if (request.url().endsWith('/finish')) {
      assert.ok(receipt);
      state = 'complete';
    }
    if (request.url().endsWith('/activate')) {
      const { value } = await getRecord(upload.recordUri);
      assert.equal(value.audioUrl, upload.audioUrl);
      assert.equal(value.audioBlob, undefined);
      assert.equal(value.downloadPolicy, 'open');
      assert.equal(value.fileType, 'mp3');
      state = 'published';
    }
    return route.fulfill({ json: {
      state, processing: upload.processing, recoveryRequired: false, partSizeBytes: partSize, partCount: 1,
      reservedBytes: state === 'published' ? 0 : wav.length + upload.processing.outputBudget,
      receivedParts: receipt ? [receipt] : [], reservedDigests: receipt ? [receipt] : [],
      ...(['complete', 'published'].includes(state) ? {
        audioUrl: upload.audioUrl, rendition: { duration: 1, sizeBytes: mp3.length, contentType: 'audio/mpeg', fileType: 'mp3' }
      } : {})
    } });
  });
  try {
    await page.goto(origin + '/upload');
    await page.locator('main').getByRole('link', { name: 'sign in', exact: true }).click();
    await authorizeFixture(page, accounts, handle);
    await page.waitForURL(origin + '/upload');
    const audioInput = page.locator('input[type=file][accept^="audio"]');
    const submit = page.getByRole('button', { name: 'upload', exact: true });
    await page.getByText(/posts to your profile as Fixture Artist/).waitFor();

    await audioInput.setInputFiles({ name: 'direct.mp3', mimeType: 'audio/mpeg', buffer: mp3 });
    const title = page.getByRole('textbox', { name: 'title', exact: true });
    await title.fill('direct from Svelte');
    await page.getByRole('button', { name: 'add album, description or tags' }).click();
    await page.getByRole('textbox', { name: 'tags', exact: true }).fill('ambient\nfield recording');
    await page.reload();
    await page.getByText('your draft is still here. choose the audio file again.').waitFor();
    assert.equal(await title.inputValue(), 'direct from Svelte');
    await audioInput.setInputFiles({ name: 'direct.mp3', mimeType: 'audio/mpeg', buffer: mp3 });
    const cover = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMTsAAAAASUVORK5CYII=', 'base64');
    await page.locator('input[type=file][accept^="image"]').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: cover });
    await page.screenshot({ path: path.join(output, width + '-' + theme + '.png'), fullPage: true });
    await submit.click();
    await page.getByText('"direct from Svelte" uploaded', { exact: false }).waitFor({ timeout: 5000 }).catch(async failure => {
      console.error(await page.locator('main').innerText());
      throw failure;
    });
    assert.equal(loseReply, false);
    assert.equal(writes.length, 1, 'a lost create response reconciles at the same address');
    const { value } = await getRecord(`at://${did}/${collection}/${writes[0].rkey}`);
    assert.equal(value.title, 'direct from Svelte');
    assert.equal(value.artist, 'Fixture Artist');
    assert.deepEqual(value.tags, ['ambient', 'field recording']);
    assert.equal(value.fileType, 'mp3');
    assert.equal(value.audioBlob.mimeType, 'audio/mpeg');
    assert.equal(value.audioBlob.size, mp3.length);
    assert.equal(value.imageBlob.mimeType, 'image/png');
    assert.equal(value.imageBlob.size, cover.length);
    assert.equal(new URL(value.imageUrl).hostname, 'pds.fixture.test');
    assert.equal(blobWrites, 2);

    await audioInput.setInputFiles({ name: 'for conversion.wav', mimeType: 'audio/wav', buffer: wav });
    const consent = page.getByRole('checkbox', { name: 'use plyr storage' });
    await consent.waitFor();
    assert.ok(await submit.isDisabled());
    await consent.check();
    const partRequest = page.waitForRequest(request => request.url().startsWith(worker) && request.method() === 'PUT');
    await submit.click();
    await partRequest;
    await partStarted.promise;
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'settings' }).click();
    await page.getByRole('heading', { name: 'settings', exact: true }).waitFor();
    const progress = page.getByRole('link', { name: 'uploading 1', exact: true });
    await progress.waitFor();
    releasePart.resolve();
    await progress.waitFor({ state: 'detached' });
    await page.getByRole('link', { name: 'upload', exact: true }).click();
    await page.getByRole('list', { name: 'Upload queue' }).getByRole('link', { name: 'view track' }).nth(1).waitFor();
    assert.equal(state, 'published');
    assert.equal(writes.length, 2);
    assert.equal(blobWrites, 2, 'converted source bytes never go to the PDS');
    assert.deepEqual(errors, []);
    console.log(`Svelte public PDS and processed upload passed at ${width}px (${theme})`);
  } finally { releasePart.resolve(); await context.close(); }
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const accounts = await fixtureAccounts(['mvpjamhost']);
  const mp3 = audio('mp3');
  const wav = audio('wav');
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
      await verify(browser, accounts, width, theme, mp3, wav);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
