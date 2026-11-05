const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const frontend = createRequire(path.resolve(__dirname, '../../../frontend/package.json'));
const { chromium } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : frontend('playwright');
const { fixtureAccounts, fixturePage, authorizeFixture } = require('./pds-browser-fixture.cjs');
const output = process.env.ACCOUNT_OUTPUT || `/tmp/plyr-account-pages-${Date.now()}`;
const origin = 'https://next.plyr.fm';

(async () => {
  await fs.mkdir(output, { recursive: true });
  const accounts = await fixtureAccounts(['portalcheck']);
  const handle = 'portalcheck.test';
  const did = accounts[handle].did;
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-features=LocalNetworkAccessChecks'] });
  try {
    for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
      const { page, context } = await fixturePage(browser, accounts, {
        dist: process.env.ACCOUNT_DIST, context: { viewport: { width, height: 900 }, colorScheme: theme }, preferences: { theme }
      });
      const requests = [];
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let failNext = true;
      let empty = false;
      const track = index => ({
        object: 'track', id: `trk_fixture_${index}`,
        record: { uri: `at://${did}/fm.plyr.track/${index}`, cid: `fixture${index}`, collection: 'fm.plyr.track', rkey: String(index), revision: null },
        metadata: { title: index ? `recording ${index}` : 'a long track title — live from a very quiet room', album: 'a collection', duration_seconds: 180, description: null, created_at: '2026-11-05T00:00:00Z' },
        artist: { did, profile: { handle, display_name: 'A musician with a long display name', avatar_url: null } },
        media: { artwork: null }, access: { visibility: 'public' }, metrics: { play_count: index, like_count: 0 }
      });
      await page.route('https://api.next.plyr.fm/**', async route => {
        const request = route.request();
        if (request.method() !== 'GET') return route.abort();
        const url = new URL(request.url());
        requests.push(url.pathname + url.search);
        if (decodeURIComponent(url.pathname) === `/v1/artists/${did}`) return route.fulfill({ json: {
          object: 'artist', did, handle, display_name: 'A musician with a long display name', avatar_url: null, bio: '', support_url: null
        } });
        if (url.pathname === '/v1/tracks') {
          assert.equal(url.searchParams.get('artist_did'), did);
          if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { error: { message: 'Fixture catalog unavailable' } } }); }
          return route.fulfill({ json: { object: 'list', data: empty ? [] : url.searchParams.has('cursor') ? [track(25)] : Array.from({ length: 25 }, (_, i) => track(i)), has_more: !empty && !url.searchParams.has('cursor'), next_cursor: !empty && !url.searchParams.has('cursor') ? 'next-fixture' : null } });
        }
        if (url.pathname === '/v1/albums') {
          assert.equal(url.searchParams.get('artist_did'), did);
          const more = !url.searchParams.has('cursor');
          return route.fulfill({ json: { object: 'list', data: [{ object: 'album', id: more ? 'album_one' : 'album_two', record: { uri: `at://${did}/fm.plyr.list/${more ? 'one' : 'two'}` }, metadata: { name: more ? 'an album with a deliberately long title' : 'another album' }, metrics: { member_count: 8 }, media: { artwork: null } }], has_more: more, next_cursor: more ? 'albums-next' : null } });
        }
        return route.fulfill({ json: { object: 'list', data: [], has_more: false } });
      });
      try {
        await page.goto(origin + '/portal');
        await page.getByRole('link', { name: 'sign in', exact: true }).click();
        await page.waitForURL(url => url.pathname === '/login');
        assert.equal(new URL(page.url()).searchParams.get('return_to'), '/portal');
        await authorizeFixture(page, accounts, handle);
        await page.waitForURL('**/portal');
        await page.getByText('A musician with a long display name', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'retry', exact: true }).waitFor();
        assert.equal(requests.some(url => url.startsWith('/v1/albums')), false, 'Inactive albums are not fetched');
        await page.getByRole('button', { name: 'retry', exact: true }).click();
        await page.getByRole('link', { name: 'edit recording 24', exact: true }).waitFor();
        const first = page.getByRole('link', { name: 'edit a long track title — live from a very quiet room', exact: true });
        await first.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `${width}-${theme}-portal.png`) });
        await page.getByRole('button', { name: 'more tracks', exact: true }).click();
        await page.getByRole('link', { name: 'edit recording 25', exact: true }).waitFor();
        assert.ok(requests.some(url => url.includes('cursor=next-fixture')));
        await page.getByRole('button', { name: 'albums', exact: true }).click();
        await page.getByRole('link', { name: /an album with a deliberately long title/ }).waitFor();
        await page.screenshot({ path: path.join(output, `${width}-${theme}-albums.png`) });
        await page.getByRole('button', { name: 'more albums', exact: true }).click();
        await page.getByRole('link', { name: /another album/ }).waitFor();
        empty = true;
        await page.getByRole('button', { name: 'tracks', exact: true }).click();
        await page.getByText('No published music here yet.', { exact: true }).waitFor();
        await page.screenshot({ path: path.join(output, `${width}-${theme}-empty.png`) });
        await page.getByRole('link', { name: 'You', exact: true }).click();
        await page.getByRole('link', { name: 'Settings', exact: true }).click();
        await page.getByText(`@${handle}`, { exact: true }).waitFor();
        await page.getByRole('button', { name: 'sign out', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `${width}-${theme}-account.png`) });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${width}/${theme}: real OAuth return intent, catalog retry, tracks/albums pagination, lazy tabs, empty state, signed-in settings passed`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
