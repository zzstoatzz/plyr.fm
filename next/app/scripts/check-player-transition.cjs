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
      return { top: sheet ? Math.round(sheet.getBoundingClientRect().top) : null, dock: !!dock && dock.getBoundingClientRect().height > 0 };
    });
    const record = async action => {
      const samples = [];
      await action();
      for (const end = Date.now() + 700; Date.now() < end; await page.waitForTimeout(16)) samples.push(await sample());
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
    console.log('393: now playing slides up from and down to a dock that stays in place');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
