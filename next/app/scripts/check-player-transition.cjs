const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');
const origin = 'https://next.plyr.fm';
const dist = path.resolve(__dirname, '../dist');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const height = 720;
    const context = await browser.newContext({ viewport: { width: 393, height } });
    await context.addInitScript(() => { const Native = window.Audio; window.Audio = class extends Native { constructor(...args) { super(...args); this.muted = true; } }; });
    await context.route(origin + '/**', async route => {
      let file = path.join(dist, new URL(route.request().url()).pathname);
      try { if (!(await fs.stat(file)).isFile()) throw Error(); } catch { file = path.join(dist, 'index.html'); }
      await route.fulfill({ body: await fs.readFile(file), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html' });
    });
    const page = await context.newPage();
    await page.goto(origin);
    await page.getByTestId('home-chart').getByTestId('track-play-control').first().click();
    const dock = page.getByTestId('player-dock');
    await dock.waitFor();
    await page.waitForTimeout(1200);
    const sample = () => page.evaluate(() => {
      const sheet = document.querySelector('[data-testid="now-playing-dismiss-region"]');
      const dock = document.querySelector('[data-testid="player-dock"]');
      return { top: sheet && sheet.getClientRects().length ? Math.round(sheet.getBoundingClientRect().top) : null, dock: !!dock && dock.getBoundingClientRect().height > 0 };
    });
    const record = async action => {
      const samples = [];
      await action();
      for (const end = Date.now() + 1500; Date.now() < end; await page.waitForTimeout(16)) samples.push(await sample());
      return samples;
    };
    const opened = await record(() => dock.getByRole('button', { name: 'Open now playing', exact: true }).click());
    const rising = opened.map(item => item.top).filter(top => top !== null);
    assert.ok(rising[0] > height / 2, 'the sheet starts near the bottom of the screen');
    assert.equal(rising.at(-1), 0, 'the sheet ends at the top');
    assert.ok(rising.every((top, at) => at === 0 || top <= rising[at - 1]), 'the sheet only moves up while opening');
    assert.ok(new Set(rising).size >= 6, 'opening passes through intermediate positions');
    assert.ok(opened.every(item => item.dock), 'the dock stays in place under the opening sheet');
    const closed = await record(() => page.getByRole('button', { name: 'Close', exact: true }).click());
    const falling = closed.map(item => item.top).filter(top => top !== null);
    assert.ok(falling.every((top, at) => at === 0 || top >= falling[at - 1]), 'the sheet only moves down while closing');
    assert.ok(new Set(falling).size >= 6 && falling.at(-1) > height / 2, 'closing passes through intermediate positions to the bottom');
    assert.ok(closed.every(item => item.dock), 'the dock is already in place when the sheet leaves');
    assert.equal(closed.at(-1).top, null, 'the sheet is gone after closing');
    assert.equal(await dock.getByRole('button', { name: 'Open now playing', exact: true }).count(), 1, 'the dock is usable again after closing');
    const rect = id => page.evaluate(name => {
      const node = document.querySelector(`[data-testid="${name}"]`);
      if (!node || !node.getClientRects().length) return null;
      const box = node.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }, id);
    const dockArt = await dock.locator('img').first().boundingBox();
    const box = await dock.boundingBox();
    const cdp = await context.newCDPSession(page);
    const finger = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: box.x + 150, y }] });
    const from = box.y + box.height / 2;
    await finger('touchStart', from);
    const sizes = [];
    for (const stop of [0.25, 0.5, 0.75]) {
      for (let step = 1; step <= 10; step++) { await finger('touchMove', from - box.y * (stop - 0.25 + 0.25 * step / 10)); await page.waitForTimeout(12); }
      await page.waitForTimeout(200);
      const art = await rect('now-playing-flight-art');
      const sheet = await rect('now-playing-dismiss-region');
      assert.ok(art && sheet, 'dragging up from the dock opens the sheet with the artwork in flight');
      assert.ok(Math.abs(sheet.y - box.y * (1 - stop)) < 12, `the sheet follows the finger at ${stop}`);
      sizes.push(art.width);
    }
    assert.ok(sizes[0] > dockArt.width + 20 && sizes[0] < sizes[1] && sizes[1] < sizes[2], 'the artwork grows as the sheet rises');
    await finger('touchEnd');
    await page.waitForFunction(() => (node => node && node.getClientRects().length > 0 && node.getBoundingClientRect().top === 0)(document.querySelector('[data-testid="now-playing-dismiss-region"]')) && !document.querySelector('[data-testid="now-playing-flights"]'), undefined, { timeout: 3000 });
    const full = await page.getByTestId('now-playing-artwork').locator('img').first().boundingBox();
    assert.ok(sizes[2] < full.width, 'the artwork reaches full size only when the sheet is open');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    let last;
    for (const end = Date.now() + 1500; Date.now() < end; await page.waitForTimeout(8)) { const art = await rect('now-playing-flight-art'); if (art) last = art; else if (last) break; }
    assert.ok(last && Math.abs(last.x - dockArt.x) < 12 && Math.abs(last.y - dockArt.y) < 24 && last.width < dockArt.width + 24, 'the artwork lands on the dock artwork when closing');
    await page.getByTestId('now-playing-dismiss-region').waitFor({ state: 'hidden', timeout: 2000 });
    assert.equal(await dock.locator('img').first().evaluate(node => getComputedStyle(node.parentElement.parentElement).opacity), '1', 'the dock artwork is visible again after closing');
    const leaveBy = async (name, role, expected) => {
      await page.goto(origin);
      await page.getByTestId('home-track-row').first().waitFor();
      await dock.getByRole('button', { name: 'Open now playing', exact: true }).click();
      await page.waitForURL('**/now-playing');
      const control = page.getByRole('dialog').getByRole(role, { name }).first();
      await control.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        window.__leaving = [];
        const tick = () => {
          const sheet = document.querySelector('[data-testid="now-playing-dismiss-region"]');
          const shown = !!sheet && sheet.getClientRects().length > 0;
          window.__leaving.push({ path: location.pathname, top: shown ? sheet.getBoundingClientRect().top : null });
          if (window.__leaving.length < 240) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await control.click();
      await page.waitForURL(expected);
      await page.getByTestId('now-playing-dismiss-region').waitFor({ state: 'hidden', timeout: 3000 });
      const frames = await page.evaluate(() => window.__leaving);
      const exposed = frames.filter(frame => frame.path === '/now-playing' && (frame.top === null || frame.top > 8));
      assert.equal(exposed.length, 0, `${name}: the previous page is never uncovered before the destination loads`);
      assert.ok(frames.some(frame => frame.top !== null && frame.top > 40 && frame.path !== '/now-playing'), `${name}: the sheet slides away over the destination`);
    };
    await leaveBy(/^Artist: /, 'link', '**/u/**');
    await leaveBy('Queue', 'button', '**/queue');
    await leaveBy('Open track page', 'button', '**/track/**');
    console.log('393: now playing rises from the dock under the finger, artwork and title fly between the two, it settles both ways, and its links change the page before the sheet leaves');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
