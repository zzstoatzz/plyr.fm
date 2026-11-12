const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');
const did = track.artist.did;
const audio = Buffer.alloc(16044);
audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
const blob = { $type: 'blob', ref: { $link: 'bafkreigh2akiscaildcw4533xrlwoecrloyfg4huyh2fq7rmr5mnnxfk5q' }, mimeType: 'audio/wav', size: audio.length };
const initial = { $type: 'fm.plyr.track', title: 'the song stays here', artist: 'fixture artist', createdAt: '2026-11-12T00:00:00Z', fileType: 'mp3', audioUrl: 'https://old.invalid/old.mp3', duration: 99, tags: ['ambient'], extra: { preserved: true }, labels: { values: [{ val: 'porn' }] } };

async function run(browser, width, theme, scale) {
  const { page, context, errors } = await setup(browser, width, theme, track, scale);
  try {
    let authModule;
    for (const url of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))) {
      const source = process.env.PLAYER_URL ? await (await page.request.get(url)).text() : await fs.readFile(path.join(process.env.PLAYER_DIST || path.resolve(__dirname, '../dist'), new URL(url).pathname), 'utf8');
      for (const module of source.split('__d(')) if (module.includes('.setAuth=') || module.includes('"setAuth"')) authModule = Number(module.match(/\},(\d+),\[/)?.[1]);
    }
    assert.ok(authModule);
    await page.route('https://plc.directory/**', route => route.fulfill({ json: { service: [] } }));
    await page.route('https://api.next.plyr.fm/v1/records/await?**', route => route.fulfill({ json: { status: 'pending' } }));
    let record = structuredClone(initial), cid = 'revision1', loseResponse = false, unreadable = false, holdBlob = false, release, entered;
    let visibility = 'public', policyAfterBlob = false;
    await page.route(`https://api.next.plyr.fm/v1/tracks/${track.id}`, route => route.fulfill({ json: { ...track, access: { visibility } } }));
    const writes = [];
    let blobUploads = 0;
    await page.exposeFunction('__replacePds', async (endpoint, body) => {
      const url = new URL(endpoint, 'https://fixture.invalid');
      if (url.pathname.endsWith('listRecords')) return { status: 200, body: { records: [] } };
      if (url.pathname.endsWith('getRecord')) return unreadable ? { status: 503, body: { error: 'Unavailable' } } : { status: 200, body: { uri: track.record.uri, cid, value: record } };
      if (url.pathname.endsWith('uploadBlob')) {
        blobUploads++;
        assert.deepEqual(Buffer.from(body), audio);
        if (holdBlob) await new Promise(resolve => { release = resolve; entered(); });
        if (policyAfterBlob) visibility = 'supporters';
        return { status: 200, body: { blob } };
      }
      assert.ok(url.pathname.endsWith('putRecord'), `unexpected operation ${url.pathname}`);
      const input = JSON.parse(body);
      writes.push(input);
      assert.equal(input.repo, did);
      assert.equal(`at://${input.repo}/${input.collection}/${input.rkey}`, track.record.uri, 'replacement keeps the existing canonical address');
      if (input.swapRecord !== cid) return { status: 409, body: { error: 'InvalidSwap' } };
      record = input.record; cid = `saved-${writes.length}`;
      return loseResponse ? { status: 503, body: { error: 'Unavailable' } } : { status: 200, body: { uri: track.record.uri, cid } };
    });
    const signIn = (owner = did) => page.evaluate(([id, owner]) => globalThis.__r(id).setAuth(owner, {
      handle: async (url, init) => {
        const body = init?.body instanceof ArrayBuffer ? Array.from(new Uint8Array(init.body)) : init?.body;
        const reply = await window.__replacePds(String(url), body);
        if (String(url).includes('uploadBlob')) window.__replacementBlobSettled = true;
        return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
      }
    }, 'atproto repo:fm.plyr.track'), [authModule, owner]);
    const choose = async () => {
      const button = page.getByRole('button', { name: 'Replace audio', exact: true });
      await button.waitFor();
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button.click()]);
      await chooser.setFiles({ name: 'a replacement recording with a long file name.wav', mimeType: 'audio/wav', buffer: audio });
      await page.getByRole('button', { name: 'Keep current audio', exact: true }).waitFor();
    };
    const save = page.getByRole('button', { name: 'Save', exact: true });
    const title = page.getByRole('textbox', { name: 'Title', exact: true });
    const view = page.getByRole('button', { name: 'View track', exact: true });
    const reset = async extra => { record = { ...structuredClone(initial), ...extra }; cid = `fresh-${writes.length}`; unreadable = false; loseResponse = false; await signIn(); await title.waitFor(); };
    await page.goto(new URL(`/edit-track/${track.id}`, page.url()).href);
    await page.getByText('only the artist can edit this track.', { exact: true }).waitFor();
    await page.goto(new URL(`/track/${track.id}`, page.url()).href);
    await signIn();
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('link', { name: 'edit track', exact: true }).click();
    await title.waitFor();
    await choose();
    await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined))));
    await screenshot(page, `replacement-draft-${width}-${theme}-${scale}`);
    await page.getByRole('button', { name: 'Keep current audio', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Replace audio', exact: true }).count(), 1);
    assert.equal(writes.length, 0);
    await choose(); await save.click(); await view.waitFor();
    assert.equal(record.title, initial.title);
    assert.deepEqual(record.labels, initial.labels);
    assert.deepEqual(record.extra, initial.extra);
    assert.deepEqual(record.tags, initial.tags);
    assert.deepEqual(record.audioBlob, blob);
    assert.equal(record.audioUrl, undefined);
    assert.equal(record.duration, 1);
    assert.equal(record.fileType, 'wav');
    assert.equal(writes.length, 1);
    await reset(); await choose(); cid = 'other-editor'; record.extra = { newer: true };
    await save.click();
    await page.getByText('this track changed elsewhere. reload the latest version before saving.', { exact: true }).waitFor();
    assert.equal(await save.isDisabled(), true);
    assert.deepEqual(record.extra, { newer: true });
    const conflictBox = await page.getByText('this track changed elsewhere. reload the latest version before saving.', { exact: true }).boundingBox();
    assert.ok(conflictBox && conflictBox.y >= 0 && conflictBox.y + conflictBox.height <= 900, 'conflict stays visible beside the editor, without scrolling away from Save');
    await screenshot(page, `replacement-conflict-${width}-${theme}-${scale}`);
    await reset(); await choose(); loseResponse = true;
    const beforeLost = writes.length;
    await save.click(); await view.waitFor();
    assert.equal(writes.length, beforeLost + 1, 'lost response reconciles without another write');
    await reset(); await choose(); loseResponse = true; unreadable = true;
    await save.click();
    await page.getByText('could not confirm the saved track. reload the latest version before saving again.', { exact: true }).waitFor();
    assert.equal(await save.isDisabled(), true);
    await reset(); await choose(); holdBlob = true;
    await page.evaluate(() => { window.__replacementBlobSettled = false; });
    const held = new Promise(resolve => { entered = resolve; });
    const beforeSwitch = writes.length;
    await save.click(); await held; await signIn(); await title.waitFor(); await title.fill('fresh session draft');
    release(); holdBlob = false;
    await page.waitForFunction(() => window.__replacementBlobSettled === true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(writes.length, beforeSwitch, 'reauth before blob response prevents publishing');
    assert.equal(await title.inputValue(), 'fresh session draft');
    assert.equal(await save.isEnabled(), true);
    await reset(); await choose();
    const beforeRead = { blobs: blobUploads, writes: writes.length };
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = async function () {
        const bytes = await original.call(this);
        window.__replacementReadEntered = true;
        await new Promise(resolve => { window.__releaseReplacementRead = resolve; });
        File.prototype.arrayBuffer = original;
        window.__replacementReadSettled = true;
        return bytes;
      };
    });
    await save.click(); await page.waitForFunction(() => window.__replacementReadEntered === true);
    await signIn('did:plc:otherreplacement');
    await page.getByText('only the artist can edit this track.', { exact: true }).waitFor();
    await page.evaluate(() => window.__releaseReplacementRead());
    await page.waitForFunction(() => window.__replacementReadSettled === true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual({ blobs: blobUploads, writes: writes.length }, beforeRead, 'account switch during file read prevents even the blob upload');
    for (const policy of ['supporters', 'unlisted']) {
      await reset(); await choose(); visibility = policy;
      const beforePolicy = { blobs: blobUploads, writes: writes.length };
      await save.click();
      await page.getByText('replace protected or restricted audio in the current app.', { exact: true }).waitFor();
      assert.deepEqual({ blobs: blobUploads, writes: writes.length }, beforePolicy, 'fresh effective policy blocks the public blob');
      await signIn(); await title.waitFor();
      assert.equal(await page.getByRole('button', { name: 'Replace audio', exact: true }).count(), 0, 'effective restriction hides replacement despite a plain canonical record');
      visibility = 'public';
    }
    await reset(); await choose(); policyAfterBlob = true;
    const beforePolicyChange = writes.length;
    await save.click();
    await page.getByText('replace protected or restricted audio in the current app.', { exact: true }).waitFor();
    assert.equal(writes.length, beforePolicyChange, 'policy change during blob upload prevents publication');
    assert.equal(record.audioUrl, initial.audioUrl);
    policyAfterBlob = false; visibility = 'public';
    await reset({ audioSpace: 'at://did:plc:fixture/space/fm.plyr.audio/protected' });
    assert.equal(await page.getByRole('button', { name: 'Replace audio', exact: true }).count(), 0);
    await title.fill('metadata still editable'); await save.click(); await view.waitFor();
    assert.equal(record.audioSpace, 'at://did:plc:fixture/space/fm.plyr.audio/protected');
    assert.deepEqual(errors, []);
    console.log(`${width}/${theme}/${scale}: replacement, cancellation, canonical identity, warnings, CAS, lost-response reconciliation and session/policy isolation passed`);
  } catch (error) {
    console.error(await page.locator('body').innerText()); await screenshot(page, `replacement-failure-${width}-${theme}-${scale}`); throw error;
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}
withPlayerHarness(async browser => {
  console.log('Disposable browser/PDS fixtures only; external writes blocked');
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) await run(browser, width, theme, Number(process.env.PLAYER_SCALE || 1));
}).catch(error => { console.error(error); process.exitCode = 1; });
