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
const genreEndpoint = 'https://plyr-next-audio.n8-3e9.workers.dev/v1/genres';
const pds = 'http://localhost:5197/xrpc/';
const collection = 'fm.plyr.track';
const handle = 'mvpjamhost.test';
const partSize = 10485760;
const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-svelte-upload';

function audio(format) {
  return execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-f', format, 'pipe:1']);
}

async function interruptDraftCleanup(page) {
  await page.evaluate(() => {
    const getKey = IDBObjectStore.prototype.getKey;
    IDBObjectStore.prototype.getKey = function (...args) {
      if (this.name === 'drafts' && this.transaction.mode === 'readwrite') throw new Error('fixture interrupted draft cleanup');
      return getKey.apply(this, args);
    };
  });
}

async function holdDraftCompletion(page) {
  await page.evaluate(() => {
    const proto = IDBTransaction.prototype;
    const completion = Object.getOwnPropertyDescriptor(proto, 'oncomplete');
    Object.defineProperty(proto, 'oncomplete', {
      ...completion,
      set(callback) {
        if (this.mode !== 'readwrite' || this.db.name !== 'plyr-next-upload-drafts') {
          completion.set.call(this, callback);
          return;
        }
        completion.set.call(this, event => {
          Object.defineProperty(proto, 'oncomplete', completion);
          window.releaseDraftTransaction = () => callback.call(this, event);
        });
      },
    });
  });
}

async function openSettings(page) {
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const account = nav.getByRole('button', { name: 'account', exact: true });
  if (await account.isVisible()) {
    await account.click();
    await page.getByRole('dialog', { name: 'account', exact: true }).getByRole('link', { name: /settings queue sync/ }).click();
  } else {
    await nav.getByRole('link', { name: 'settings', exact: true }).click();
  }
}

