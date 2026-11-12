const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');
const did = 'did:plc:processingfixture', scope = 'atproto repo:fm.plyr.track rpc:fm.plyr.upload.authorize?aud=did:web:plyr-jams-next.fly.dev#jams';
const audio = Buffer.alloc(16044);
audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28);
audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
async function run(browser, width, theme, scale) {
  const { page, context, errors } = await setup(browser, width, theme, track, scale);
  let authId, claim, session, record, writes = 0, parts = 0, retries = 0, heldCreate, releaseCreate;
  const root = `https://processing.fixture/v1/uploads/${'b'.repeat(64)}/`;
  try {
    for (const url of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))) {
      const source = process.env.PLAYER_URL ? await (await page.request.get(url)).text() : await fs.readFile(path.join(process.env.PLAYER_DIST || path.resolve(__dirname, '../dist'), new URL(url).pathname), 'utf8');
      for (const module of source.split('__d(')) if (module.includes('.setAuth=') || module.includes('"setAuth"')) authId = Number(module.match(/\},(\d+),\[/)?.[1]);
    }
    assert.ok(authId);
    await context.route('https://api.next.plyr.fm/v1/records/await?**', route => route.fulfill({ json: { status: 'pending' } }));
    await context.route('https://plc.directory/**', route => route.fulfill({ json: { service: [] } }));
    await context.exposeFunction('__processingPds', async (endpoint, body) => {
      const url = new URL(endpoint, 'https://pds.fixture');
      if (url.pathname.endsWith('getServiceAuth')) return { status: 200, body: { token: 'fixture-owner-token' } };
      if (url.pathname.endsWith('getRecord')) return record ? { status: 200, body: record } : { status: 404, body: { error: 'RecordNotFound' } };
      assert.ok(url.pathname.endsWith('createRecord'), `unexpected PDS call ${url.pathname}`);
      const input = JSON.parse(body); writes++;
      assert.equal(`at://${input.repo}/${input.collection}/${input.rkey}`, claim.recordUri);
      assert.equal(input.record.fileType, 'mp3'); assert.equal(input.record.duration, 1);
      assert.equal(input.record.downloadPolicy, 'open'); assert.equal(input.record.audioBlob, undefined);
      assert.equal(input.record.audioUrl, root.replace('/v1/uploads/', '/media/') + claim.uploadId);
      record = { uri: claim.recordUri, cid: 'fixturecid', value: input.record };
      if (heldCreate) await new Promise(resolve => { releaseCreate = resolve; heldCreate(); });
      return { drop: true };
    });
    await context.route('https://plyr-jams-next.fly.dev/v1/uploads/authorize', async route => {
      const next = route.request().postDataJSON();
      if (claim) assert.deepEqual(next, claim); else claim = next;
      assert.deepEqual(claim.processing, { recipe: 'mp3-320k-44100-v1', outputBudget: 128 * 1024 * 1024 });
      assert.equal(claim.sizeBytes, audio.length);
      await route.fulfill({ json: { uploadUrl: root + claim.uploadId, capability: 'fixture-capability', expiresAt: Date.now() + 300000 } });
    });
    function status() {
      return { state: session.state, processing: claim.processing, recoveryRequired: !!session.failure,
        ...(session.failure ? { processingFailure: session.failure } : {}), reservedBytes: session.state === 'published' ? 0 : claim.sizeBytes + claim.processing.outputBudget,
        partSizeBytes: 10485760, partCount: 1, receivedParts: session.receipts, reservedDigests: session.receipts,
        ...(['complete', 'published'].includes(session.state) ? { audioUrl: root.replace('/v1/uploads/', '/media/') + claim.uploadId,
          rendition: { fileType: 'mp3', contentType: 'audio/mpeg', sizeBytes: 40000, duration: 1 } } : {}) };
    }
    await context.route('https://processing.fixture/v1/uploads/**', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(request.headers().authorization, 'Bearer fixture-capability');
      assert.ok(!['DELETE'].includes(request.method()), 'processing cannot pretend to cancel');
      session ??= { state: 'transferring', receipts: [] };
      if (request.method() === 'PUT') {
        const bytes = request.postDataBuffer(); assert.deepEqual(bytes, audio); parts++;
        const receipt = { number: 1, sha256: createHash('sha256').update(bytes).digest('hex') };
        session.receipts = [receipt]; return route.fulfill({ json: receipt });
      }
      if (url.pathname.endsWith('/finish')) session.state = 'processing';
      if (url.pathname.endsWith('/retry-processing')) { retries++; session.failure = undefined; }
      if (url.pathname.endsWith('/activate')) { assert.ok(record); session.state = 'published'; }
      await route.fulfill({ json: status() });
    });
    const signIn = () => page.evaluate(([id, did, scope]) => globalThis.__r(id).setAuth(did, { handle: async (url, init) => {
      const result = await window.__processingPds(String(url), typeof init?.body === 'string' ? init.body : null);
      if (result.drop) throw new TypeError('lost fixture create response');
      return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
    } }, scope), [authId, did, scope]);
    async function enter() { await page.goto(new URL('/upload', page.url()).href); await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor(); await signIn(); }
    const button = name => page.getByRole('button', { name, exact: true });
    await enter();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button('Choose audio').click()]);
    await chooser.setFiles({ name: 'original.wav', mimeType: 'audio/wav', buffer: audio });
    await page.getByRole('textbox', { name: 'Artist', exact: true }).fill('fixture artist');
    await button('Create MP3 playback').click();
    assert.ok(await button('Upload').isDisabled());
    const budget = page.getByRole('textbox', { name: 'MP3 space to reserve (MiB)', exact: true });
    await budget.fill('0'); await button('Use plyr storage').click();
    assert.ok(await button('Upload').isDisabled()); assert.equal(claim, undefined);
    await budget.fill('128'); assert.ok(await button('Upload').isDisabled(), 'budget change requires renewed consent');
    await budget.scrollIntoViewIfNeeded(); await screenshot(page, `processing-consent-${width}-${theme}-${scale}`);
    await button('Use plyr storage').click(); await button('Upload').click();
    await page.getByText('creating MP3 playback. the original is safely uploaded.', { exact: true }).waitFor();
    assert.equal(parts, 1); assert.equal(writes, 0);
    assert.equal(await button('Cancel transfer').count(), 0);
    await enter(); await button('Check upload status').click();
    assert.equal(await button('Reselect original audio').count(), 0, 'processing resumes without original file access');
    session.failure = 'output_budget_exceeded';
    await button('Check upload status').click();
    const failure = page.getByText('the MP3 needs more space than reserved. the original is retained.', { exact: true });
    await failure.waitFor(); await failure.scrollIntoViewIfNeeded();
    const box = await failure.boundingBox(); assert.ok(box.y >= 0 && box.y + box.height <= page.viewportSize().height);
    assert.equal(await button('Retry MP3 processing').count(), 0); assert.equal(retries, 0);
    await screenshot(page, `processing-capacity-${width}-${theme}-${scale}`);
    session.failure = 'executor_failed'; await button('Check upload status').click();
    await button('Retry MP3 processing').click(); await page.getByText('creating MP3 playback. the original is safely uploaded.', { exact: true }).waitFor(); await button('Check upload status').waitFor(); assert.equal(retries, 1); assert.equal(parts, 1);
    session.state = 'complete'; await button('Check upload status').click();
    await button('Set aside creation').click(); await page.getByText('creation set aside. the uploaded audio remains available for recovery.', { exact: true }).waitFor(); assert.equal(writes, 0);
    await enter(); await button('Check upload status').click();
    await page.getByText('creation is set aside. publish only if you want to resume this attempt.', { exact: true }).waitFor();
    const entered = new Promise(resolve => { heldCreate = resolve; });
    await button('Publish this track').click(); await entered; await signIn(); releaseCreate(); heldCreate = undefined;
    await button('Check upload status').waitFor();
    assert.equal(session.state, 'complete', 'old session cannot activate after held create');
    await button('Check upload status').click(); await button('Check playback availability').click();
    await page.getByText('saved. public audio is available.', { exact: true }).waitFor();
    assert.equal(await page.getByText('creation is set aside. publish only if you want to resume this attempt.', { exact: true }).count(), 0);
    assert.equal(writes, 1, 'lost response reconciles the exact transformed record without replay');
    assert.equal(parts, 1); await screenshot(page, `processing-published-${width}-${theme}-${scale}`);
    await button('Done with upload').click();
    assert.deepEqual(errors, []);
    console.log(`${width}/${theme}/${scale}: consent, immutable reservation, processing reload, capacity stop, retry, archive, transformed canonical recovery and session replacement passed`);
  } catch (error) { console.error(await page.locator('body').innerText()); await screenshot(page, `processing-failure-${width}-${theme}-${scale}`); throw error; }
  finally { await context.close(); }
}
withPlayerHarness(async browser => {
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) await run(browser, width, theme, 1);
  await run(browser, 390, 'light', 1.3);
}).catch(error => { console.error(error); process.exitCode = 1; });
