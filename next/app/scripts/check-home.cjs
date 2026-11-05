const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');

const requireFrontend = createRequire(path.resolve(__dirname, '../../../frontend/package.json'));
const { chromium } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : requireFrontend('playwright');
const origin = process.env.HOME_URL || 'https://next.plyr.fm';
const output = process.env.HOME_OUTPUT || `/tmp/plyr-home-${Date.now()}`;

async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const reports = [];
  try {
    for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
      await context.addInitScript(theme => localStorage.setItem('plyr-next:prefs', JSON.stringify({ theme })), theme);
      if (process.env.HOME_DIST) await context.route(origin + '/**', async route => {
        const candidate = path.join(path.resolve(process.env.HOME_DIST), new URL(route.request().url()).pathname);
        const exists = await fs.stat(candidate).then(stat => stat.isFile(), () => false);
        await route.fulfill({ path: exists ? candidate : path.join(path.resolve(process.env.HOME_DIST), 'index.html') });
      });
      if (process.env.HOME_TAG_FIXTURE === '1') await context.route('https://api.next.plyr.fm/v1/tags?*', route => route.fulfill({
        json: { object: 'list', data: [{ name: 'ambient', track_count: 12, total_plays: 400 }, { name: 'electronic', track_count: 23, total_plays: 800 }] },
      }));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const started = Date.now();
      await page.goto(origin);
      await page.getByRole('button', { name: 'Refresh tracks', exact: true }).waitFor();
      await page.getByRole('button', { name: /Top tracks period:/ }).waitFor();
      await page.getByRole('button', { name: /^Filter by / }).first().waitFor();
      await page.evaluate(() => Promise.race([Promise.all([...document.images].map(image => image.complete ? Promise.resolve() : new Promise(resolve => { image.addEventListener("load", resolve, { once: true }); image.addEventListener("error", resolve, { once: true }); }))), new Promise(resolve => setTimeout(resolve, 8000))]));
      await page.waitForTimeout(300);
      const screenshot = path.join(output, `${width}-${theme}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false);
      const chip = page.getByRole('button', { name: /^Filter by / }).first();
      const name = (await chip.getAttribute('aria-label')).replace('Filter by ', '');
      const request = page.waitForRequest(request => new URL(request.url()).pathname === '/v1/tracks' && new URL(request.url()).searchParams.getAll('tag').includes(name));
      await chip.click();
      const filteredRequest = await request;
      if (process.env.HOME_TAG_FIXTURE !== "1") assert.equal((await filteredRequest.response()).status(), 200);
      await page.getByRole('button', { name: 'Clear tag filters', exact: true }).click();
      assert.deepEqual(errors, []);
      reports.push({ width, theme, elapsedMs: Date.now() - started, overflow, errors, screenshot });
      await context.close();
    }
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ tagCatalogFixture: process.env.HOME_TAG_FIXTURE === '1', reports }, null, 2));
    console.log(output);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
