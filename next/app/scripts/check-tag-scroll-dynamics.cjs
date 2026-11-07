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
      await context.route('https://api.next.plyr.fm/v1/tags?*', async route => {
        const params = new URL(route.request().url()).searchParams;
        const start = Number(params.get('cursor') || 0);
        const limit = Number(params.get('limit'));
        reads.push(start);
        await new Promise(resolve => setTimeout(resolve, 120));
        const end = Math.min(350, start + limit);
        await route.fulfill({ json: { object: 'list', data: Array.from({ length: end - start }, (_, i) => ({ name: `tag-${String(start + i).padStart(3, '0')}`, track_count: 1, total_plays: 350 - start - i })), has_more: end < 350, next_cursor: end < 350 ? String(end) : null } });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin);
      await page.getByRole('button', { name: 'Filter by tag-000', exact: true }).waitFor();
      const strip = page.getByTestId('home-tags');
      const position = () => strip.evaluate(node => node.scrollLeft);
      await strip.hover();
      await page.mouse.wheel(4, 0);
      await page.waitForTimeout(450);
      const gentle = await position();
      assert.ok(gentle >= 3 && gentle <= 6, `gentle horizontal input stays precise: ${gentle}`);
      await page.mouse.wheel(0, 4);
      await page.waitForTimeout(450);
      assert.ok(await position() <= gentle + 6, 'gentle vertical input stays precise');
      const start = await position();
      const burst = async (horizontal) => {
        for (let i = 0; i < 8; i++) { await page.mouse.wheel(horizontal ? 120 : 0, horizontal ? 0 : 120); await page.waitForTimeout(16); }
        await page.waitForTimeout(650);
      };
      await burst(true);
      const fast = await position() - start;
      assert.ok(fast >= 4000, `horizontal burst travels thousands of pixels: ${fast}`);
      await strip.evaluate(node => node.addEventListener('wheel', () => { node.dataset.reverseStart = String(node.scrollLeft); }, { once: true, capture: true }));
      await page.mouse.wheel(-6, 0);
      const beforeReverse = await strip.evaluate(node => Number(node.dataset.reverseStart));
      await page.waitForTimeout(450);
      const afterReverse = await position();
      assert.ok(afterReverse < beforeReverse && afterReverse >= beforeReverse - 8, `gentle reverse immediately cancels acceleration: ${beforeReverse} -> ${afterReverse}`);
      const finalVisible = async () => {
        const last = page.getByRole('button', { name: 'Filter by tag-349', exact: true });
        if (!await last.count()) return false;
        return last.evaluate(node => {
          const bounds = node.getBoundingClientRect();
          const viewport = node.closest('[data-testid="home-tags"]').getBoundingClientRect();
          return bounds.left >= viewport.left - 1 && bounds.right <= viewport.right + 1;
        });
      };
      const started = Date.now();
      let bursts = 0;
      while (bursts < 6 && !await finalVisible()) { await burst(bursts % 2 === 0); bursts++; }
      assert.ok(await finalVisible(), 'rapid gestures reach the final tag across page boundaries');
      assert.deepEqual(reads, [0, 50, 100, 150, 200, 250, 300]);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await strip.evaluate(node => node.addEventListener('wheel', () => { node.dataset.reducedStart = String(node.scrollLeft); }, { once: true, capture: true }));
      await page.mouse.wheel(-4, 0);
      const beforeReduced = await strip.evaluate(node => Number(node.dataset.reducedStart));
      await page.waitForTimeout(50);
      assert.ok(await position() <= beforeReduced - 3 && await position() >= beforeReduced - 5, 'reduced motion stays precise without animation');
      const feed = page.getByTestId('home-feed');
      const vertical = await feed.evaluate(node => node.scrollTop);
      await strip.evaluate(node => { node.scrollLeft = node.scrollWidth; node.dispatchEvent(new Event('pointerdown')); });
      await page.mouse.wheel(0, 80);
      await page.waitForTimeout(200);
      assert.ok(await feed.evaluate(node => node.scrollTop) > vertical, 'terminal edge releases vertical scrolling to the feed');
      assert.deepEqual(errors, []);
      console.log(`${width}: gentle ${gentle}px; first rapid burst ${Math.round(fast)}px; final tag in ${bursts + 1} bursts, ${Date.now() - started}ms after first burst; 7 pages, no errors`);
      await page.screenshot({ path: `/tmp/tag-dynamics-${width}.png` });
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
