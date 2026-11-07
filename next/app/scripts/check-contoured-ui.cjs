const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');
const origin = 'https://next.plyr.fm';
const dist = process.env.CONTOURED_DIST || path.resolve(__dirname, '../dist');
const output = process.env.CONTOURED_OUTPUT || '/tmp/plyr-contoured-review';

async function preview(route) {
  let file = path.join(dist, decodeURIComponent(new URL(route.request().url()).pathname));
  try { if (!(await fs.stat(file)).isFile()) throw Error(); }
  catch { file = path.join(dist, 'index.html'); }
  const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.ttf') ? 'font/ttf'
    : file.endsWith('.png') ? 'image/png' : file.endsWith('.json') ? 'application/json' : 'text/html';
  await route.fulfill({ body: await fs.readFile(file), contentType });
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const width of [390, 1440, 1920, 320]) {
      for (const colorScheme of width === 320 ? ['dark'] : ['dark', 'light']) {
        const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme });
        if (!process.env.CONTOURED_LIVE) await context.route(origin + '/**', preview);
        await context.route('https://api.next.plyr.fm/**', route => route.request().method() === 'POST' ? route.abort() : route.fallback());
        await context.addInitScript(() => {
          const Audio = window.Audio;
          window.Audio = class extends Audio { constructor(...args) { super(...args); this.muted = true; } };
        });
        const page = await context.newPage();
        const errors = [];
        page.on('console', message => { if (message.text().includes('native animated module is missing')) errors.push(message.text()); });
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        const chart = page.getByTestId('home-chart');
        const covers = chart.getByTestId('track-play-control');
        await covers.first().waitFor();
        const count = await covers.count();
        const bounds = await chart.boundingBox();
        assert.ok(bounds);
        for (const cover of await covers.all()) {
          const box = await cover.boundingBox();
          assert.ok(box && box.x >= bounds.x - 1 && box.x + box.width <= bounds.x + bounds.width + 1, 'Covers fit the available width');
          assert.ok(Math.abs(box.width - box.height) < 1, 'Covers remain square');
        }
        const period = page.getByRole('button', { name: 'Top tracks period: past month', exact: true });
        const request = page.waitForResponse(response => new URL(response.url()).pathname === '/v1/charts/tracks' && new URL(response.url()).searchParams.get('period') === 'week');
        await period.click();
        assert.equal(await page.getByRole('group', { name: 'Top tracks period', exact: true }).count(), 0, 'Period cycles without opening a menu');
        assert.equal((await request).status(), 200);
        await page.getByRole('button', { name: 'Top tracks period: past week', exact: true }).waitFor();
        await covers.first().waitFor();
        const next = page.getByRole('button', { name: 'Next top tracks', exact: true });
        if (await next.count()) {
          await next.click();
          await page.getByRole('button', { name: 'Previous top tracks', exact: true }).click();
        }
        const feed = page.getByTestId('home-track-row');
        await feed.first().waitFor();
        if (width >= 1280) {
          const first = await feed.nth(0).boundingBox();
          const second = await feed.nth(1).boundingBox();
          assert.ok(first && second && Math.abs(first.y - second.y) < 1 && second.x > first.x, 'Desktop uses two feed columns');
        }
        await covers.first().click();
        const dock = page.getByTestId('player-dock');
        await dock.waitFor();
        const light = await page.getByTestId('playback-status-inlay').boundingBox();
        const dockBox = await dock.boundingBox();
        assert.ok(light && dockBox && Math.abs(light.width - dockBox.width) <= 2 && light.height <= 2, 'Status light spans the dock as a thin inset');
        if (width >= 800) {
          for (const element of [page.getByTestId('app-frame'), dock]) {
            const box = await element.boundingBox();
            assert.ok(box && Math.abs(box.x) < 1 && Math.abs(box.width - width) < 1, 'Desktop reaches both viewport edges');
          }
        }
        await page.screenshot({ path: path.join(output, `${width}-${colorScheme}.png`) });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Page does not overflow');
        await dock.getByRole('link', { name: 'sign in to like', exact: true }).click();
        await page.waitForURL('**/login**');
        assert.equal(new URL(page.url()).searchParams.get('return_to'), '/');
        assert.ok(await dock.isVisible(), 'Navigation preserves the dock');
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ width, colorScheme, covers: count, errors }));
        await context.close();
      }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
