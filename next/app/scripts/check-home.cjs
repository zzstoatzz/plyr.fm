const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');

const requireFrontend = createRequire(path.resolve(__dirname, '../../../frontend/package.json'));
const { chromium, webkit } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : requireFrontend('playwright');
const origin = process.env.HOME_URL || 'https://next.plyr.fm';
const output = process.env.HOME_OUTPUT || `/tmp/plyr-home-${Date.now()}`;

async function expectTrackLinks(page, tracks) {
  const paths = tracks.map(track => `/track/${encodeURIComponent(track.id)}`);
  await page.waitForFunction(expected => JSON.stringify([...document.querySelector('[data-testid="home-feed"]').querySelectorAll('[data-testid="home-track-row"]')].map(row => new URL(row.querySelector('a[href^="/track/"]').href).pathname)) === JSON.stringify(expected), paths);
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browserName = process.env.HOME_BROWSER || 'chromium';
  assert.ok(['chromium', 'webkit'].includes(browserName), 'HOME_BROWSER must be chromium or webkit');
  const browser = browserName === 'webkit'
    ? await webkit.launch({ executablePath: process.env.WEBKIT_EXECUTABLE, headless: true })
    : await chromium.launch({ channel: 'chrome', headless: true });
  const reports = [];
  try {
    for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
      await context.addInitScript(preferences => localStorage.setItem('plyr-next:prefs', JSON.stringify(preferences)), { theme, scale: Number(process.env.HOME_SCALE || 1) });
      if (process.env.HOME_DIST) await context.route(origin + '/**', async route => {
        const candidate = path.join(path.resolve(process.env.HOME_DIST), new URL(route.request().url()).pathname);
        const exists = await fs.stat(candidate).then(stat => stat.isFile(), () => false);
        await route.fulfill({ path: exists ? candidate : path.join(path.resolve(process.env.HOME_DIST), 'index.html') });
      });
      if (process.env.HOME_API) await context.route('https://api.next.plyr.fm/**', async route => {
        const url = new URL(route.request().url());
        await route.fulfill({ response: await route.fetch({ url: process.env.HOME_API + url.pathname + url.search }) });
      });
      if (process.env.HOME_TAG_FIXTURE === '1') await context.route('https://api.next.plyr.fm/v1/tags?*', route => route.fulfill({
        json: { object: 'list', data: [{ name: 'ambient', track_count: 12, total_plays: 400 }, { name: 'electronic', track_count: 23, total_plays: 800 }] },
      }));
      let tagReads = 0;
      if (process.env.HOME_FAIL_TAG_ONCE === '1') await context.route('https://api.next.plyr.fm/v1/tags?*', route => {
        tagReads += 1;
        return tagReads === 1 ? route.fulfill({ status: 503, json: { error: { message: 'try again' } } }) : route.fallback();
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const started = Date.now();
      const initialResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/v1/tracks' && !new URL(response.url()).searchParams.has('tag'));
      await page.goto(origin);
      const initial = await (await initialResponse).json();
      await page.getByRole('button', { name: 'Refresh tracks', exact: true }).waitFor();
      await page.getByRole('button', { name: /Top tracks period:/ }).waitFor();
      const likers = page.getByTestId('home-feed').getByRole('button', { name: /^Who liked / }).first();
      if (width >= 1024 && await likers.count()) {
        // The likers card stays open with the pointer parked on it, and the first click doesn't close what hover opened.
        await likers.scrollIntoViewIfNeeded();
        const box = await likers.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForFunction(() => document.querySelector('[aria-label^="Who liked "][aria-expanded="true"]'));
        for (let step = 1; step <= 10; step++) await page.mouse.move(box.x + box.width / 2, box.y - 2 * step);
        await page.waitForTimeout(600);
        assert.equal(await likers.getAttribute('aria-expanded'), 'true', 'likers card stays open under the pointer');
        await likers.click();
        await page.waitForTimeout(300);
        assert.equal(await likers.getAttribute('aria-expanded'), 'true', 'clicking an open likers card keeps it open');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('[aria-label^="Who liked "][aria-expanded="true"]'));
        await page.mouse.move(1, 1);
      }
      if (process.env.HOME_FAIL_TAG_ONCE === '1') {
        await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
        await page.getByTestId('home-feed').getByRole('link').first().waitFor();
        await expectTrackLinks(page, initial.data);
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        await page.getByRole('button', { name: /^Filter by / }).first().waitFor();
        await expectTrackLinks(page, initial.data);
        assert.equal(tagReads, 2);
      }
      await page.getByRole('button', { name: /^Filter by / }).first().waitFor();
      await page.evaluate(() => Promise.race([Promise.all([...document.images].map(image => image.complete ? Promise.resolve() : new Promise(resolve => { image.addEventListener("load", resolve, { once: true }); image.addEventListener("error", resolve, { once: true }); }))), new Promise(resolve => setTimeout(resolve, 8000))]));
      await page.waitForTimeout(300);
      const screenshot = path.join(output, `${width}-${theme}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false);
      const targets = await page.getByRole('button', { name: /^(Filter by |Top tracks period:)/ }).evaluateAll(elements => elements.map(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
      assert.ok(targets.every(target => target.width >= 44 && target.height >= 44));
      const chip = page.getByRole('button', { name: /^Filter by / }).first();
      const name = (await chip.getAttribute('aria-label')).replace('Filter by ', '');
      const request = page.waitForRequest(request => new URL(request.url()).pathname === '/v1/tracks' && new URL(request.url()).searchParams.getAll('tag').includes(name));
      await chip.click();
      const filteredRequest = await request;
      let filteredTrackIds = [];
      if (process.env.HOME_TAG_FIXTURE !== '1') {
        const response = await filteredRequest.response();
        assert.equal(response.status(), 200);
        const body = await response.json();
        await expectTrackLinks(page, body.data);
        filteredTrackIds = body.data.map(track => track.id);
      }
      await page.getByRole('button', { name: 'Clear tag filters', exact: true }).click();
      await page.getByRole('button', { name: 'Clear tag filters', exact: true }).waitFor({ state: 'hidden' });
      await expectTrackLinks(page, initial.data);
      assert.deepEqual(errors, []);
      reports.push({ width, theme, elapsedMs: Date.now() - started, overflow, errors, screenshot, targets, filteredTrackIds, restoredTrackIds: initial.data.map(track => track.id), tagRetry: process.env.HOME_FAIL_TAG_ONCE === '1' });
      await context.unrouteAll({ behavior: 'wait' });
      await context.close();
    }
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ browser: browserName, tagCatalogFixture: process.env.HOME_TAG_FIXTURE === '1', api: process.env.HOME_API || 'public Next', reports }, null, 2));
    console.log(output);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