async function verify(browser, accounts, width, theme, mp3, wav, scenario = 'regular') {
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
  const workerRequests = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.includes('/cover-heic.worker-')) workerRequests.push(request.url());
  });
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
  const blobStarted = Promise.withResolvers();
  const releaseBlob = Promise.withResolvers();
  await context.route(blobRoute, async route => {
    if (scenario === 'edit-navigation') return route.fulfill({ status: 400, json: { error: 'InvalidRequest', message: 'fixture rejected the audio' } });
    if (++blobWrites === 1 && scenario === 'before-create') {
      blobStarted.resolve();
      await releaseBlob.promise;
      return route.abort().catch(() => {});
    }
    return route.fallback();
  });
  await context.route('https://pds.fixture.test/xrpc/com.atproto.repo.createRecord', route => {
    writes.push(route.request().postDataJSON());
    return route.fallback();
  });
  let upload, receipt;
  const partStarted = Promise.withResolvers();
  const releasePart = Promise.withResolvers();
  let state = 'transferring';
  const waitForConfirmation = theme === 'light';
  const manualConfirmation = waitForConfirmation && width === 1280;
  let activationChecks = 0;
  const worker = 'https://audio.fixture';
  await context.route(genreEndpoint, route => route.fulfill({ status: 503 }));
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
      activationChecks++;
      if (!waitForConfirmation) state = 'published';
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
    const heic = await fs.readFile(path.join(__dirname, 'fixtures/cover.heic'));
    const coverInput = page.locator('input[type=file][accept^="image"]');
    if (scenario === 'regular') {
      const tags = page.getByRole('textbox', { name: 'tags', exact: true });
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'), page.getByRole('button', { name: 'change audio', exact: true }).click()
      ]);
      await chooser.setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') });
      await page.getByRole('alert').filter({ hasText: /choose an MP3.*WebM/ }).waitFor({ timeout: 5000 });
      await page.getByText('selected: direct.mp3').waitFor();
      assert.ok(await submit.isEnabled(), 'an invalid replacement leaves the valid audio attached');
      assert.equal(await title.inputValue(), 'direct from Svelte');
      assert.equal(await tags.inputValue(), 'ambient\nfield recording');

      const bitmap = Buffer.alloc(70, 0);
      bitmap.write('BM');
      bitmap.writeUInt32LE(bitmap.length, 2);
      bitmap.writeUInt32LE(54, 10);
      bitmap.writeUInt32LE(40, 14);
      bitmap.writeInt32LE(2, 18);
      bitmap.writeInt32LE(2, 22);
      bitmap.writeUInt16LE(1, 26);
      bitmap.writeUInt16LE(24, 28);
      bitmap.writeUInt32LE(16, 34);
      bitmap.fill(0x80, 54);
      await coverInput.setInputFiles({ name: 'scan.bmp', mimeType: 'image/bmp', buffer: bitmap });
      const preview = page.getByRole('img', { name: 'selected cover preview', exact: true });
      await preview.waitFor();
      assert.equal(await preview.evaluate(async image => { await image.decode(); return image.naturalWidth; }), 2);
      assert.equal(await page.getByRole('alert').filter({ hasText: "couldn't read that image" }).count(), 0);
      await page.screenshot({ path: path.join(output, `converted-cover-${width}-${theme}.png`), fullPage: true });
      await page.getByRole('button', { name: 'remove cover', exact: true }).click();
      await preview.waitFor({ state: 'detached' });
      assert.deepEqual(workerRequests, [], 'ordinary covers never load the HEIC decoder');

      await coverInput.setInputFiles({ name: 'bad.heic', mimeType: 'image/heic', buffer: Buffer.from('not an image') });
      await page.getByRole('alert').filter({ hasText: "couldn't read that image" }).waitFor();
      assert.equal(await title.inputValue(), 'direct from Svelte');
      assert.equal(await tags.inputValue(), 'ambient\nfield recording');
      await coverInput.setInputFiles({ name: 'cover.HEIC', mimeType: 'application/octet-stream', buffer: heic });
      await preview.waitFor();
      assert.deepEqual(await preview.evaluate(async image => {
        await image.decode();
        return [image.naturalWidth, image.naturalHeight];
      }), [96, 64]);
      await page.screenshot({ path: path.join(output, `heic-cover-${width}-${theme}.png`), fullPage: true });
    } else await coverInput.setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: cover });
    if (scenario === 'regular') await page.screenshot({ path: path.join(output, width + '-' + theme + '.png'), fullPage: true });
    if (scenario === 'after-create') await interruptDraftCleanup(page);
    if (scenario === 'after-create') await page.getByRole('checkbox', { name: 'auto-tag with recommended genres' }).check();
    if (scenario === 'submit-navigation') await holdDraftCompletion(page);
    await submit.click();
    if (scenario === 'submit-navigation' || scenario === 'edit-navigation') {
      if (scenario === 'edit-navigation') {
        const edit = page.getByRole('button', { name: 'edit and try again' });
        await edit.waitFor({ timeout: 5000 });
        await holdDraftCompletion(page);
        await edit.click();
      }
      await page.waitForFunction(() => typeof window.releaseDraftTransaction === 'function');
      await openSettings(page);
      await page.getByRole('heading', { name: 'settings', exact: true }).waitFor();
      const uploadLink = page.getByRole('main').getByRole('link', { name: 'upload', exact: true });
      if (scenario === 'submit-navigation') {
        await uploadLink.click();
        await page.locator('form[inert]').waitFor();
      }
      await page.evaluate(() => window.releaseDraftTransaction());
      if (scenario === 'edit-navigation') {
        await uploadLink.click();
        await page.getByText('your draft is still here. choose the audio file again.').waitFor();
        assert.equal(await title.inputValue(), 'direct from Svelte');
        assert.equal(await page.getByRole('textbox', { name: 'tags', exact: true }).inputValue(), 'ambient\nfield recording');
        assert.equal(writes.length, 0);
      } else {
        await page.waitForFunction(key => localStorage.getItem(key) === null, `plyr-upload-draft:${did}`);
        await page.getByText('"direct from Svelte" uploaded').waitFor({ timeout: 5000 });
        assert.equal(await title.inputValue(), '');
        assert.equal(writes.length, 1);
      }
      assert.deepEqual(errors, []);
      console.log(`editor survived ${scenario} at ${width}px (${theme})`);
      return;
    }
    if (scenario === 'before-create' || scenario === 'after-create') {
      const draft = page.locator('.recovery-card').filter({ has: page.getByRole('heading', { name: 'direct from Svelte', exact: true }) });
      if (scenario === 'before-create') {
        await blobStarted.promise;
        const other = await context.newPage();
        try {
          await other.goto(origin + '/upload');
          const card = other.locator('.recovery-card').filter({ has: other.getByRole('heading', { name: 'direct from Svelte' }) });
          await card.getByLabel('audio').setInputFiles({ name: 'direct.mp3', mimeType: 'audio/mpeg', buffer: mp3 });
          await card.getByLabel(/^cover/).setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: cover });
          await card.getByRole('button', { name: 'resume queued upload' }).click();
          await other.getByText(/this queued upload is open in another tab/).waitFor({ timeout: 5000 });
          assert.equal(blobWrites, 1, 'the other tab cannot upload a second blob');
        } finally { await other.close(); }
        await page.reload();
        releaseBlob.resolve();
        await draft.getByLabel('audio').setInputFiles({ name: 'direct.mp3', mimeType: 'audio/mpeg', buffer: mp3 });
        await draft.getByLabel(/^cover/).setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: cover });
        assert.equal(writes.length, 0, 'an interrupted blob transfer must not create a record');
        await draft.getByRole('button', { name: 'resume queued upload' }).click();
        await page.getByText('"direct from Svelte" uploaded').waitFor({ timeout: 5000 });
      } else {
        await page.getByText(/fixture interrupted draft cleanup/).waitFor({ timeout: 5000 });
        assert.equal(writes.length, 0, 'the draft handoff runs before the PDS record write');
        await page.reload();
        await draft.getByRole('button', { name: 'resume creation' }).waitFor();
        assert.equal(await draft.getByRole('button', { name: 'resume queued upload' }).count(), 0);
        await draft.getByRole('button', { name: 'resume creation' }).click();
        const genreRequest = page.waitForRequest(genreEndpoint, { timeout: 5000 });
        await draft.getByRole('button', { name: 'done with creation' }).click();
        assert.equal((await genreRequest).postDataJSON().uri, `at://${did}/${collection}/${writes[0].rkey}`);
        await draft.waitFor({ state: 'detached', timeout: 5000 });
      }
      assert.equal(writes.length, 1, 'recovery writes one record');
      const { value: restored } = await getRecord(`at://${did}/${collection}/${writes[0].rkey}`);
      assert.deepEqual(restored.tags, ['ambient', 'field recording']);
      assert.equal(restored.draftId, undefined);
      await page.reload();
      await page.getByText(/posts to your profile as Fixture Artist/).waitFor();
      assert.equal(await draft.count(), 0, 'finished recovery leaves no draft');
      assert.deepEqual(errors, []);
      console.log(`draft recovered ${scenario} at ${width}px (${theme})`);
      return;
    }
    await page.getByText('"direct from Svelte" uploaded', { exact: false }).waitFor({ timeout: 5000 }).catch(async failure => {
      console.error(await page.locator('main').innerText());
      throw failure;
    });
    await page.getByRole('button', { name: 'choose audio', exact: true }).waitFor();
    assert.equal(await page.getByRole('alert').filter({ hasText: /choose an MP3.*WebM/ }).count(), 0);
    assert.equal(loseReply, false);
    assert.equal(writes.length, 1, 'a lost create response reconciles at the same address');
    const { value } = await getRecord(`at://${did}/${collection}/${writes[0].rkey}`);
    assert.equal(value.title, 'direct from Svelte');
    assert.equal(value.artist, 'Fixture Artist');
    assert.deepEqual(value.tags, ['ambient', 'field recording']);
    assert.equal(value.fileType, 'mp3');
    assert.equal(value.audioBlob.mimeType, 'audio/mpeg');
    assert.equal(value.audioBlob.size, mp3.length);
    assert.equal(value.imageBlob.mimeType, scenario === 'regular' ? 'image/jpeg' : 'image/png');
    if (scenario !== 'regular') assert.equal(value.imageBlob.size, cover.length);
    assert.equal(new URL(value.imageUrl).hostname, 'pds.fixture.test');
    assert.equal(blobWrites, 2);

    await audioInput.setInputFiles({ name: 'for conversion.wav', mimeType: 'audio/wav', buffer: wav });
    const consent = page.getByRole('checkbox', { name: 'use plyr storage' });
    await consent.waitFor();
    assert.ok(await submit.isDisabled());
    await consent.check();
    if (manualConfirmation) await page.getByRole('checkbox', { name: 'auto-tag with recommended genres' }).check();
    if (scenario === 'after-transfer') {
      await interruptDraftCleanup(page);
      await submit.click();
      await page.getByText(/fixture interrupted draft cleanup/).waitFor({ timeout: 5000 });
      assert.equal(upload, undefined, 'worker reservation starts after the local transfer handoff');
      await page.reload();
      const card = page.locator('.recovery-card').filter({ has: page.getByRole('heading', { name: 'for conversion', exact: true }) });
      await card.getByLabel('reselect original audio').setInputFiles({ name: 'for conversion.wav', mimeType: 'audio/wav', buffer: wav });
      assert.equal(await card.getByRole('button', { name: 'resume queued upload' }).count(), 0);
      releasePart.resolve();
      await card.getByRole('button', { name: 'resume upload', exact: true }).click();
      await page.getByText('"for conversion" uploaded').waitFor({ timeout: 5000 });
      assert.equal(writes.length, 2, 'resumed transfer writes one record beyond the direct upload');
      await page.reload();
      await page.getByText(/posts to your profile as Fixture Artist/).waitFor();
      assert.equal(await card.count(), 0, 'finished transfer leaves no draft');
      assert.deepEqual(errors, []);
      console.log(`draft recovered after-transfer at ${width}px (${theme})`);
      return;
    }
    const partRequest = page.waitForRequest(request => request.url().startsWith(worker) && request.method() === 'PUT');
    await submit.click();
    await partRequest;
    await partStarted.promise;
    if (scenario === 'waiting') {
      const waitingTitle = 'queued through reload';
      const uploadForm = page.locator('form').filter({ has: title });
      await uploadForm.locator('input[type=file][accept^="audio"]').setInputFiles({ name: 'waiting.mp3', mimeType: 'audio/mpeg', buffer: mp3 });
      await title.fill(waitingTitle);
      await uploadForm.getByRole('button', { name: 'add album, description or tags' }).click();
      await uploadForm.getByRole('textbox', { name: 'description', exact: true }).fill('liner notes that survive a reload');
      await page.evaluate(() => {
        const add = IDBObjectStore.prototype.add;
        window.restoreDraftInsert = () => { IDBObjectStore.prototype.add = add; };
        IDBObjectStore.prototype.add = function (...args) {
          if (this.name === 'drafts') throw new DOMException('queued draft storage is full', 'QuotaExceededError');
          return add.apply(this, args);
        };
      });
      await uploadForm.getByRole('button', { name: 'upload', exact: true }).click();
      await uploadForm.getByRole('alert').getByText('queued draft storage is full').waitFor();
      assert.equal(await title.inputValue(), waitingTitle);
      assert.equal(await uploadForm.getByRole('textbox', { name: 'description', exact: true }).inputValue(), 'liner notes that survive a reload');
      await page.evaluate(() => window.restoreDraftInsert());
      await uploadForm.getByRole('button', { name: 'upload', exact: true }).click();
      await page.getByText(`"${waitingTitle}" is next…`).waitFor({ timeout: 5000 });
      assert.equal(writes.length, 1, 'the waiting upload has no PDS record yet');

      await page.reload();
      const draft = page.locator('.recovery-card').filter({ has: page.getByRole('heading', { name: waitingTitle, exact: true }) });
      await draft.getByText('choose waiting.mp3 to resume this upload.').waitFor({ timeout: 5000 });
      assert.equal(writes.length, 1, 'reload does not publish the waiting upload');
      const resume = draft.getByRole('button', { name: 'resume queued upload' });
      assert.ok(await resume.isDisabled());
      await draft.getByLabel('audio').setInputFiles({ name: 'wrong.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(mp3.length) });
      await resume.click();
      await draft.getByRole('alert').getByText('choose the original audio file.').waitFor();
      assert.equal(writes.length, 1, 'mismatched input does not publish');
      await draft.getByLabel('audio').setInputFiles({ name: 'waiting.mp3', mimeType: 'audio/mpeg', buffer: mp3 });
      await page.screenshot({ path: path.join(output, `queued-draft-recovery-${width}-${theme}.png`) });
      await resume.click();
      await page.getByText(`"${waitingTitle}" uploaded`).waitFor({ timeout: 5000 });
      assert.equal(writes.length, 2, 'restored draft publishes only once');
      const { value: restored } = await getRecord(`at://${did}/${collection}/${writes[1].rkey}`);
      assert.equal(restored.title, waitingTitle);
      assert.equal(restored.description, 'liner notes that survive a reload');
      await page.reload();
      await page.getByRole('textbox', { name: 'title', exact: true }).waitFor();
      assert.equal(await draft.count(), 0, 'published draft is gone on reload');
      console.log(`a waiting upload survives reload and publishes once at ${width}px (${theme})`);
      return;
    }
    await openSettings(page);
    await page.getByRole('heading', { name: 'settings', exact: true }).waitFor();
    const main = page.getByRole('main');
    const progress = main.getByRole('link', { name: '1 upload in progress', exact: true });
    await progress.waitFor();
    await page.screenshot({ path: path.join(output, `upload-progress-${width}-${theme}.png`) });
    releasePart.resolve();
    await progress.waitFor({ state: 'detached' });
    await main.getByRole('link', { name: 'upload', exact: true }).click();
    const jobLinks = page.getByRole('list', { name: 'Upload queue' }).getByRole('link', { name: 'view track' });
    if (waitForConfirmation) {
      const awaiting = page.getByText('"for conversion" is waiting for playback confirmation');
      await awaiting.waitFor();
      assert.equal(activationChecks, 3);
      assert.equal(state, 'complete');
      assert.equal(await jobLinks.count(), 1);
      state = 'published';
      if (manualConfirmation) {
        await page.getByRole('button', { name: 'check upload status' }).click();
        const genreRequest = page.waitForRequest(genreEndpoint, { timeout: 5000 });
        await page.getByRole('button', { name: 'done with upload' }).click();
        await awaiting.waitFor({ state: 'detached', timeout: 5000 });
        assert.equal((await genreRequest).postDataJSON().uri, `at://${did}/${collection}/${writes[1].rkey}`);
      } else {
        await page.reload();
        await jobLinks.first().waitFor();
      }
    } else {
      await jobLinks.nth(1).waitFor();
    }
    assert.equal(state, 'published');
    assert.equal(writes.length, 2);
    assert.equal(blobWrites, 2, 'converted source bytes never go to the PDS');
    assert.deepEqual(errors, []);
    console.log(`Svelte public PDS and processed upload passed at ${width}px (${theme})`);
  } finally { releaseBlob.resolve(); releasePart.resolve(); await context.close(); }
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const accounts = await fixtureAccounts(['mvpjamhost']);
  const mp3 = audio('mp3');
  const wav = audio('wav');
  const browser = await chromium.launch();
  try {
    if (process.env.WAITING_DRAFT_RELOAD !== '1') {
      for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
        await verify(browser, accounts, width, theme, mp3, wav);
      }
    }
    await verify(browser, accounts, 390, 'light', mp3, wav, 'waiting');
    await verify(browser, accounts, 1280, 'dark', mp3, wav, 'waiting');
    await verify(browser, accounts, 390, 'light', mp3, wav, 'before-create');
    await verify(browser, accounts, 1280, 'dark', mp3, wav, 'after-create');
    await verify(browser, accounts, 390, 'dark', mp3, wav, 'after-transfer');
    await verify(browser, accounts, 390, 'light', mp3, wav, 'submit-navigation');
    await verify(browser, accounts, 1280, 'dark', mp3, wav, 'edit-navigation');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
