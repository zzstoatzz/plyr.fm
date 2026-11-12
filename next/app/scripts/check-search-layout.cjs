const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');
const { fixturePage } = require('./pds-browser-fixture.cjs');

const origin = 'https://next.plyr.fm';
const output = process.env.SEARCH_OUTPUT || `/tmp/plyr-search-layout-${Date.now()}`;
const list = data => ({ object: 'list', data, has_more: false });

(async () => {
  await fs.mkdir(output, { recursive: true });
  const tracks = (await (await fetch('https://api.next.plyr.fm/v1/tracks?limit=3')).json()).data;
  const track = tracks[0];
  assert.ok(track, 'A public track is required for real playback');
  const hits = ['track', 'artist', 'album', 'playlist'].map(type => ({
    type, id: type === 'track' ? track.id : `${type}-fixture`, record: track.record,
    title: `A long ${type} title with enough words to exercise the narrow layout`, image_url: null,
    owner: { did: track.artist.did, handle: track.artist.profile.handle, display_name: 'An artist with a long display name' },
  }));
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
      const { context, page } = await fixturePage(browser, {}, {
        dist: process.env.SEARCH_DIST, preferences: { theme, scale: 1.3 }, seedPreferencesOnce: true,
        context: { viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' },
      });
      const errors = [];
      let detailAttempts = 0;
      page.on('pageerror', error => errors.push(error.message));
      await context.route('https://api.next.plyr.fm/**', async route => {
        if (route.request().method() !== 'GET') return route.abort();
        const url = new URL(route.request().url());
        if (url.pathname === '/v1/charts/tracks') return route.fulfill({ json: list(tracks.map(track => ({ track }))) });
        if (url.pathname === '/v1/search') return route.fulfill({ json: list(hits) });
        if (url.pathname === `/v1/tracks/${track.id}` && detailAttempts++ === 0) {
          return route.fulfill({ status: 503, json: { error: { message: 'Track temporarily unavailable' } } });
        }
        return route.continue();
      });
      async function screenshot(name) {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        await page.screenshot({ path: `${output}/${width}-${theme}-${name}.png`, fullPage: true });
      }
      try {
        await page.goto(`${origin}/search`);
        const input = page.getByRole('textbox', { name: 'Search tracks, artists, albums and playlists', exact: true });
        await input.waitFor();
        await page.getByRole('heading', { name: 'top tracks', exact: true }).waitFor();
        await screenshot('browse');
        const before = await input.boundingBox();
        await input.focus();
        const after = await input.boundingBox();
        assert.deepEqual(after, before, 'Focusing search must not move or resize the input');
        await input.fill('long');
        const results = page.getByTestId('search-results');
        const play = results.getByRole('button', { name: /^track:/ });
        await play.waitFor();
        const rows = [...await results.getByRole('link').all(), play];
        for (const target of [page.getByRole('button', { name: 'Clear search', exact: true }), ...rows,
          ...await page.getByRole('button', { name: /^(all|tracks|artists|albums|playlists)$/ }).all()]) {
          const box = await target.boundingBox();
          assert.ok(box && box.height >= 44 && box.width >= 44, 'Search actions retain 44px touch targets');
        }
        for (const row of rows) {
          const aligned = await row.evaluate(node => {
            const [art, text, action] = [...node.children].map(child => child.getBoundingClientRect());
            return art.right <= text.left && text.right <= action.left && Math.abs(art.y + art.height / 2 - action.y - action.height / 2) < 1;
          });
          assert.equal(aligned, true, 'Artwork, title and action stay in one aligned result row');
        }
        await screenshot('results');
        await play.click();
        await page.getByText('Track temporarily unavailable', { exact: true }).waitFor();
        assert.equal(detailAttempts, 1, 'Playback failure stays available for an explicit retry');
        await screenshot('playback-error');
        await page.getByRole('button', { name: 'retry playback', exact: true }).click();
        await page.waitForFunction(() => window.jamAudio.some(audio => !audio.paused && audio.currentTime > 0.3));
        assert.equal(detailAttempts, 2, 'Retry reloads the selected track exactly once');
        await page.getByText('Track temporarily unavailable', { exact: true }).waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: 'Clear search', exact: true }).click();
        assert.equal(await input.inputValue(), '');
        assert.equal(await input.evaluate(node => node === document.activeElement), true);
        await page.getByRole('heading', { name: 'top tracks', exact: true }).waitFor();
        assert.deepEqual(errors, []);
        console.log(`${width}/${theme}: large text, stable focus, touch targets, explicit playback retry and clear passed`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
