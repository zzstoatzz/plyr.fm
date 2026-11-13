const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');
const did = 'did:plc:largeuploadfixture', scope = 'rpc:fm.plyr.upload.authorize?aud=did:web:jams.next.plyr.fm#jams';
const partSize = 10485760, size = 16044;
const audio = Buffer.alloc(size);
audio.write('RIFF'); audio.writeUInt32LE(size - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28);
audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(size - 44, 40);
const operation = { owner: did, collection: 'fm.plyr.track', rkey: '3jzfcijpj2z2a', uri: `at://${did}/fm.plyr.track/3jzfcijpj2z2a`,
  uploadId: '12345678-1234-4123-8123-123456789abc', name: 'original.wav', sizeBytes: size, contentType: 'audio/wav', fileType: 'wav',
  record: { $type: 'fm.plyr.track', title: 'resumable fixture', artist: 'fixture artist', fileType: 'wav', createdAt: '2026-11-12T00:00:00Z' } };
const base = `https://audio.fixture/v1/uploads/${'a'.repeat(64)}/`;
async function run(browser, width, theme) {
  const { page, context, errors } = await setup(browser, width, theme, track, Number(process.env.LARGE_SCALE || 1));
  try {
    let authModule, pdsModule;
    for (const url of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))) {
      const source = process.env.PLAYER_URL ? await (await page.request.get(url)).text() : await fs.readFile(path.join(process.env.PLAYER_DIST || path.resolve(__dirname, '../dist'), new URL(url).pathname), 'utf8');
      for (const module of source.split('__d(')) if (module.includes('.setAuth=') || module.includes('"setAuth"')) authModule = Number(module.match(/\},(\d+),\[/)?.[1]);
      for (const module of source.split('__d(')) if (module.includes('.createPds=') || module.includes('"createPds"')) pdsModule = Number(module.match(/\},(\d+),\[/)?.[1]);
    }
    assert.ok(authModule);
    await context.route('https://plc.directory/**', route => route.fulfill({ json: { service: [] } }));
    await context.route('https://api.next.plyr.fm/v1/records/await?**', route => route.fulfill({ json: { status: 'pending' } }));
    let denyAdmission = true, lostPart = true, lostFinish = true, lostCreate = true, offlineRecord = true, refreshCapability = false;
    const sessions = new Map(), admissions = [], writes = [], records = new Map(), parts = [];
    let grants = 0, blobWrites = 0, finishes = 0;
    let partEntered, releasePart, holdPart = true;
    await context.exposeFunction('__largePds', async (endpoint, body) => {
      const url = new URL(endpoint, 'https://pds.fixture');
      if (url.pathname.endsWith('getServiceAuth')) {
        assert.equal(url.searchParams.get('lxm'), 'fm.plyr.upload.authorize'); grants++;
        return { status: 200, body: { token: 'ephemeral-service-fixture' } };
      }
      if (url.pathname.endsWith('uploadBlob')) { blobWrites++; throw new Error('large audio must never fall back to PDS blobs'); }
      if (url.pathname.endsWith('getRecord')) {
        if (offlineRecord) return { drop: true };
        const value = records.get(url.searchParams.get('rkey'));
        return value ? { status: 200, body: value } : { status: 404, body: { error: 'RecordNotFound' } };
      }
      assert.ok(url.pathname.endsWith('createRecord'), `unexpected PDS call ${url.pathname}`);
      const input = JSON.parse(body); writes.push(input);
      assert.equal(input.rkey, operation.rkey); assert.equal(input.repo, did);
      assert.equal(input.record.audioUrl, base.replace('/v1/uploads/', '/media/') + operation.uploadId);
      assert.equal(input.record.downloadPolicy, 'open'); assert.equal(input.record.audioBlob, undefined);
      if (records.has(input.rkey)) return { status: 400, body: { error: 'RecordAlreadyExists' } };
      records.set(input.rkey, { uri: operation.uri, cid: 'fixturecid', value: input.record });
      if (lostCreate) offlineRecord = true;
      return lostCreate ? { drop: true } : { status: 200, body: { uri: operation.uri, cid: 'fixturecid' } };
    });
    await context.route('https://jams.next.plyr.fm/v1/uploads/authorize', async route => {
      const body = route.request().postDataJSON(); admissions.push(body);
      assert.equal(body.serviceToken, 'ephemeral-service-fixture');
      assert.equal(body.visibility, 'public'); assert.equal(body.downloadPolicy, 'open');
      if (denyAdmission) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: { uploadUrl: base + body.uploadId, capability: 'ephemeral-capability', expiresAt: Date.now() + 300000 } });
    });
    function status(session) {
      return { state: session.state, recoveryRequired: false, reservedBytes: session.state === 'published' || session.state === 'cancelled' ? 0 : session.sizeBytes,
        partSizeBytes: partSize, partCount: Math.ceil(session.sizeBytes / partSize), receivedParts: session.receipts, reservedDigests: session.receipts,
        ...(['complete', 'published'].includes(session.state) ? { audioUrl: base.replace('/v1/uploads/', '/media/') + session.uploadId } : {}) };
    }
    await context.route('https://audio.fixture/v1/uploads/**', async route => {
      const request = route.request(), url = new URL(request.url()), pieces = url.pathname.split('/'), id = pieces[4];
      let session = sessions.get(id);
      assert.equal(request.headers().authorization, 'Bearer ephemeral-capability');
      if (refreshCapability) { refreshCapability = false; return route.fulfill({ status: 403, json: {} }); }
      if (!session && request.method() === 'POST' && pieces.length === 5) {
        const claim = admissions.findLast(item => item.uploadId === id); assert.ok(claim);
        session = { ...claim, state: 'transferring', receipts: [] }; sessions.set(id, session);
      }
      if (!session) return route.fulfill({ status: 404, json: { error: 'upload not found' } });
      if (request.method() === 'PUT') {
        const bytes = request.postDataBuffer(); assert.ok(bytes && bytes.length <= partSize);
        assert.equal(bytes.length, session.sizeBytes); parts.push({ id, bytes: bytes.length });
        const receipt = { number: Number(pieces[6]), sha256: createHash('sha256').update(bytes).digest('hex') };
        if (session.receipts.length && session.receipts[0].sha256 !== receipt.sha256) return route.fulfill({ status: 409, json: { error: 'part differs from reserved bytes' } });
        session.receipts = [receipt];
        if (holdPart) await new Promise(resolve => { releasePart = resolve; partEntered(); });
        if (lostPart) { lostPart = false; return route.abort('failed').catch(() => {}); }
        return route.fulfill({ json: receipt });
      }
      if (pieces[5] === 'finish') {
        finishes++;
        assert.equal(session.receipts.length, 1); session.state = 'complete';
        if (lostFinish) { lostFinish = false; return route.abort('failed'); }
      }
      if (pieces[5] === 'activate') {
        assert.ok(records.has(operation.rkey)); session.state = 'published';
      }
      if (request.method() === 'DELETE') {
        if (session.state === 'complete') return route.fulfill({ status: 409, json: { error: 'completed upload requires publication recovery' } });
        session.state = 'cancelled';
      }
      return route.fulfill({ json: status(session) });
    });
    const signIn = (account = did, grant = true) => page.evaluate(([id, account, scope]) => globalThis.__r(id).setAuth(account, {
      handle: async (url, init) => { const result = await window.__largePds(String(url), typeof init?.body === 'string' ? init.body : null);
        if (result.drop) throw new TypeError('fixture response lost');
        return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } }); },
    }, scope), [authModule, account, 'atproto repo:fm.plyr.track ' + (grant ? scope : '')]);
    async function enter() {
      await page.goto(new URL('/upload', page.url()).href);
      await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor(); await signIn();
    }
    async function choose(name, bytes = audio, button = 'Choose audio') {
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: button, exact: true }).click()]);
      await chooser.setFiles({ name, mimeType: 'audio/wav', buffer: bytes });
      await page.getByRole('button', { name, exact: true }).waitFor();
    }
    await enter();
    assert.ok(pdsModule);
    const policyErrors = await page.evaluate(async ([authId, pdsId, operation]) => {
      const pds = globalThis.__r(pdsId).createPds(globalThis.__r(authId).getAuth());
      const errors = [];
      for (const fields of [{ downloadPolicy: 'off' }, { visibility: 'private' }, { originalFileId: 'protected' }, { originalFileType: 'flac' }]) {
        try { await pds.uploadedTrack({ ...operation, record: { ...operation.record, ...fields } }, 'https://audio.fixture/media/fixture', true); errors.push(null); }
        catch (error) { errors.push(error.message); }
      }
      return errors;
    }, [authModule, pdsModule, operation]);
    assert.deepEqual(policyErrors, Array(4).fill('large uploads support public, open audio only.'));
    assert.equal(writes.length, 0, 'restricted recovery never reaches canonical create');
    await page.evaluate(() => {
      const size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get;
      Object.defineProperty(Blob.prototype, 'size', { configurable: true, get() { return this instanceof File && this.name === 'large-fixture.wav' ? 104857601 : size.call(this); } });
    });
    await signIn(did, false); await choose('large-fixture.wav');
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('large fixture');
    await page.getByRole('link', { name: 'Sign in for large uploads', exact: true }).waitFor();
    assert.ok(await page.getByRole('button', { name: 'Upload', exact: true }).isDisabled());
    assert.equal(grants, 0);
    await signIn(); await choose('large-fixture.wav');
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('large fixture');
    assert.ok(await page.getByRole('button', { name: 'Upload', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Use plyr storage', exact: true }).scrollIntoViewIfNeeded();
    await screenshot(page, `large-consent-${width}-${theme}`);
    await page.getByRole('button', { name: 'Use plyr storage', exact: true }).click();
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    await page.getByText('large upload service is unavailable. try again.', { exact: true }).waitFor();
    assert.equal(admissions[0].sizeBytes, 104857601); assert.equal(blobWrites, 0); assert.equal(parts.length, 0);
    const reserved = admissions[0]; denyAdmission = false;
    await page.getByRole('button', { name: 'Cancel transfer', exact: true }).click();
    await page.getByRole('button', { name: 'Choose audio', exact: true }).waitFor();
    assert.equal(sessions.get(reserved.uploadId).state, 'cancelled', 'an unstarted upload is cancelled at its original address');
    assert.ok(admissions.every(item => item.uploadId === reserved.uploadId && item.recordUri === reserved.recordUri));
    await page.evaluate(operation => new Promise((resolve, reject) => {
      const request = indexedDB.open('plyr-next-uploads', 1);
      request.onsuccess = () => { const transaction = request.result.transaction('uploads', 'readwrite'); transaction.objectStore('uploads').put(operation, `${operation.owner}/${operation.uploadId}`);
        transaction.oncomplete = () => { request.result.close(); resolve(); }; transaction.onerror = () => reject(transaction.error); };
    }), operation);
    await enter();
    await page.getByText('resumable fixture', { exact: true }).waitFor();
    await choose('original.wav', audio, 'Reselect original audio');
    const heldPart = new Promise(resolve => { partEntered = resolve; });
    await page.getByRole('button', { name: 'Resume upload', exact: true }).click();
    await heldPart;
    await signIn();
    releasePart(); holdPart = false;
    await page.getByRole('button', { name: 'Reselect original audio', exact: true }).waitFor();
    assert.equal(finishes, 0, 'replaced session cannot continue after a held part');
    assert.equal(parts.length, 1);
    const different = Buffer.from(audio); different[different.length - 1] = 1;
    await choose('different.wav', different, 'Reselect original audio');
    await page.getByRole('button', { name: 'Resume upload', exact: true }).click();
    await page.getByText('this file differs from the uploaded parts. choose the original file.', { exact: true }).waitFor();
    assert.equal(parts.length, 1); await screenshot(page, `large-mismatch-${width}-${theme}`);
    await enter();
    refreshCapability = true;
    await page.getByRole('button', { name: 'Check upload status', exact: true }).click();
    await page.getByRole('button', { name: 'Finish upload', exact: true }).click();
    await page.getByRole('button', { name: 'Check upload status', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Cancel transfer', exact: true }).click();
    await page.getByText('completed upload requires publication recovery', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Check upload status', exact: true }).click();
    await page.getByRole('button', { name: 'Publish this track', exact: true }).waitFor();
    await page.getByText('completed audio is retained for publication recovery and cannot be cancelled here.', { exact: true }).waitFor();
    assert.equal(parts.length, 1, 'acknowledged part is never resent');
    await page.getByRole('button', { name: 'Set aside creation', exact: true }).click();
    await page.getByText('creation set aside. the uploaded audio remains available for recovery.', { exact: true }).waitFor();
    assert.equal(writes.length, 0);
    await enter(); await page.getByRole('button', { name: 'Check upload status', exact: true }).click();
    offlineRecord = false;
    await page.getByRole('button', { name: 'Check upload status', exact: true }).click();
    await page.getByText('creation is set aside. publish only if you want to resume this attempt.', { exact: true }).waitFor();
    assert.equal(writes.length, 0); await screenshot(page, `large-archived-${width}-${theme}`);
    offlineRecord = false;
    await page.getByRole('button', { name: 'Publish this track', exact: true }).click();
    await page.getByText('could not confirm creation. check its status before trying again.', { exact: true }).waitFor();
    assert.equal(writes.length, 1);
    await signIn('did:plc:otherfixture');
    assert.equal(await page.getByText('resumable fixture', { exact: true }).count(), 0);
    await page.evaluate(operation => new Promise((resolve, reject) => {
      const request = indexedDB.open('plyr-next-pending-creates', 1);
      request.onsuccess = () => { const transaction = request.result.transaction('operations', 'readwrite'), store = transaction.objectStore('operations');
        const key = `${operation.owner}/${operation.collection}/${operation.rkey}`, read = store.get(key);
        read.onsuccess = () => store.put({ ...read.result, archived: false }, key);
        transaction.oncomplete = () => { request.result.close(); resolve(); }; transaction.onerror = () => reject(transaction.error); };
    }), operation);
    await signIn(); offlineRecord = false; lostCreate = false;
    await choose('fresh.wav');
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('unrelated fresh draft');
    await page.getByText('finish or set aside the earlier creation before uploading another track.', { exact: true }).waitFor();
    assert.ok(await page.getByRole('button', { name: 'Upload', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Check upload status', exact: true }).click();
    await page.getByRole('button', { name: 'Check playback availability', exact: true }).click();
    await page.getByText('saved. public audio is available.', { exact: true }).waitFor();
    assert.equal(writes.length, 1); assert.equal(blobWrites, 0);
    await screenshot(page, `large-published-${width}-${theme}`);
    await page.getByRole('button', { name: 'Done with upload', exact: true }).click();
    await page.getByText('resumable fixture', { exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('textbox', { name: 'Title', exact: true }).inputValue(), 'unrelated fresh draft');
    assert.ok(await page.getByRole('button', { name: 'Upload', exact: true }).isEnabled());
    assert.deepEqual(errors, []);
    console.log(`${width}/${theme}: consent, dedicated grant, bounded small transfer, mismatch protection, capability refresh, lost part/finish/create, cancellation conflict, archive/reload, held-part same-account reauth, owner isolation and activation passed`);
  } catch (error) { console.error(await page.locator('body').innerText()); await screenshot(page, `large-failure-${width}-${theme}`); throw error; }
  finally { await context.close(); }
}
withPlayerHarness(async browser => {
  for (const width of process.env.LARGE_SMOKE ? [390] : [390, 1280]) for (const theme of process.env.LARGE_SMOKE ? ['light'] : ['light', 'dark']) await run(browser, width, theme);
}).catch(error => { console.error(error); process.exitCode = 1; });
