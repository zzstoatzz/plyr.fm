const assert = require('node:assert/strict');
const path = require('node:path');
const { tracks, setup } = require('./fixture-catalog.cjs');

// Drags a finger down the page with CDP touch events, since Playwright only taps.
async function drag(page, cdp, distance, steps = 12, hold) {
  const x = 200, y = 220;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + distance * i / steps }] });
    await page.waitForTimeout(16);
  }
  if (hold) await hold();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function homePullRefresh(browser, origin, output) {
  for (const scheme of ['light', 'dark']) {
    const { context, page, errors } = await setup(browser, 390, 844, { phone: true, scheme });
    try {
      const fresh = { ...tracks[1], id: tracks[1].id + '-fresh', metadata: { ...tracks[1].metadata, title: 'a brand new upload' } };
      let reads = 0;
      await page.route(/^https:\/\/api\.next\.plyr\.fm\/xrpc\/fm\.plyr\.unspecced\.listTracks(?:\?|$)/, route => {
        if (new URL(route.request().url()).searchParams.has('cursor')) return route.fallback();
        reads++;
        return route.fulfill({ json: { data: reads > 1 ? [fresh, ...tracks.slice(0, 3)] : tracks.slice(0, 3), has_more: false } });
      });
      await page.goto(origin);
      const rows = page.getByTestId('home-track-row');
      await rows.first().waitFor();
      const cdp = await context.newCDPSession(page);
      const content = page.getByTestId('pull-refresh').locator('> .content');
      const shift = () => content.evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m42);

      await drag(page, cdp, 40);
      await page.waitForTimeout(500);
      assert.equal(reads, 1, 'a short pull springs back without refreshing');
      assert.equal(await shift(), 0, 'the page settles back to the top');

      await drag(page, cdp, 220, 16, async () => {
        assert.ok(await shift() > 60, 'the page follows the finger down');
        await page.screenshot({ path: path.join(output, `390-${scheme}-pull-refresh.png`), clip: { x: 0, y: 0, width: 390, height: 300 } });
      });
      await page.getByRole('status').filter({ hasText: '1 new track' }).waitFor();
      assert.equal(reads, 2, 'letting go past the line refreshes once');
      await rows.first().getByRole('link', { name: 'a brand new upload', exact: true }).waitFor();
      assert.equal(await rows.count(), 4);
      await page.waitForFunction(() => {
        const node = document.querySelector('[data-testid="pull-refresh"] > .content');
        return node && !node.style.transform;
      }, undefined, { timeout: 4000 });

      await drag(page, cdp, 220);
      await page.getByRole('status').filter({ hasText: 'up to date' }).waitFor();
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
}

module.exports = homePullRefresh;
