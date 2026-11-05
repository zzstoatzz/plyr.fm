const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const frontend = createRequire(path.resolve(__dirname, '../../../frontend/package.json'));
const { chromium } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : frontend('playwright');
const { fixtureAccounts, fixturePage, authorizeFixture } = require('./pds-browser-fixture.cjs');
const id = 'trk_YXQ6Ly9kaWQ6cGxjOjZwbWJzbndlcm1haHYzcnBqaWxrcmd4by9mbS5wbHlyLnRyYWNrLzNtemNycWdoNDJxMjI';
const origin = 'https://next.plyr.fm';
const output = process.env.TRACK_ACTION_OUTPUT || `/tmp/plyr-track-actions-${Date.now()}`;

(async () => {
  await fs.mkdir(output, { recursive: true });
  const response = await fetch('https://api.next.plyr.fm/v1/tracks/' + id);
  assert.equal(response.ok, true);
  const track = await response.json();
  track.metrics.like_count = 7;
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-features=LocalNetworkAccessChecks'] });
  try {
    for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
      const name = `h${width}${theme[0]}${Date.now().toString(36).slice(-5)}`;
      const accounts = await fixtureAccounts([name]);
      const handle = name + '.test';
      let loseNextCreate = false;
      let lost = 0;
      let staleLikers = false;
      let duplicateLiker = false;
      const { page, context } = await fixturePage(browser, accounts, {
        dist: process.env.TRACK_ACTION_DIST,
        context: { viewport: { width, height: 900 }, colorScheme: theme }, preferences: { theme },
        discardPdsResponse: pathname => {
          if (loseNextCreate && pathname === '/xrpc/com.atproto.repo.createRecord') { loseNextCreate = false; lost++; return true; }
          return false;
        }
      });
      const errors = [];
      const catalogRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('https://api.next.plyr.fm/**', async route => {
        const request = route.request();
        if (request.method() !== 'GET') return route.abort();
        const url = new URL(request.url());
        catalogRequests.push(url.pathname);
        if (url.pathname === '/v1/tracks/' + id) return route.fulfill({ json: track });
        if (url.pathname.endsWith('/likes')) return route.fulfill({ json: { object: 'list', data: duplicateLiker ? [0, 1].map(index => ({ record: { uri: 'at://did:web:another.test/fm.plyr.like/' + index }, actor: { did: 'did:web:another.test', profile: { handle: 'another.test' } } })) : staleLikers ? [{ record: { uri: 'at://' + accounts[handle].did + '/fm.plyr.like/stale' }, actor: { did: accounts[handle].did, profile: { handle } } }] : [], has_more: false } });
        if (url.pathname === '/v1/playlists') return route.fulfill({ json: { object: 'list', data: [], has_more: false } });
        return route.fulfill({ json: { object: 'list', data: [], has_more: false } });
      });
      try {
        await page.goto(origin + '/track/' + id);
        await page.getByRole('link', { name: 'sign in to like', exact: true }).click();
        await page.waitForURL(url => url.pathname === '/login');
        assert.equal(new URL(page.url()).searchParams.get('return_to'), '/track/' + id);
        await authorizeFixture(page, accounts, handle);
        await page.waitForURL('**/track/' + id);
        const like = page.getByRole('button', { name: 'Like', exact: true });
        await like.waitFor();
        await like.click();
        await page.getByRole('button', { name: 'Unlike', exact: true }).waitFor();
        await page.waitForFunction(() => { const button = document.querySelector('[aria-label="Unlike"]'); return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true'; });
        await page.getByRole('button', { name: 'See 8 likes', exact: true }).waitFor();
        await page.screenshot({ path: path.join(output, `${width}-${theme}-liked.png`) });
        await page.getByRole('button', { name: 'See 8 likes', exact: true }).click();
        await page.getByText('Liked by', { exact: true }).waitFor();
        await page.getByRole('dialog').getByRole('link', { name: new RegExp(handle.replaceAll('.', '\\.')) }).waitFor();
        assert.equal(await page.getByText('No likes yet.', { exact: true }).count(), 0, 'Own like appears before indexing');
        await page.screenshot({ path: path.join(output, `${width}-${theme}-likers.png`) });
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        await page.getByRole('button', { name: 'Unlike', exact: true }).click();
        await page.getByRole('button', { name: 'See 7 likes', exact: true }).waitFor();
        staleLikers = true;
        await page.getByRole('button', { name: 'See 7 likes', exact: true }).click();
        await page.getByText('No likes yet.', { exact: true }).waitFor();
        assert.equal(await page.getByRole('dialog').getByRole('link').count(), 0, 'Removed own like is hidden even while indexed');
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        staleLikers = false;
        duplicateLiker = true;
        await page.getByRole('button', { name: 'See 7 likes', exact: true }).click();
        await page.getByRole('dialog').getByRole('link', { name: /another.test/ }).first().waitFor();
        assert.equal(await page.getByRole('dialog').getByRole('link', { name: /another.test/ }).count(), 1, 'One person appears once even with duplicate PDS likes');
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        duplicateLiker = false;
        loseNextCreate = true;
        await page.getByRole('button', { name: 'Like', exact: true }).click();
        await page.getByText('Couldn’t update like', { exact: true }).waitFor();
        assert.equal(lost, 1, 'Lost response follows a real committed PDS create');
        await page.getByRole('button', { name: 'close', exact: true }).click();
        await page.getByRole('button', { name: 'See 7 likes', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Like', exact: true }).click();
        await page.getByRole('button', { name: 'Unlike', exact: true }).waitFor();
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await page.getByText('track options', { exact: true }).waitFor();
        await page.getByRole('dialog').waitFor();
        await page.waitForTimeout(350);
        assert.equal(await page.getByRole('button', { name: 'Like', exact: true }).count(), 0, 'Like is no longer a menu action');
        await page.screenshot({ path: path.join(output, `${width}-${theme}-menu.png`) });
        const playlist = page.getByRole('button', { name: 'add to playlist', exact: true });
        const box = await playlist.boundingBox();
        assert.ok(box.width >= 300 && box.height >= 48, 'Menu actions are full-width rows');
        await playlist.click();
        await page.getByText('Create a playlist from your library first.', { exact: true }).waitFor();
        assert.equal(await page.getByRole('dialog').count(), 1, 'Playlist picker reuses a single sheet');
        await page.screenshot({ path: path.join(output, `${width}-${theme}-playlists.png`) });
        await page.getByRole('button', { name: 'back', exact: true }).click();
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        if (width === 390 && theme === 'dark') {
          track.metrics.like_count = 0;
          await page.reload();
          await page.getByRole('button', { name: 'Unlike', exact: true }).waitFor();
          await page.getByRole('button', { name: 'See 0 likes', exact: true }).waitFor();
          const rejectDelete = route => route.abort();
          await page.route('https://pds.fixture.test/xrpc/com.atproto.repo.deleteRecord', rejectDelete);
          await page.getByRole('button', { name: 'Unlike', exact: true }).click();
          await page.getByText('Couldn’t update like', { exact: true }).waitFor();
          await page.getByRole('button', { name: 'close', exact: true }).click();
          await page.getByRole('button', { name: 'See 0 likes', exact: true }).waitFor();
          await page.getByRole('button', { name: 'Unlike', exact: true }).waitFor();
          await page.unroute('https://pds.fixture.test/xrpc/com.atproto.repo.deleteRecord', rejectDelete);
        }
        assert.equal(catalogRequests.some(url => url.includes('/records/await')), false, 'Heart writes do not block on appview polling');
        const sessionResponse = await fetch('http://localhost:5197/xrpc/com.atproto.server.createSession', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: handle, password: accounts[handle].pass }) });
        const session = await sessionResponse.json();
        const recordsResponse = await fetch('http://localhost:5197/xrpc/com.atproto.repo.listRecords?' + new URLSearchParams({ repo: accounts[handle].did, collection: 'fm.plyr.like', limit: '100' }), { headers: { authorization: 'Bearer ' + session.accessJwt } });
        const records = await recordsResponse.json();
        assert.equal(records.records.filter(record => record.value.subject.uri === track.record.uri).length, 1, 'Retry did not create a duplicate canonical like');
        assert.deepEqual(errors, []);
        console.log(`${width}/${theme}: direct PDS heart/unlike, count drawer, lost-response retry, single-sheet action rows passed`);
      } finally { track.metrics.like_count = 7; await context.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
