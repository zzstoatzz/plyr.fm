const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');
const did = track.artist.did;
const initial = { $type: 'fm.plyr.track', title: 'canonical title', artist: 'fixture artist', createdAt: '2026-11-12T00:00:00Z', fileType: 'wav', extra: { preserved: true }, labels: { values: [{ val: 'porn' }] } };

async function run(browser, width, theme) {
  const { page, context, errors } = await setup(browser, width, theme, track);
  try {
    let authModule;
    for (const url of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))) {
      const source = process.env.PLAYER_URL ? await (await page.request.get(url)).text() : await fs.readFile(path.join(process.env.PLAYER_DIST || path.resolve(__dirname, '../dist'), new URL(url).pathname), 'utf8');
      for (const module of source.split('__d(')) if (module.includes('.setAuth=') || module.includes('"setAuth"')) authModule = Number(module.match(/\},(\d+),\[/)?.[1]);
    }
    assert.ok(authModule);
    await page.route('https://plc.directory/**', route => route.fulfill({ json: { service: [] } }));
    await page.route('https://api.next.plyr.fm/v1/records/await?**', route => route.fulfill({ json: { status: 'pending' } }));
    let record = { ...initial, tags: ['ai', 'ambient'] }, cid = 'revision1', hold = false, release, entered;
    const writes = [];
    await page.exposeFunction('__tagsPds', async (endpoint, body) => {
      const url = new URL(endpoint, 'https://fixture.invalid');
      if (url.pathname.endsWith('listRecords')) return { status: 200, body: { records: [] } };
      if (url.pathname.endsWith('getRecord')) return { status: 200, body: { uri: track.record.uri, cid, value: record } };
      if (url.pathname.endsWith('deleteRecord')) {
        assert.equal(JSON.parse(body).swapRecord, cid);
        return { status: 200, body: {} };
      }
      assert.ok(url.pathname.endsWith('putRecord'), `unexpected operation ${url.pathname}`);
      const input = JSON.parse(body);
      writes.push(input);
      assert.equal(input.repo, did);
      if (input.swapRecord !== cid) return { status: 409, body: { error: 'InvalidSwap', message: 'fixture revision changed' } };
      assert.deepEqual(input.record.extra, record.extra);
      assert.deepEqual(input.record.labels, initial.labels, 'creator warnings survive tag edits');
      record = input.record; cid = `revision${writes.length + 1}`;
      if (hold) await new Promise(resolve => { release = resolve; entered(); });
      return { status: 200, body: { uri: track.record.uri, cid } };
    });
    const signIn = () => page.evaluate(([id, did]) => globalThis.__r(id).setAuth(did, {
      handle: async (url, init) => { const reply = await window.__tagsPds(String(url), init?.body); if (String(url).includes('putRecord')) window.__tagsWritesSettled = (window.__tagsWritesSettled || 0) + 1; return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } }); },
    }, 'atproto repo:fm.plyr.track'), [authModule, did]);
    await page.goto(new URL(`/edit-track/${track.id}`, page.url()).href);
    await page.getByText('only the artist can edit this track.', { exact: true }).waitFor();
    await signIn();
    const tags = page.getByRole('textbox', { name: 'Tags', exact: true });
    const save = page.getByRole('button', { name: 'Save', exact: true });
    const title = page.getByRole('textbox', { name: 'Title', exact: true });
    await tags.waitFor();
    assert.equal(await tags.inputValue(), 'ai\nambient', 'tags come from canonical record, not catalog labels');
    assert.equal(await title.inputValue(), initial.title);
    await tags.fill('🎵'.repeat(13));
    await save.click();
    await page.getByText(/a tag is too long/).waitFor();
    assert.equal(writes.length, 0);
    await tags.fill('ai\0hidden');
    await save.click();
    await page.getByText('tags cannot contain null characters.', { exact: true }).waitFor();
    assert.equal(writes.length, 0);
    await tags.fill(' AI \n--Hip-Hop--\nai\nAI   Generated');
    cid = 'changed-elsewhere';
    record = { ...record, title: 'changed elsewhere', extra: { preserved: true, newer: true } };
    await save.click();
    await page.getByText('this track changed elsewhere. reload the latest version before saving.', { exact: true }).waitFor();
    assert.equal(await tags.inputValue(), ' AI \n--Hip-Hop--\nai\nAI   Generated', 'conflict preserves draft');
    assert.equal(writes[0].swapRecord, 'revision1');
    assert.equal(await save.isDisabled(), true, 'stale revision cannot be resubmitted');
    await screenshot(page, `tags-conflict-${width}-${theme}`);
    await page.getByRole('button', { name: 'Discard draft and reload', exact: true }).click();
    await page.getByText('this track changed elsewhere. reload the latest version before saving.', { exact: true }).waitFor({ state: 'detached' });
    await tags.waitFor();
    assert.equal(await tags.inputValue(), 'ai\nambient');
    assert.equal(await title.inputValue(), 'changed elsewhere');
    await tags.fill(' AI \n--Hip-Hop--\nai\nAI   Generated');
    await save.click();
    await page.getByRole('button', { name: 'View track', exact: true }).waitFor();
    assert.deepEqual(record.tags, ['ai', 'hip-hop', 'ai generated']);
    assert.equal(writes.length, 2);
    assert.equal(writes[1].swapRecord, 'changed-elsewhere');
    assert.deepEqual(record.extra, { preserved: true, newer: true });
    assert.equal(await save.count(), 0, 'accepted writes cannot be resubmitted');
    await signIn();
    await tags.waitFor();
    await tags.fill('');
    await save.click();
    await page.getByRole('button', { name: 'View track', exact: true }).waitFor();
    assert.deepEqual(record.tags, [], 'explicit clear publishes empty array');
    record = { ...initial }; cid = 'absent';
    await signIn();
    await tags.waitFor();
    await title.fill('unrelated title edit');
    await save.click();
    await page.getByRole('button', { name: 'View track', exact: true }).waitFor();
    assert.equal(Object.hasOwn(record, 'tags'), false, 'untouched missing tags remain missing');
    record = { ...initial, tags: ['Legacy CASE', 'é'.repeat(26)] }; cid = 'legacy';
    await signIn();
    await tags.waitFor();
    await title.fill('preserve legacy tags');
    await save.click();
    await page.getByRole('button', { name: 'View track', exact: true }).waitFor();
    assert.deepEqual(record.tags, ['Legacy CASE', 'é'.repeat(26)], 'untouched legacy tags remain byte-for-byte');
    await signIn();
    await tags.waitFor();
    await tags.fill('ai');
    hold = true;
    const held = new Promise(resolve => { entered = resolve; });
    await save.click();
    await held;
    await signIn();
    await tags.waitFor();
    await tags.fill('fresh session');
    const settled = await page.evaluate(() => window.__tagsWritesSettled || 0);
    release(); hold = false;
    await page.waitForFunction(count => window.__tagsWritesSettled === count + 1, settled);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await tags.inputValue(), 'fresh session');
    assert.equal(await save.isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: 'View track', exact: true }).count(), 0);
    await screenshot(page, `tags-fresh-session-${width}-${theme}`);
    await page.getByRole('button', { name: 'Delete track', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
    await page.getByRole('button', { name: 'Back to your music', exact: true }).click();
    await page.getByRole('heading', { name: 'your music', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'edit track', exact: true }).waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
    console.log(`${width}/${theme}: canonical tags, Unicode validation, conflict recovery, CAS/unknown fields, clear/absence/legacy preservation and session isolation passed`);
  } catch (error) {
    console.error(await page.locator('body').innerText());
    await screenshot(page, `tags-failure-${width}-${theme}`);
    throw error;
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}
withPlayerHarness(async browser => {
  console.log('Auth/PDS fixtures only; external mutations blocked');
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) await run(browser, width, theme);
}).catch(error => { console.error(error); process.exitCode = 1; });
