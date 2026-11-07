const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');
const origin = 'https://next.plyr.fm';
const dist = process.env.FEED_DIST || path.resolve(__dirname, '../dist');

(async () => {
  const seed = (await (await fetch('https://api.next.plyr.fm/v1/tracks?limit=1')).json()).data[0];
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: width === 390 ? 'light' : 'dark' });
      if (!process.env.FEED_LIVE) await context.route(origin + '/**', async route => {
        let file = path.join(dist, new URL(route.request().url()).pathname);
        try { if (!(await fs.stat(file)).isFile()) throw Error(); } catch { file = path.join(dist, 'index.html'); }
        await route.fulfill({ body: await fs.readFile(file), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html' });
      });
      const reads = [];
      let fail = true;
      await context.route('https://api.next.plyr.fm/v1/tracks?*', async route => {
        const query = new URL(route.request().url()).searchParams;
        if (query.get('limit') === '30' && !query.has('cursor')) return route.fallback();
        const start = Number(query.get('cursor') || 0);
        const limit = Number(query.get('limit'));
        reads.push(start);
        if (start === 48 && fail) { fail = false; return route.fulfill({ status: 503, json: { error: { message: 'temporary catalog failure' } } }); }
        await new Promise(resolve => setTimeout(resolve, start === 24 ? 1200 : 100));
        const end = Math.min(start + limit, 144);
        await route.fulfill({ json: { object: 'list', data: Array.from({ length: end - start }, (_, i) => ({ ...seed, id: `fixture-${start + i}`, metadata: { ...seed.metadata, title: `Feed track ${start + i}` } })), has_more: end < 144, next_cursor: end < 144 ? String(end) : null } });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin);
      await page.getByRole('button', { name: 'Play Feed track 0', exact: true }).waitFor();
      const feed = page.getByTestId('home-feed');
      const bottom = () => feed.evaluate(node => { node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event('scroll')); });
      await bottom();
      await page.getByRole('progressbar', { name: 'loading more...' }).waitFor();
      const footerHeight = (await page.getByTestId('home-feed-footer').boundingBox()).height;
      await page.waitForTimeout(500);
      assert.deepEqual(reads, [0, 24], 'one continuation in flight during a slow response');
      assert.equal(await page.getByText('more tracks', { exact: true }).count(), 0, 'no alternating footer CTA');
      await page.waitForTimeout(2200);
      assert.ok(reads.length <= 3, 'one scroll only fills the prefetch window');
      assert.equal((await page.getByTestId('home-feed-footer').boundingBox()).height, footerHeight, 'footer height stays stable');
      for (let i = 0; i < 30 && !await page.getByRole('button', { name: 'retry loading tracks', exact: true }).count(); i++) { await bottom(); await page.waitForTimeout(100); }
      await page.getByRole('button', { name: 'retry loading tracks', exact: true }).waitFor();
      const failedReads = reads.length;
      await bottom(); await page.waitForTimeout(300);
      assert.equal(reads.length, failedReads, 'failed page does not retry automatically');
      await page.getByRole('button', { name: 'retry loading tracks', exact: true }).click();
      for (let i = 0; i < 80 && !reads.includes(120); i++) { await bottom(); await page.waitForTimeout(100); }
      await page.getByRole('button', { name: 'Play Feed track 143', exact: true }).waitFor({ state: 'attached' });
      await bottom(); await page.waitForTimeout(500);
      assert.deepEqual(reads, [0, 24, 48, 48, 72, 96, 120], 'every page once, except explicit retry');
      await page.getByRole('button', { name: 'Play Feed track 143', exact: true }).scrollIntoViewIfNeeded();
      assert.ok(await page.getByRole('button', { name: 'Play Feed track 143', exact: true }).isVisible(), 'oldest track reachable');
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `/tmp/home-feed-${width}.png` });
      console.log(`${width}: bounded prefetch, slow response, stable footer, retry and oldest track passed`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
