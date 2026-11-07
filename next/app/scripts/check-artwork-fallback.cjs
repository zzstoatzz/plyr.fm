const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');
const origin = 'https://next.plyr.fm';
const dist = path.resolve(__dirname, '../dist');
const avatar = 'https://artwork.fixture.test/avatar.svg';
const explicit = 'https://artwork.fixture.test/cover.svg';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const catalog = await (await page.request.get('https://api.next.plyr.fm/v1/tracks?limit=1')).json();
    const track = structuredClone(catalog.data[0]);
    track.media.artwork = null;
    track.artist.profile.avatar_url = avatar;
    const collection = kind => ({ object: kind, id: kind === 'album' ? 'alb_fixture' : 'pls_fixture', record: { uri: `at://did:plc:fixture/fm.plyr.list/${kind}`, cid: 'fixture', collection: 'fm.plyr.list', rkey: kind }, metadata: { name: 'No cover collection', created_at: '2026-11-06T00:00:00Z', updated_at: null }, owner: { did: track.artist.did, profile: { ...track.artist.profile, avatar_url: avatar } }, media: { artwork: null }, metrics: { member_count: 1, available_count: 1, total_plays: 0 }, members: [{ position: 0, subject: track.record, availability: 'available', track }] });
    if (!process.env.ARTWORK_LIVE) await page.route(origin + '/**', async route => {
      let file = path.join(dist, new URL(route.request().url()).pathname);
      try { if (!(await fs.stat(file)).isFile()) throw Error(); } catch { file = path.join(dist, 'index.html'); }
      await route.fulfill({ body: await fs.readFile(file), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html' });
    });
    await page.route('https://artwork.fixture.test/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#5577aa"/></svg>' }));
    await page.route('https://api.next.plyr.fm/**', route => {
      const p = new URL(route.request().url()).pathname;
      if (route.request().method() !== 'GET') return route.abort();
      if (p === '/v1/tracks') return route.fulfill({ json: { object: 'list', data: [track], has_more: false } });
      if (p === '/v1/charts/tracks') return route.fulfill({ json: { object: 'list', data: [{ track, plays: 1 }], has_more: false } });
      if (p === '/v1/albums/alb_fixture') return route.fulfill({ json: collection('album') });
      if (p === '/v1/playlists/pls_fixture') return route.fulfill({ json: collection('playlist') });
      if (p === `/v1/tracks/${track.id}`) return route.fulfill({ json: track });
      return route.fallback();
    });
    for (const route of ['/', `/track/${track.id}`, '/album/alb_fixture', '/playlist/pls_fixture', `/embed/track/${track.id}`, '/embed/album/alb_fixture', '/embed/playlist/pls_fixture']) {
      await page.goto(origin + route);
      await page.locator(`img[src="${avatar}"]`).first().waitFor();
      await page.waitForFunction(url => [...document.images].some(image => image.src === url && image.complete && image.naturalWidth > 0), avatar);
      if (route === '/') {
        assert.equal(await page.getByRole('button', { name: 'all tracks loaded', exact: true }).count(), 0);
        await page.getByTestId('home-track-row').getByTestId('track-play-control').click();
        await page.getByTestId('player-dock').locator(`img[src="${avatar}"]`).waitFor();
        await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
        await page.getByTestId('now-playing-artwork').locator(`img[src="${avatar}"]`).waitFor();
      }
      console.log('Avatar fallback rendered:', route);
    }
    track.media.artwork = { url: explicit };
    await page.goto(origin + '/track/' + track.id);
    await page.locator(`img[src="${explicit}"]`).first().waitFor();
    assert.equal(await page.locator(`img[src="${avatar}"]`).count(), 0, 'Explicit cover takes precedence');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
