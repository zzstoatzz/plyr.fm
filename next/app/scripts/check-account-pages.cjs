const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const frontend = createRequire(path.resolve(__dirname, '../../../frontend/package.json'));
const { chromium } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : frontend('playwright');
const { fixtureAccounts, fixturePage, authorizeFixture } = require('./pds-browser-fixture.cjs');
const output = process.env.ACCOUNT_OUTPUT || `/tmp/plyr-account-pages-${Date.now()}`;
const origin = 'https://next.plyr.fm';
const trackCollection = `${process.env.EXPO_PUBLIC_NSID_PREFIX || 'fm.plyr'}.track`;
async function pdsCall(method, data, token) {
  const response = await fetch(`http://localhost:5197/xrpc/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw Error(`${method}: ${response.status} ${result.error}`);
  return result;
}


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
      const session = await pdsCall('com.atproto.server.createSession', { identifier: handle, password: accounts[handle].pass });
      const seed = await pdsCall('com.atproto.repo.createRecord', { repo: did, collection: trackCollection, record: {
        $type: trackCollection, title: 'recording 25', artist: 'A musician', fileType: 'mp3', audioUrl: 'https://fixture.invalid/audio.mp3', createdAt: new Date().toISOString(), tags: ['integration-test']
      } }, session.accessJwt);
      let editedTitle = 'recording 25';
      let editedCid = seed.cid;
      const requests = [];
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let failNext = true;
      let empty = false;
      let failMore = true;
      const track = index => ({
        object: 'track', id: index === 25 ? 'trk_' + Buffer.from(seed.uri).toString('base64url') : `trk_fixture_${index}`,
        record: { uri: index === 25 ? seed.uri : `at://${did}/${trackCollection}/${index}`, cid: index === 25 ? editedCid : `fixture${index}`, collection: trackCollection, rkey: index === 25 ? seed.uri.split('/').at(-1) : String(index), revision: null },
        metadata: { title: index === 25 ? editedTitle : index ? `recording ${index}` : 'a long track title — live from a very quiet room', album: 'a collection', duration_seconds: 180, description: null, created_at: '2026-11-05T00:00:00Z' },
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
        if (url.pathname === '/v1/records/await') {
          assert.equal(url.searchParams.get('uri'), seed.uri);
          const result = await fetch(`http://localhost:5197/xrpc/com.atproto.repo.getRecord?${new URLSearchParams({ repo: did, collection: trackCollection, rkey: seed.uri.split('/').at(-1) })}`, { headers: { authorization: `Bearer ${session.accessJwt}` } }).then(response => response.json());
          assert.equal(result.uri, seed.uri);
          editedTitle = result.value.title; editedCid = result.cid;
          return route.fulfill({ json: { uri: seed.uri, cid: result.cid, status: 'indexed' } });
        }
        if (url.pathname === '/v1/tracks/' + track(25).id) return route.fulfill({ json: track(25) });
        if (url.pathname === '/v1/tracks') {
          assert.equal(url.searchParams.get('artist_did'), did);
          if (url.searchParams.has('cursor') && failMore) { failMore = false; return route.fulfill({ status: 503, json: { error: { message: 'Fixture page unavailable' } } }); }
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
        await page.getByRole('button', { name: 'retry', exact: true }).waitFor();
        assert.equal(await page.getByRole('link', { name: 'edit recording 24', exact: true }).count(), 1);
        await page.getByRole('button', { name: 'retry', exact: true }).click();
        await page.getByRole('link', { name: 'edit recording 25', exact: true }).waitFor();
        assert.ok(requests.some(url => url.includes('cursor=next-fixture')));
        const scrollPosition = () => page.getByRole('link', { name: 'edit recording 25', exact: true }).evaluate(node => {
          while (node && !(node.clientHeight > 100 && node.scrollHeight > node.clientHeight + 100 && /auto|scroll/.test(getComputedStyle(node).overflowY))) node = node.parentElement;
          return node?.scrollTop ?? -1;
        });
        await page.getByRole('link', { name: 'edit recording 25', exact: true }).scrollIntoViewIfNeeded();
        const originScroll = await scrollPosition();
        const beforeBack = requests.length;
        await page.getByRole('link').filter({ hasText: 'recording 25' }).first().click();
        await page.waitForURL('**/track/' + track(25).id);
        await page.goBack(); await page.waitForURL('**/portal');
        await page.getByRole('link', { name: 'edit recording 25', exact: true }).waitFor();
        assert.ok(Math.abs(await scrollPosition() - originScroll) < 2, 'Back preserves portal scroll and later page');
        assert.equal(requests.slice(beforeBack).filter(url => url.startsWith('/v1/tracks?')).length, 0, 'Ordinary Back does not reload catalog');
        await page.getByRole('tab', { name: 'albums', exact: true }).click();
        await page.getByRole('link', { name: /an album with a deliberately long title/ }).waitFor();
        await page.screenshot({ path: path.join(output, `${width}-${theme}-albums.png`) });
        await page.getByRole('button', { name: 'more albums', exact: true }).click();
        await page.getByRole('link', { name: /another album/ }).waitFor();
        const afterAlbums = requests.length;
        await page.getByRole('tab', { name: 'tracks', exact: true }).click();
        await page.getByRole('link', { name: 'edit recording 25', exact: true }).waitFor();
        assert.equal(requests.length, afterAlbums, 'Visited tracks stay loaded without a request');
        assert.equal(await page.getByRole('tab', { name: 'tracks', exact: true }).getAttribute('aria-selected'), 'true');
        failNext = true;
        await page.getByRole('button', { name: 'refresh catalog', exact: true }).click();
        await page.getByRole('button', { name: 'retry', exact: true }).waitFor();
        assert.equal(await page.getByRole('link', { name: 'edit recording 25', exact: true }).count(), 1, 'Failed revalidation retains all loaded rows');
        await page.getByRole('button', { name: 'retry', exact: true }).click();
        await page.getByRole('button', { name: 'retry', exact: true }).waitFor({ state: 'hidden' });
        await page.getByRole('link', { name: 'edit recording 25', exact: true }).click();
        await page.getByRole('textbox', { name: 'Title', exact: true }).fill('updated recording 25');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await page.waitForURL('**/track/' + track(25).id);
        await page.goBack(); await page.waitForURL('**/portal');
        await page.getByRole('link', { name: 'edit updated recording 25', exact: true }).waitFor();
        assert.equal(await page.getByRole('link', { name: 'edit recording 24', exact: true }).count(), 1, 'Indexed edit revalidates full loaded cursor chain');
        assert.equal(requests.filter(url => url.startsWith('/v1/albums')).length, 2, 'Track edit does not refresh inactive albums');
        empty = true;
        await page.getByRole('button', { name: 'refresh catalog', exact: true }).click();
        await page.getByText('no published music here yet.', { exact: true }).waitFor();
        await page.screenshot({ path: path.join(output, `${width}-${theme}-empty.png`) });
        await page.getByRole('link', { name: 'You', exact: true }).click();
        await page.getByRole('link', { name: 'Settings', exact: true }).click();
        await page.getByText(`@${handle}`, { exact: true }).waitFor();
        await page.getByRole('button', { name: 'sign out', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `${width}-${theme}-account.png`) });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${width}/${theme}: real OAuth return intent, catalog retry, tracks/albums pagination, lazy retained tabs, Back scroll, failed-refresh retention, real PDS edit invalidation, empty state and signed-in settings passed`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
