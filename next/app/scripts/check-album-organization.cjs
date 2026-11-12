const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');
const did = track.artist.did;
const second = { ...track, id: 'trk_' + Buffer.from(track.record.uri + '-second').toString('base64url'), record: { ...track.record, uri: track.record.uri + '-second' }, metadata: { ...track.metadata, title: 'a second recording with a long title for narrow album layouts' } };
const third = { ...track, id: 'trk_' + Buffer.from(track.record.uri + '-third').toString('base64url'), record: { ...track.record, uri: track.record.uri + '-third' }, metadata: { ...track.metadata, title: 'new recording added to the album' } };
const tracks = [track, second, third];
const uri = `at://${did}/fm.plyr.list/album-fixture`;
const initial = { $type: 'fm.plyr.list', listType: 'album', name: 'a room full of recordings', createdAt: '2026-11-12T00:00:00Z', future: { preserved: true }, items: [
  { subject: { uri: track.record.uri, cid: track.record.cid, future: true }, occurrence: 'first' },
  { subject: { uri: 'at://did:plc:missing/fm.plyr.track/gone', cid: 'missing' }, occurrence: 'unavailable' },
  { subject: { uri: track.record.uri, cid: track.record.cid }, occurrence: 'duplicate' },
  { subject: { uri: second.record.uri, cid: second.record.cid }, occurrence: 'second' },
] };
async function run(browser, width, theme, scale) {
  const { page, context, errors } = await setup(browser, width, theme, track, scale);
  try {
    let authModule;
    for (const url of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))) {
      const source = await fs.readFile(path.join(process.env.PLAYER_DIST || path.resolve(__dirname, '../dist'), new URL(url).pathname), 'utf8');
      for (const module of source.split('__d(')) if (module.includes('.setAuth=') || module.includes('"setAuth"')) authModule = Number(module.match(/\},(\d+),\[/)?.[1]);
    }
    assert.ok(authModule);
    const button = name => page.getByRole('button', { name, exact: true });
    const records = new Map([[uri, { cid: 'album-1', value: structuredClone(initial) }]]);
    let changedTrack = false;
    let serial = 1, loseResponse = false, failRead = false, rejectWrite = false, holdWrite = false, entered, release;
    const writes = [];
    await page.exposeFunction('__albumPds', async (url, init) => {
      const parsed = new URL(url, 'https://fixture.invalid');
      if (url.includes('listRecords')) return { status: 200, body: { records: [] } };
      if (url.includes('getRecord')) {
        if (failRead) return { status: 503, body: { error: 'Unavailable' } };
        const requested = `at://${parsed.searchParams.get('repo')}/${parsed.searchParams.get('collection')}/${parsed.searchParams.get('rkey')}`;
        const selected = tracks.find(item => item.record.uri === requested);
        if (selected) return { status: 200, body: { uri: requested, cid: changedTrack ? 'changed-track' : selected.record.cid, value: { $type: 'fm.plyr.track', title: selected.metadata.title } } };
        const found = records.get(requested);
        return found ? { status: 200, body: { uri: requested, ...found } } : { status: 400, body: { error: 'RecordNotFound' } };
      }
      assert.ok(url.includes('createRecord') || url.includes('putRecord'), `unexpected write ${url}`);
      const input = JSON.parse(init.body); writes.push(input);
      if (holdWrite) await new Promise(resolve => { entered(); release = resolve; });
      const key = `at://${input.repo}/${input.collection}/${input.rkey}`;
      if (url.includes('putRecord') && input.swapRecord !== records.get(key)?.cid) return { status: 400, body: { error: 'InvalidSwap', message: 'stale CID' } };
      if (rejectWrite) return { status: 503, body: { error: 'Unavailable' } };
      assert.equal(input.collection, 'fm.plyr.list', 'album operations never rewrite track metadata');
      assert.equal(input.record.listType, 'album');
      records.set(key, { cid: `album-${++serial}`, value: input.record });
      if (loseResponse) { loseResponse = false; return { lost: true }; }
      return { status: 200, body: { uri: key, cid: records.get(key).cid } };
    });
    const signIn = (owner = did) => page.evaluate(([id, owner]) => globalThis.__r(id).setAuth(owner, { handle: async (url, init) => {
      const result = await window.__albumPds(String(url), init);
      if (result.lost) throw new TypeError('lost accepted write');
      return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
    } }, 'atproto repo:fm.plyr.list repo:fm.plyr.track'), [authModule, owner]);
    await page.route('https://api.next.plyr.fm/v1/records/await?**', route => route.fulfill({ json: { status: 'pending' } }));
    await page.route(url => url.pathname === '/v1/tracks', route => { const more = new URL(route.request().url()).searchParams.has('cursor'); return route.fulfill({ json: { object: 'list', data: more ? [third] : [track, second], has_more: !more, next_cursor: more ? null : 'next' } }); });
    await page.route('https://api.next.plyr.fm/v1/tracks/resolve', route => {
      const ids = route.request().postDataJSON().ids; assert.ok(ids.length <= 100);
      return route.fulfill({ json: { object: 'list', data: tracks.filter(track => ids.includes(track.id)), missing: ids.filter(id => !tracks.some(track => track.id === id)) } });
    });
    await page.route(url => url.pathname === '/v1/albums', route => route.fulfill({ json: { object: 'list', has_more: false, data: [...records].map(([key, record]) => ({ object: 'album', id: key === uri ? 'fixture' : 'alb_' + Buffer.from(key).toString('base64url'), owner: { did, profile: track.artist.profile }, record: { uri: key, cid: record.cid }, metadata: { name: record.value.name }, metrics: { member_count: record.value.items.length }, media: { artwork: null } })) } }));
    await page.route('https://api.next.plyr.fm/v1/albums/*', route => route.fulfill({ json: {
      object: 'album', id: 'fixture', owner: { did, profile: track.artist.profile }, record: { uri, cid: 'old-appview' },
      metadata: { name: initial.name }, metrics: { member_count: 4 }, media: { artwork: null },
      members: initial.items.map((item, position) => ({ ...item, position, track: tracks.find(track => track.record.uri === item.subject.uri) ?? null })),
    } }));
    await page.goto(new URL('/create-album', page.url()).href);
    await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor();
    assert.equal(await button('Create album').count(), 0);
    await page.goto(new URL('/u/fixture.test', page.url()).href);
    await page.getByRole('heading', { name: 'jack', exact: true }).waitFor();
    await signIn(); await page.getByRole('tab', { name: 'albums', exact: true }).click();
    await page.getByRole('link', { name: 'New album', exact: true }).click();
    await page.getByRole('textbox', { name: 'Album name', exact: true }).fill('collected recordings');
    await button('Add ' + track.metadata.title).click(); await button('Add ' + second.metadata.title).click();
    await button('Move track 2 up').click();
    await screenshot(page, `album-create-${width}-${theme}-${scale}`);
    changedTrack = true; await button('Create album').click();
    await page.getByText('a selected track changed. remove it, reload your tracks, and add it again.', { exact: true }).waitFor();
    assert.equal(writes.length, 0, 'changed track revision cannot publish an album');
    changedTrack = false; loseResponse = true;
    await button('Create album').click();
    await page.getByRole('link', { name: 'Open created album', exact: true }).waitFor();
    assert.equal(writes.length, 1);
    const createdUri = `at://${did}/fm.plyr.list/${writes[0].rkey}`;
    assert.deepEqual(records.get(createdUri).value.items.map(item => item.subject.uri), [second.record.uri, track.record.uri]);
    await button('Done').click();
    await page.goBack();
    await page.getByRole('link', { name: /collected recordings/ }).waitFor();
    await page.goto(new URL('/album/fixture', page.url()).href);
    await page.getByRole('heading', { name: initial.name, exact: true }).waitFor();
    await signIn(); await button('Edit album').click(); await button('Organize tracks').click();
    await button('Move track 4 up').waitFor();
    await button('Remove track 1').click();
    await button('More tracks').click();
    await button('Add ' + third.metadata.title).click();
    await button('Move track 4 up').click(); await button('Move track 3 up').click();
    await screenshot(page, `album-organize-${width}-${theme}-${scale}`);
    loseResponse = true;
    await button('Save album tracks').click();
    await page.getByText('album saved to your PDS. the catalog is catching up.', { exact: true }).waitFor();
    const saved = records.get(uri).value;
    assert.deepEqual(saved.items, [initial.items[1], { subject: { uri: third.record.uri, cid: third.record.cid } }, initial.items[2], initial.items[3]]);
    assert.deepEqual(saved.future, initial.future);
    assert.equal(writes.length, 2);
    await button('Move track 2 up').click();
    assert.equal(await page.getByText('album saved to your PDS. the catalog is catching up.', { exact: true }).count(), 0, 'new draft does not keep a prior success message');
    await button('Move track 1 down').click();
    await button('Done organizing').click(); await button('Done editing').click();
    assert.deepEqual(await page.locator('a[href^="/track/"]:visible').evaluateAll(nodes => nodes.map(node => node.getAttribute('href'))), [third, track, second].map(item => '/track/' + item.id));
    await button('Play album').click();
    await page.waitForFunction(() => window.__playerPresentationMedia?.currentTime > 0);
    await button('Open now playing').click();
    await page.getByRole('dialog').getByRole('heading', { name: third.metadata.title, exact: true }).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await button('Edit album').click(); await button('Organize tracks').click();
    await button('Move track 2 up').click();
    records.set(uri, { cid: 'concurrent', value: { ...saved, anotherClient: true } });
    await button('Save album tracks').click();
    await button('Reload latest album').waitFor();
    assert.equal(await button('Save album tracks').isDisabled(), true);
    assert.equal(records.get(uri).value.anotherClient, true);
    const conflictBox = await page.getByText('this collection changed elsewhere. reload the latest order before saving.', { exact: true }).boundingBox();
    assert.ok(conflictBox && conflictBox.y >= 0 && conflictBox.y + conflictBox.height <= 900, 'save conflict remains visible beside the controls');
    await screenshot(page, `album-conflict-${width}-${theme}-${scale}`);
    await button('Reload latest album').click(); await page.waitForFunction(() => document.querySelector('[aria-label="Move track 2 up"]')?.getAttribute('aria-disabled') !== 'true' && !!document.querySelector('[aria-label="Move track 2 up"]'));
    await button('Move track 2 up').click();
    failRead = true; rejectWrite = true;
    await button('Save album tracks').click(); await button('Reload latest album').waitFor();
    assert.equal(await button('Save album tracks').isDisabled(), true);
    failRead = false; rejectWrite = false;
    await signIn('did:plc:someoneelse');
    await button('Edit album').waitFor({ state: 'hidden' });
    assert.equal(await button('Save album tracks').count(), 0);
    await signIn(); await button('Edit album').click(); await button('Organize tracks').click();
    await button('Move track 2 up').click();
    holdWrite = true;
    const waiting = new Promise(resolve => { entered = resolve; });
    await button('Save album tracks').click(); await waiting;
    await page.getByRole('link', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('heading', { name: 'settings', exact: true }).waitFor();
    holdWrite = false; release();
    await page.goBack();
    await page.getByText('album saved to your PDS. the catalog is catching up.', { exact: true }).waitFor();
    await button('Done organizing').click(); await button('Done editing').click();
    await button('Play album').click(); await button('Open now playing').click();
    await page.getByRole('dialog').getByRole('heading', { name: third.metadata.title, exact: true }).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await button('Edit album').click(); await button('Organize tracks').click();
    await button('Move track 2 up').click();
    holdWrite = true;
    const switchedWrite = new Promise(resolve => { entered = resolve; });
    await button('Save album tracks').click(); await switchedWrite;
    await signIn(); holdWrite = false; release();
    await button('Edit album').waitFor();
    assert.equal(await page.getByText('album saved to your PDS. the catalog is catching up.', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`${width}/${theme}/${scale}: album exact-key creation, lost response, occurrence membership, stale projection playback, CAS and session isolation passed`);
  } catch (error) { await screenshot(page, `album-failure-${width}-${theme}-${scale}`); console.error(await page.locator('body').innerText()); throw error; }
  finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}
withPlayerHarness(async browser => {
  for (const scale of [1, 1.4]) for (const width of [390, 1280]) for (const theme of ['light', 'dark']) await run(browser, width, theme, scale);
}).catch(error => { console.error(error); process.exitCode = 1; });
