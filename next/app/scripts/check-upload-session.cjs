const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');

const dist = process.env.PLAYER_DIST || path.resolve(__dirname, '../dist');
const did = 'did:plc:uploadfixture';
const other = 'did:plc:otherupload';
const audio = Buffer.alloc(16044);
audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);

async function run(browser, width, theme) {
  const { page, context, errors } = await setup(browser, width, theme, track);
  try {
    let authModule;
    for (const url of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))) {
      const source = process.env.PLAYER_URL ? await (await page.request.get(url)).text() : await fs.readFile(path.join(dist, new URL(url).pathname), 'utf8');
      for (const module of source.split('__d(')) {
        if (module.includes('.setAuth=') || module.includes('"setAuth"')) authModule = Number(module.match(/\},(\d+),\[/)?.[1]);
      }
    }
    assert.ok(authModule, 'find the auth-state boundary');
    await page.route('https://plc.directory/**', route => route.fulfill({ json: { id: did, service: [] } }));
    await page.route('https://api.next.plyr.fm/v1/records/await?**', route => route.fulfill({ json: { status: 'pending' } }));
    let holdBlob = false, holdCreate = false, reject = false, release, entered;
    const waitForHold = () => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('upload did not reach the held PDS request')), 30_000);
      entered = () => { clearTimeout(timeout); resolve(); };
    });
    const writes = [], records = new Map();
    await page.exposeFunction('__uploadPds', async (url, body) => {
      if (url.includes('listRecords')) return { status: 200, body: { records: [] } };
      if (url.includes('getRecord')) {
        const record = records.get(new URL(url, 'https://fixture.invalid').searchParams.get('rkey'));
        return record ? { status: 200, body: record } : { status: 404, body: { error: 'RecordNotFound' } };
      }
      if (url.includes('uploadBlob')) {
        if (holdBlob) await new Promise(resolve => { release = resolve; entered(); });
        if (reject) return { status: 400, body: { error: 'InvalidRequest', message: 'fixture upload unavailable' } };
        return { status: 200, body: { blob: { $type: 'blob', ref: { $link: 'bafkreigh2akiscaildcw4533xrlwoecrloyfg4huyh2fq7rmr5mnnxfk5q' }, mimeType: 'audio/wav', size: audio.length } } };
      }
      assert.ok(url.includes('createRecord'), `unexpected PDS operation: ${url}`);
      const input = JSON.parse(body);
      writes.push(input);
      const result = { uri: `at://${input.repo}/fm.plyr.track/${input.rkey}`, cid: 'createdcid', value: input.record };
      records.set(input.rkey, result);
      if (holdCreate) await new Promise(resolve => { release = resolve; entered(); });
      return { status: 200, body: result };
    });
    const signIn = account => page.evaluate(([id, owner]) => globalThis.__r(id).setAuth(owner, {
      handle: async (url, init) => {
        window.__uploadCalls = (window.__uploadCalls || 0) + 1;
        const response = await window.__uploadPds(String(url), typeof init?.body === 'string' ? init.body : null);
        return new Response(JSON.stringify(response.body), { status: response.status, headers: { 'content-type': 'application/json' } });
      },
    }, 'atproto repo:fm.plyr.track'), [authModule, account]);
    await page.goto(new URL('/upload', page.url()).href);
    await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor();
    await signIn(did);
    const title = page.getByRole('textbox', { name: 'Title', exact: true });
    const tags = page.getByRole('textbox', { name: 'Tags', exact: true });
    const submit = () => page.getByRole('button', { name: 'Upload', exact: true });
    const toast = text => page.getByTestId('toast').filter({ hasText: text });
    async function choose() {
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choose audio', exact: true }).click()]);
      await chooser.setFiles({ name: 'quiet room.mp3', mimeType: 'audio/mpeg', buffer: audio });
      await page.getByRole('button', { name: 'quiet room.mp3', exact: true }).waitFor();
      const details = page.getByRole('button', { name: 'add album, description or tags', exact: true });
      if (await details.count()) await details.click();
    }
    await choose();
    await tags.fill('é'.repeat(26));
    await submit().click();
    await page.getByText(/a tag is too long/).waitFor();
    assert.equal(writes.length, 0, 'invalid Unicode tag cannot publish');
    await title.fill('private draft');
    await signIn(other);
    assert.equal(await title.inputValue(), '', 'draft does not cross accounts');
    await page.getByRole('button', { name: 'Choose audio', exact: true }).waitFor();
    await signIn(did);
    await choose();
    holdBlob = true;
    const blobHeld = waitForHold();
    await submit().click();
    await blobHeld;
    assert.equal(await title.inputValue(), '', 'the form resets as soon as the upload is queued');
    await page.getByRole('button', { name: 'Choose audio', exact: true }).waitFor();
    await toast('uploading "quiet room"…').waitFor();
    await screenshot(page, `upload-queued-${width}-${theme}`);
    await signIn(other);
    release(); holdBlob = false;
    await toast('"quiet room" didn\'t upload').first().waitFor();
    assert.equal(writes.length, 0, 'switch during blob upload cannot publish the previous account');
    await page.getByRole('button', { name: 'Choose audio', exact: true }).waitFor();
    await choose();
    await tags.fill(' AI \n--Hip-Hop--\nai');
    reject = true;
    await submit().click();
    await toast(/fixture upload unavailable/).waitFor();
    assert.equal(writes.length, 0);
    await screenshot(page, `upload-error-${width}-${theme}`);
    reject = false; holdCreate = true;
    await choose();
    await tags.fill(' AI \n--Hip-Hop--\nai');
    const createHeld = waitForHold();
    await submit().click();
    await createHeld;
    assert.equal(writes.length, 1);
    assert.equal(writes[0].repo, other);
    assert.deepEqual(writes[0].record.tags, ['ai', 'hip-hop']);
    await signIn(did);
    release(); holdCreate = false;
    await page.getByRole('button', { name: 'Choose audio', exact: true }).waitFor();
    await choose();
    await submit().click();
    await toast('"quiet room" uploaded').waitFor();
    await page.getByRole('link', { name: 'View track', exact: true }).first().waitFor();
    assert.equal(writes.length, 2, 'accepted writes are not replayed for projection delay');
    assert.equal(writes[1].repo, did);
    assert.equal(Object.hasOwn(writes[1].record, 'tags'), false, 'blank upload leaves tags absent');
    await screenshot(page, `upload-saved-${width}-${theme}`);
    await signIn(other);
    await page.getByRole('button', { name: 'Upload another', exact: true }).click();
    await page.getByRole('button', { name: 'Choose audio', exact: true }).waitFor();
    await choose();
    holdCreate = true;
    const reauthHeld = waitForHold();
    await submit().click();
    await reauthHeld;
    assert.equal(writes.length, 3);
    await signIn(other);
    await title.fill('fresh session draft');
    release(); holdCreate = false;
    await toast('"quiet room" uploaded').waitFor();
    assert.equal(await title.inputValue(), 'fresh session draft', 'a finishing upload never touches the form');
    await screenshot(page, `upload-reauth-${width}-${theme}`);
    await choose();
    await submit().click();
    for (let wait = 0; writes.length < 4 && wait < 100; wait++) await page.waitForTimeout(100);
    await toast('"quiet room" uploaded').first().waitFor();
    assert.equal(writes.length, 4, 'same-DID reauth finishes its held upload once and the next upload once');
    await page.evaluate(id => globalThis.__r(id).clearAuth(), authModule);
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'sign in to plyr.fm', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('return_to'), '/upload');
    assert.deepEqual(errors, []);
    console.log(`${width}/${theme}: queued upload resets the form, toasts progress, isolates accounts, survives same-DID reauth, and returns to login passed`);
  } catch (error) { console.error(await page.locator('body').innerText()); throw error; }
  finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}

withPlayerHarness(async browser => {
  console.log('Auth-state injection and in-memory PDS; no real account writes or OAuth acceptance');
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) await run(browser, width, theme);
}).catch(error => { console.error(error); process.exitCode = 1; });
