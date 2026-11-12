const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');

const dist = process.env.PLAYER_DIST || path.resolve(__dirname, '../dist');
const did = 'did:plc:fixture';
const pageOf = data => ({ object: 'list', data, has_more: false });
const playlist = index => ({ object: 'playlist', id: `pl_${index}`, owner: { did, profile: track.artist.profile },
  record: { uri: `at://${did}/fm.plyr.list/${index}`, cid: `cid${index}` }, metadata: { name: `late night listening ${index}` },
  metrics: { member_count: 12 }, media: { artwork: null } });

async function run(browser, width, theme) {
  const { page, context, errors } = await setup(browser, width, theme, track, Number(process.env.LIBRARY_SCALE || 1));
  try {
    let authModule;
    for (const url of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))) {
      const source = await fs.readFile(path.join(dist, new URL(url).pathname), 'utf8');
      for (const module of source.split('__d(')) {
        if (module.includes('.setAuth=') || module.includes('"setAuth"')) authModule = Number(module.match(/\},(\d+),\[/)?.[1]);
      }
    }
    assert.ok(authModule, 'find existing auth-state boundary');
    let empty = false;
    await page.route('https://api.next.plyr.fm/v1/playlists?**', route => route.fulfill({ json: pageOf(empty ? [] : Array.from({ length: 12 }, (_, i) => playlist(i))) }));
    await page.route('https://api.next.plyr.fm/**/likes?**', route => route.fulfill({ json: pageOf(empty ? [] : [track]) }));
    const createdId = 'pls_' + Buffer.from(`at://${did}/fm.plyr.list/created`).toString('base64url');
    await page.route('https://api.next.plyr.fm/v1/playlists/' + createdId, route => route.fulfill({ json: { ...playlist('created'), id: createdId, metadata: { name: 'created playlist' }, members: [] } }));
    let status = 'pending';
    await page.route('https://api.next.plyr.fm/v1/records/await?**', route => route.fulfill({ json: { status } }));
    await page.route('https://plc.directory/**', route => route.fulfill({ json: { id: did, alsoKnownAs: ['at://fixture.test'], service: [] } }));
    let reject = true;
    let held;
    let hold = false;
    const writes = [];
    await page.exposeFunction('__libraryPds', async (url, init) => {
      if (url.includes('listRecords')) return { status: 200, body: { records: [] } };
      assert.ok(url.includes('com.atproto.repo.createRecord'), `Unexpected PDS operation: ${url}`);
      const input = JSON.parse(init.body);
      assert.equal(input.repo, did);
      assert.equal(input.collection, 'fm.plyr.list');
      writes.push(input);
      if (reject) return { status: 503, body: { error: 'Unavailable', message: 'fixture PDS unavailable' } };
      if (hold) await new Promise(resolve => { held = resolve; });
      return { status: 200, body: { uri: `at://${did}/fm.plyr.list/created`, cid: 'createdcid' } };
    });
    const signIn = account => page.evaluate(([id, owner]) => globalThis.__r(id).setAuth(owner, {
      handle: async (url, init) => {
        const result = await window.__libraryPds(String(url), init);
        return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
      },
    }, 'atproto repo:fm.plyr.list'), [authModule, account]);
    await page.goto(new URL('/library', page.url()).href);
    await page.getByText('sign in to see your liked tracks and playlists.', { exact: true }).waitFor();
    await signIn(did);
    const create = page.getByRole('button', { name: /^new playlist$/i });
    await page.getByRole('link', { name: /late night listening 11/ }).waitFor();
    const bounds = await create.boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height < 250, 'Creation is visible before the long library');
    assert.ok(bounds.height >= 44);
    await screenshot(page, `library-${width}-${theme}`);
    await create.click();
    const name = page.getByRole('textbox', { name: 'Playlist name', exact: true });
    const submit = page.getByRole('button', { name: /^create playlist$/i });
    await name.waitFor();
    assert.equal(await submit.isDisabled(), true, 'Blank name cannot submit');
    await name.fill('  a collection for the long way home  ');
    await submit.click();
    const error = page.getByRole('alert').filter({ hasText: 'fixture PDS unavailable' });
    await error.waitFor();
    assert.equal(await name.inputValue(), '  a collection for the long way home  ');
    const fieldBounds = await name.boundingBox(), errorBounds = await error.boundingBox();
    assert.ok(errorBounds.y >= fieldBounds.y && errorBounds.y < 900, 'Failure is visible inside the sheet');
    await screenshot(page, `create-error-${width}-${theme}`);
    reject = false; hold = true;
    await submit.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Playlist name"]')?.readOnly);
    assert.equal(await submit.isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: /^cancel$/i }).isDisabled(), true);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await name.isVisible(), true, 'Busy sheet cannot be dismissed');
    assert.equal(writes.length, 2);
    assert.equal(writes[1].record.name, 'a collection for the long way home');
    held(); hold = false;
    await page.getByText('saved to your PDS. the catalog is catching up.', { exact: true }).waitFor();
    const saved = page.getByRole('link', { name: 'open created playlist', exact: true });
    await saved.waitFor();
    assert.match(await saved.getAttribute('href'), /\/playlist\/pls_/);
    assert.equal(await name.count(), 0, 'Accepted create closes the submission form');
    assert.equal(writes.length, 2, 'Indexing delay does not repeat creation');
    await screenshot(page, `create-pending-${width}-${theme}`);
    await create.click();
    await name.fill('another playlist');
    hold = true;
    await submit.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Playlist name"]')?.readOnly);
    const before = page.url();
    empty = true;
    await signIn('did:plc:otherfixture');
    status = 'indexed'; held(); hold = false;
    await page.getByText('no playlists yet. make one for your next listen.', { exact: true }).waitFor();
    assert.equal(page.url(), before, 'Old-account completion cannot navigate the new account');
    assert.equal(await saved.count(), 0, 'Old account creation state is absent');
    assert.equal(await name.count(), 0);
    await screenshot(page, `library-empty-${width}-${theme}`);
    await signIn(did);
    await create.click();
    await name.fill('indexed playlist');
    await submit.click();
    await page.waitForURL('**/playlist/' + createdId);
    await page.getByRole('button', { name: /^edit playlist$/i }).waitFor();
    assert.equal(writes.length, 4);
    assert.equal(writes[3].record.name, 'indexed playlist');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`${width}/${theme}: visible creation, modal failure/retry, locked submission, pending recovery and account-switch isolation passed`);
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}

withPlayerHarness(async browser => {
  console.log('Auth-state injection and in-memory PDS; OAuth is not exercised');
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) await run(browser, width, theme);
}).catch(error => { console.error(error); process.exitCode = 1; });
