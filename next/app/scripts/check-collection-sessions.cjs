const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');
const did = 'did:plc:fixture';
const uri = `at://${did}/fm.plyr.list/collection-session`;
const record = { $type: 'fm.plyr.list', name: 'a quiet collection', listType: 'playlist', items: [{ subject: { uri: track.record.uri, cid: track.record.cid } }], createdAt: '2026-11-12T00:00:00Z', future: { preserved: true } };

async function run(browser, width, theme) {
  const { page, context, errors } = await setup(browser, width, theme, track, Number(process.env.COLLECTION_SCALE || 1));
  try {
    let authModule, pdsModule;
    for (const url of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))) {
      const source = process.env.PLAYER_URL ? await (await page.request.get(url)).text() : await fs.readFile(path.join(process.env.PLAYER_DIST || path.resolve(__dirname, '../dist'), new URL(url).pathname), 'utf8');
      for (const module of source.split('__d(')) {
        const id = Number(module.match(/\},(\d+),\[/)?.[1]);
        if (module.includes('.setAuth=') || module.includes('"setAuth"')) authModule = id;
        if (module.includes('.createPds=') || module.includes('"createPds"')) pdsModule = id;
      }
    }
    assert.ok(authModule && pdsModule, 'find actual auth and PDS modules');
    await page.route('https://api.next.plyr.fm/v1/records/await?**', route => route.fulfill({ json: { status: 'pending' } }));
    await page.route('https://api.next.plyr.fm/v1/playlists/*', route => route.fulfill({ json: {
      object: 'playlist', id: 'fixture', owner: { did, profile: track.artist.profile }, record: { uri, cid: 'before' },
      metadata: { name: record.name }, metrics: { member_count: 1 }, media: { artwork: null },
      members: [{ track, position: 0, subject: track.record }],
    } }));
    let holdRead = false, holdWrite = false, release, entered;
    const writes = [];
    await page.exposeFunction('__collectionPds', async (url, init) => {
      if (url.includes('listRecords')) return { status: 200, body: { records: [] } };
      if (url.includes('getRecord')) {
        if (holdRead) await new Promise(resolve => { release = resolve; entered(); });
        return { status: 200, body: { uri, cid: 'before', value: record } };
      }
      assert.ok(url.includes('putRecord') || url.includes('deleteRecord'), `unexpected PDS write ${url}`);
      const input = JSON.parse(init.body);
      writes.push(input);
      if (holdWrite) await new Promise(resolve => { release = resolve; entered(); });
      return { status: 200, body: { uri, cid: 'after' } };
    });
    const signIn = (owner = did) => page.evaluate(([id, owner]) => globalThis.__r(id).setAuth(owner, {
      handle: async (url, init) => {
        const result = await window.__collectionPds(String(url), init);
        return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
      },
    }, 'atproto repo:fm.plyr.list'), [authModule, owner]);
    for (const change of ['other account', 'same account']) for (const method of ['renameCollection', 'removeFromPlaylist', 'deletePlaylist', 'addToPlaylist']) {
      await signIn();
      holdRead = true;
      const waiting = new Promise(resolve => { entered = resolve; });
      const before = writes.length;
      await page.evaluate(([authId, pdsId, method, uri, selected]) => {
        const pds = globalThis.__r(pdsId).createPds(globalThis.__r(authId).getAuth());
        const args = method === 'renameCollection' ? [uri, 'new name', 'playlist'] : method === 'removeFromPlaylist' ? [uri, selected.record.uri] : method === 'addToPlaylist' ? [uri, { ...selected, record: { ...selected.record, uri: selected.record.uri + '-new' } }] : [uri];
        window.__collectionAttempt = pds[method](...args).then(() => ({ accepted: true }), error => ({ error: error.message }));
      }, [authModule, pdsModule, method, uri, track]);
      await waiting;
      await signIn(change === 'other account' ? 'did:plc:otherfixture' : did);
      holdRead = false; release();
      const result = await page.evaluate(() => window.__collectionAttempt);
      assert.equal(writes.length, before, `${method} must not write after ${change} replacement`);
      assert.match(result.error, /account changed/);
    }
    await page.goto(new URL('/playlist/fixture', page.url()).href);
    await page.getByText(record.name, { exact: true }).waitFor();
    await signIn();
    await page.getByRole('button', { name: 'Edit playlist', exact: true }).click();
    const name = page.getByRole('textbox', { name: 'Playlist name', exact: true });
    await name.fill('a draft for this session');
    await signIn();
    await page.getByRole('button', { name: 'Edit playlist', exact: true }).waitFor();
    assert.equal(await name.count(), 0, 'same-account reauthentication clears old collection draft');
    await page.getByRole('button', { name: 'Edit playlist', exact: true }).click();
    await name.fill('accepted before switching');
    holdWrite = true;
    const waiting = new Promise(resolve => { entered = resolve; });
    await page.getByRole('button', { name: 'Save name', exact: true }).click();
    await waiting;
    assert.equal(writes.at(-1).swapRecord, 'before');
    assert.deepEqual(writes.at(-1).record.future, { preserved: true });
    await signIn();
    holdWrite = false; release();
    await page.getByRole('button', { name: 'Edit playlist', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Edit playlist', exact: true }).click();
    assert.equal(await name.inputValue(), record.name);
    assert.equal(await page.getByText('saved to your PDS. the catalog is catching up.', { exact: true }).count(), 0);
    await screenshot(page, `collection-session-${width}-${theme}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`${width}/${theme}: held collection reads cannot write after account/RPC replacement; fresh editor and accepted old write isolation passed`);
  } catch (error) {
    console.error(await page.locator('body').innerText());
    await screenshot(page, `collection-failure-${width}-${theme}`);
    throw error;
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}
withPlayerHarness(async browser => {
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) await run(browser, width, theme);
}).catch(error => { console.error(error); process.exitCode = 1; });
