const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');
const origin = 'https://next.plyr.fm';
const dist = path.resolve(__dirname, '../dist');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: width === 390 ? 'light' : 'dark' });
      if (!process.env.TAGS_LIVE) await context.route(origin + '/**', async route => {
        let file = path.join(dist, new URL(route.request().url()).pathname);
        try { if (!(await fs.stat(file)).isFile()) throw Error(); } catch { file = path.join(dist, 'index.html'); }
        await route.fulfill({ body: await fs.readFile(file), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html' });
      });
      const reads = [];
      let fail = true;
      await context.route('https://api.next.plyr.fm/v1/tags?*', async route => {
        const cursor = new URL(route.request().url()).searchParams.get('cursor');
        reads.push(cursor);
        if (cursor === 'page2' && fail) { fail = false; return route.fulfill({ status: 503, json: {} }); }
        const start = cursor === 'page3' ? 30 : cursor === 'page2' ? 15 : 0;
        await route.fulfill({ json: { object: 'list', data: Array.from({ length: start === 30 ? 7 : 15 }, (_, i) => ({ name: `fixture-tag-${String(start + i).padStart(2, '0')}`, track_count: 1, total_plays: 37 - start - i })), has_more: start < 30, next_cursor: start < 30 ? start === 0 ? 'page2' : 'page3' : null } });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin);
      await page.getByRole('button', { name: 'Filter by fixture-tag-00', exact: true }).waitFor();
      const strip = page.getByTestId('home-tags');
      const feed = page.getByTestId('home-feed');
      const vertical = await feed.evaluate(node => node.scrollTop);
      await strip.hover();
      await page.mouse.wheel(0, 180);
      await page.waitForTimeout(80);
      const midway = await strip.evaluate(node => node.scrollLeft);
      await page.waitForTimeout(500);
      const settled = await strip.evaluate(node => node.scrollLeft);
      assert.ok(midway > 0 && settled > midway, 'wheel scrolling keeps moving smoothly after input');
      assert.ok(settled >= 300, 'one wheel input travels across several tags');
      assert.equal(await feed.evaluate(node => node.scrollTop), vertical, 'tag wheel does not move the feed');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await strip.evaluate(node => { node.scrollLeft = 0; node.dispatchEvent(new Event('scrollend')); });
      await page.mouse.wheel(0, 180);
      await page.waitForTimeout(50);
      assert.ok(await strip.evaluate(node => node.scrollLeft) >= 300, 'reduced motion scrolls directly');
      async function end() { await strip.evaluate(node => { node.scrollLeft = node.scrollWidth; node.dispatchEvent(new Event('scroll')); }); }
      await end();
      await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
      assert.equal(reads.filter(cursor => cursor === 'page2').length, 1, 'Failed page does not loop');
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await page.getByRole('button', { name: 'Filter by fixture-tag-29', exact: true }).waitFor({ state: 'attached' });
      await end();
      await page.getByRole('button', { name: 'Filter by fixture-tag-36', exact: true }).waitFor({ state: 'attached' });
      assert.equal(await page.getByRole('button', { name: 'More tags', exact: true }).count(), 0);
      assert.deepEqual(reads, [null, 'page2', 'page2', 'page3']);
      const filtered = page.waitForResponse(response => new URL(response.url()).pathname === '/v1/tracks' && new URL(response.url()).searchParams.get('tag') === 'fixture-tag-20');
      await feed.evaluate((node, top) => { node.scrollTop += top - 60; }, (await strip.boundingBox()).y);
      await page.waitForTimeout(300);
      const before = { scroll: await feed.evaluate(node => node.scrollTop), strip: (await strip.boundingBox()).y };
      assert.ok(before.scroll > 50, 'the feed is scrolled down to the tag strip before filtering');
      await page.getByRole('button', { name: 'Filter by fixture-tag-20', exact: true }).click();
      assert.equal((await filtered).status(), 200);
      await page.getByRole('button', { name: 'Remove fixture-tag-20', exact: true }).waitFor();
      await page.waitForTimeout(600);
      assert.equal(await feed.evaluate(node => node.scrollTop), before.scroll, 'selecting a tag leaves the feed where it was');
      assert.equal((await strip.boundingBox()).y, before.strip, 'selecting a tag leaves the tag strip where it was');
      await page.getByRole('button', { name: 'Filter by fixture-tag-21', exact: true }).click();
      await page.getByRole('button', { name: 'Remove fixture-tag-21', exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('[data-testid="home-tags"]').scrollLeft === 0, undefined, { timeout: 5000 });
      const edge = (await strip.boundingBox()).x;
      const chips = await Promise.all(['Clear tag filters', 'Remove fixture-tag-20', 'Remove fixture-tag-21'].map(name => page.getByRole('button', { name, exact: true }).boundingBox()));
      assert.ok(chips.every(box => box && box.x >= edge - 1), 'clear and both selected tags rest fully inside the strip');
      assert.ok(chips.every(box => Math.abs(box.y - chips[0].y) < 1), 'clear and selected tags share one row');
      await page.getByRole('button', { name: 'Clear tag filters', exact: true }).click();
      await page.getByRole('button', { name: 'Filter by fixture-tag-20', exact: true }).waitFor({ state: 'attached' });
      await page.waitForTimeout(600);
      assert.equal(await feed.evaluate(node => node.scrollTop), before.scroll, 'clearing tags leaves the feed where it was');
      assert.deepEqual(errors, []);
      console.log(`${width}: horizontal paging, failed-page retry, terminal page and pinned selection passed`);
      await page.screenshot({ path: `/tmp/home-tags-${width}.png` });
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
