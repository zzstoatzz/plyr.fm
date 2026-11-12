const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');
const did = 'did:plc:fixture';
const uri = `at://${did}/fm.plyr.list/order-fixture`;
const second = { ...track, id: 'trk_' + Buffer.from(track.record.uri + '-second').toString('base64url'), record: { ...track.record, uri: track.record.uri + '-second' }, metadata: { ...track.metadata, title: 'another recording with a deliberately long title to check enlarged text' } };
const initial = { $type: 'fm.plyr.list', listType: 'playlist', name: 'an afternoon, in order', createdAt: '2026-11-12T00:00:00Z', future: { preserved: ['yes'] }, items: [
  { subject: { uri: track.record.uri, cid: track.record.cid, future: true }, occurrence: 'first' },
  { subject: { uri: 'at://did:plc:missing/fm.plyr.track/gone', cid: 'missing' }, occurrence: 'unavailable' },
  { subject: { uri: track.record.uri, cid: track.record.cid }, occurrence: 'duplicate' },
  { subject: { uri: second.record.uri, cid: second.record.cid }, occurrence: 'second' },
] };
async function run(browser, width, theme, scale) {
  const { page, context, errors } = await setup(browser, width, theme, track, scale);
  try {
    let authModule, pdsModule;
    for (const url of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))) {
      const source = await fs.readFile(path.join(process.env.PLAYER_DIST || path.resolve(__dirname, '../dist'), new URL(url).pathname), 'utf8');
      for (const module of source.split('__d(')) {
        const id = Number(module.match(/\},(\d+),\[/)?.[1]);
        if (module.includes('.setAuth=') || module.includes('"setAuth"')) authModule = id;
        if (module.includes('.createPds=') || module.includes('"createPds"')) pdsModule = id;
      }
    }
    assert.ok(authModule && pdsModule);
    await page.route('https://api.next.plyr.fm/v1/records/await?**', route => route.fulfill({ json: { status: 'pending' } }));
    let projection = structuredClone(initial), projectedCid = 'old-appview';
    await page.route('https://api.next.plyr.fm/v1/playlists/*', route => route.fulfill({ json: {
      object: 'playlist', id: 'fixture', owner: { did, profile: track.artist.profile }, record: { uri, cid: projectedCid },
      metadata: { name: initial.name }, metrics: { member_count: 4 }, media: { artwork: null },
      members: projection.items.map((item, position) => ({ ...item, position, track: item.subject.uri === track.record.uri ? track : item.subject.uri === second.record.uri ? second : null })),
    } }));
    const other = { object: 'playlist', id: 'other', owner: { did, profile: track.artist.profile }, record: { uri: uri + '-other', cid: 'other-cid' }, metadata: { name: 'a different playlist' }, metrics: { member_count: 1 }, media: { artwork: null }, members: [{ position: 0, subject: second.record, track: second }] };
    await page.route('https://api.next.plyr.fm/v1/playlists/other', route => route.fulfill({ json: other }));
    await page.route(url => url.origin === 'https://api.next.plyr.fm' && url.pathname === '/v1/playlists', route => route.fulfill({ json: { object: 'list', data: [{ ...other, id: 'fixture', record: { uri, cid: 'old-appview' }, metadata: { name: initial.name } }, other], has_more: false } }));
    let record = structuredClone(initial), cid = 'revision-1', serial = 1;
    let loseResponse = false, failRead = false, rejectWrite = false, holdRead = false, holdWrite = false, entered, release;
    const writes = [];
    await page.exposeFunction('__orderPds', async (url, init) => {
      if (url.includes('listRecords')) return { status: 200, body: { records: [] } };
      if (url.includes('getRecord')) {
        if (holdRead) await new Promise(resolve => { release = resolve; entered(); });
        if (failRead) return { status: 503, body: { error: 'Unavailable' } };
        return { status: 200, body: { uri, cid, value: record } };
      }
      assert.ok(url.includes('putRecord'), `unexpected mutation: ${url}`);
      const input = JSON.parse(init.body); writes.push(input);
      if (holdWrite) await new Promise(resolve => { release = resolve; entered(); });
      if (input.swapRecord !== cid) return { status: 400, body: { error: 'InvalidSwap', message: 'stale CID' } };
      if (rejectWrite) return { status: 503, body: { error: 'Unavailable' } };
      record = input.record; cid = `revision-${++serial}`;
      if (loseResponse) { loseResponse = false; return { lost: true }; }
      return { status: 200, body: { uri, cid } };
    });
    const signIn = (owner = did) => page.evaluate(([id, owner]) => globalThis.__r(id).setAuth(owner, {
      handle: async (url, init) => {
        const result = await window.__orderPds(String(url), init);
        if (result.lost) throw new TypeError('connection lost after accepted write');
        return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
      },
    }, 'atproto repo:fm.plyr.list'), [authModule, owner]);
    await page.goto(new URL('/playlist/fixture', page.url()).href);
    await page.getByRole('heading', { name: initial.name, exact: true }).waitFor();
    await page.route('https://api.next.plyr.fm/v1/tracks/' + second.id + '/playback', route => route.fulfill({ json: { object: 'playback', track_id: second.id, record: second.record, availability: { status: 'available', delivery: { url: 'https://player-fixture.invalid/audio.wav', media_type: 'audio/wav' } } } }));
    assert.equal(await page.getByRole('button', { name: 'Edit playlist', exact: true }).count(), 0);
    await signIn();
    const button = name => page.getByRole('button', { name, exact: true });
    const open = async () => {
      await button('Edit playlist').click(); await button('Reorder tracks').click();
      await button('Move track 4 up').waitFor();
    };
    await open();
    await button('Move track 4 up').click();
    await button('Move track 3 up').focus(); await page.keyboard.press('Enter');
    assert.deepEqual(await page.locator('[data-testid^="playlist-occurrence-"]').evaluateAll(nodes => nodes.map(n => n.dataset.testid)), ['playlist-occurrence-0', 'playlist-occurrence-3', 'playlist-occurrence-1', 'playlist-occurrence-2']);
    for (const target of await page.getByRole('button', { name: /^Move track/ }).all()) {
      const rect = await target.boundingBox(); assert.ok(rect.width >= 44 && rect.height >= 44);
    }
    await screenshot(page, `order-draft-${width}-${theme}-${scale}`);
    loseResponse = true;
    await button('Save order').click();
    await page.getByText('order saved to your PDS. the catalog is catching up.', { exact: true }).waitFor();
    assert.equal(writes.length, 1, 'lost accepted response reconciles without resubmission');
    assert.equal(writes[0].swapRecord, 'revision-1');
    assert.deepEqual(record.items, [initial.items[0], initial.items[3], initial.items[1], initial.items[2]]);
    assert.deepEqual(record.future, initial.future);
    await button('Done reordering').click();
    await button('Done editing').click();
    const titles = await page.getByRole('link').filter({ hasText: second.metadata.title }).count();
    assert.equal(titles, 1);
    assert.deepEqual(await page.locator('a[href^="/track/"]:visible').evaluateAll(nodes => nodes.map(node => node.getAttribute('href'))), [track.id, second.id, track.id].map(id => '/track/' + id));
    await button('Play playlist').click();
    await page.waitForFunction(() => window.__playerPresentationMedia?.currentTime > 0);
    await button('Open now playing').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Queue', exact: true }).click();
    await page.waitForURL('**/queue');
    await button('Play ' + second.metadata.title + ' by jack').waitFor();
    assert.deepEqual(await page.getByRole('button', { name: /^Play .* by jack$/ }).evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), [second, track].map(item => 'Play ' + item.metadata.title + ' by jack'));
    await page.goBack();
    await button('Edit playlist').waitFor();
    const displayedOrder = () => page.locator('a[href^="/track/"]:visible').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
    const visitTrackAndReturn = async () => {
      await page.locator('a[href^="/track/"]:visible').first().click();
      await page.getByRole('button', { name: 'Add to queue', exact: true }).waitFor();
      await page.goBack(); await button('Edit playlist').waitFor();
    };
    projectedCid = 'intermediate-before-save';
    const intermediateRead = page.waitForResponse(response => new URL(response.url()).pathname === '/v1/playlists/fixture');
    await visitTrackAndReturn(); await intermediateRead;
    assert.deepEqual(await displayedOrder(), [track.id, second.id, track.id].map(id => '/track/' + id), 'intermediate projection cannot replace accepted order');
    record = { ...record, items: [initial.items[3], initial.items[0], initial.items[1], initial.items[2]], laterEdit: true };
    cid = 'later-skipped-revision'; projection = structuredClone(record); projectedCid = cid;
    await visitTrackAndReturn();
    await page.waitForFunction(expected => document.querySelector('a[href^="/track/"]')?.getAttribute('href') === expected, '/track/' + second.id);
    assert.deepEqual(await displayedOrder(), [second.id, track.id, track.id].map(id => '/track/' + id), 'current PDS projection supersedes overlay even when saved CID was skipped');
    await open();
    assert.match(await page.getByTestId('playlist-occurrence-0').innerText(), /another recording/);
    await button('Move track 2 up').click();
    record = { ...record, anotherClient: true }; cid = `revision-${++serial}`;
    await button('Save order').click();
    await button('Reload latest order').waitFor();
    assert.equal(await button('Save order').isDisabled(), true);
    assert.equal(record.anotherClient, true);
    await screenshot(page, `order-conflict-${width}-${theme}-${scale}`);
    await button('Reload latest order').click();
    await button('Reload latest order').waitFor({ state: 'hidden' });
    await button('Move track 2 up').click();
    rejectWrite = true; failRead = true;
    await button('Save order').click();
    await page.getByText('could not confirm the saved order. check your PDS before making more changes.', { exact: true }).waitFor();
    assert.equal(await button('Save order').isDisabled(), true);
    rejectWrite = false; failRead = false;
    await button('Reload latest order').click();
    await button('Reload latest order').waitFor({ state: 'hidden' });
    await button('Move track 2 up').click();
    await button('Save order').click();
    await page.getByText('order saved to your PDS. the catalog is catching up.', { exact: true }).waitFor();
    assert.equal(record.anotherClient, true);
    await button('Done reordering').click(); await button('Done editing').click();
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await page.getByRole('link', { name: /a different playlist/ }).click();
    await page.getByRole('heading', { name: 'a different playlist', exact: true }).waitFor();
    assert.deepEqual(await displayedOrder(), ['/track/' + second.id], 'another playlist must not inherit the saved overlay');
    await button('Play playlist').click();
    await button('Open now playing').click();
    await page.getByRole('dialog').getByRole('heading', { name: second.metadata.title, exact: true }).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await page.getByRole('link', { name: new RegExp(initial.name) }).click();
    await page.getByRole('heading', { name: initial.name, exact: true }).waitFor();
    await open(); await button('Move track 4 up').click();
    holdWrite = true;
    const retainedWrite = new Promise(resolve => { entered = resolve; });
    await button('Save order').click(); await retainedWrite;
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('heading', { name: 'settings', exact: true }).waitFor();
    const settledWhileAway = page.waitForResponse(response => new URL(response.url()).pathname === '/v1/records/await');
    holdWrite = false; release(); await (await settledWhileAway).finished();
    await page.goBack();
    await button('Done reordering').click(); await button('Done editing').click();
    assert.deepEqual(await displayedOrder(), [track.id, second.id, track.id].map(id => '/track/' + id), 'retained save must preserve accepted overlay after returning');
    await button('Play playlist').click(); await button('Open now playing').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Queue', exact: true }).click();
    await button('Play ' + second.metadata.title + ' by jack').waitFor();
    assert.deepEqual(await page.getByRole('button', { name: /^Play .* by jack$/ }).evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), [second, track].map(item => 'Play ' + item.metadata.title + ' by jack'), 'retained save drives Play playlist despite stale projection');
    await page.goBack(); await button('Edit playlist').waitFor();
    for (const owner of ['did:plc:otherfixture', did]) {
      await signIn();
      holdRead = true;
      const waiting = new Promise(resolve => { entered = resolve; });
      await button('Edit playlist').click(); await button('Reorder tracks').click(); await waiting;
      const before = writes.length;
      await signIn(owner); holdRead = false; release();
      if (owner === did) await button('Edit playlist').waitFor();
      else await button('Edit playlist').waitFor({ state: 'hidden' });
      assert.equal(writes.length, before);
      assert.equal(await button('Save order').count(), 0);
    }
    await signIn(); await open();
    await button('Move track 2 up').click();
    holdWrite = true;
    const waiting = new Promise(resolve => { entered = resolve; });
    await button('Save order').click(); await waiting;
    await signIn(); holdWrite = false; release();
    await button('Edit playlist').waitFor();
    assert.equal(await page.getByText('order saved to your PDS. the catalog is catching up.', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`${width}/${theme}/${scale}: canonical occurrence order, CAS conflict, unknown fields, lost acknowledgement and account/RPC isolation passed`);
  } catch (error) {
    await screenshot(page, `order-failure-${width}-${theme}-${scale}`);
    console.error(await page.locator('body').innerText()); throw error;
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}
withPlayerHarness(async browser => {
  for (const scale of [1, 1.4]) for (const width of [390, 1280]) for (const theme of ['light', 'dark']) await run(browser, width, theme, scale);
}).catch(error => { console.error(error); process.exitCode = 1; });
