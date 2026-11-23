// The playing bars follow the audio: once a measured track plays, every bars
// icon that tracks this page's playback takes its heights from the track's
// levels, and someone else's listening keeps the canned motion.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fixture = require('./fixture-catalog.cjs');

(async () => {
  const origin = await fixture.serve();
  const browser = await chromium.launch();
  try {
    for (const [width, phone] of [[1280, false], [390, true]]) {
      const { context, page, errors } = await fixture.setup(browser, width, 900, { phone });
      await page.goto(origin + '/');
      const row = page.locator('[data-track-id]').filter({ has: page.getByTestId('track-play-control') }).first();
      await row.getByTestId('track-play-control').click();
      await page.waitForFunction(() => 'liveWave' in document.documentElement.dataset, null, { timeout: 15_000 });
      const read = () => page.evaluate(() => [0, 1, 2, 3].map(bar => Number(getComputedStyle(document.documentElement).getPropertyValue(`--wave-${bar}`))));
      const first = await read();
      await page.waitForTimeout(700);
      const later = await read();
      assert.ok(first.every(height => height >= 0.17 && height <= 1), `heights stay in range: ${first}`);
      assert.notDeepEqual(first, later, 'heights move while the track plays');
      const bars = row.locator('.playing-wave.live i').first();
      assert.equal(await bars.evaluate(bar => getComputedStyle(bar).animationName), 'none', 'a following icon drops its canned motion');

      await row.getByTestId('track-play-control').click();
      await page.waitForFunction(() => !('liveWave' in document.documentElement.dataset), null, { timeout: 10_000 });
      assert.deepEqual(errors, []);
      console.log(`playing levels ok at ${width}px`);
      await context.close();
    }
  } finally {
    await browser.close();
    fixture.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
