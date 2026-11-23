const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { atlas, tracks, setup, serve, close } = require('./fixture-catalog.cjs');

const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-svelte-atlas';
const [track] = tracks;
const [point] = atlas.points;

async function verify(browser, origin, width) {
  const phone = width === 390;
  const { context, page, errors } = await setup(browser, width, 844, { phone, scheme: phone ? 'dark' : 'light' });
  let reads = 0;
  let selections = 0;
  let releaseLookup;
  const heldLookup = new Promise(resolve => { releaseLookup = resolve; });
  try {
    await page.route('https://api.next.plyr.fm/xrpc/fm.plyr.unspecced.getAtlas', route => {
      reads++;
      return phone && reads === 1 ? route.fulfill({ status: 503 }) : route.fulfill({ json: atlas });
    });
    await page.route('https://api.next.plyr.fm/xrpc/fm.plyr.unspecced.getTrack?legacyId=19', async route => {
      selections++;
      if (!phone && selections === 1) {
        await heldLookup;
        return route.fulfill({ json: track }).catch(() => {});
      }
      return route.fulfill({ json: track });
    });
    if (!phone) await page.setViewportSize({ width, height: 1 });
    await page.goto(origin);
    await page.getByTestId('home-track-row').first().waitFor();
    if (!phone) assert.ok((await page.getByTestId('home-atlas').boundingBox()).y > 33, 'the tile starts outside the viewport and its 32px lazy-load margin');
    assert.equal(reads, 0, 'Home leaves the atlas unloaded until its desktop tile approaches the viewport');
    const canvas = page.getByLabel('Catalog atlas');
    if (phone) {
      assert.equal(await page.getByTestId('home-atlas').isVisible(), false);
      await page.getByRole('button', { name: 'Open links menu' }).click();
      await page.getByRole('navigation', { name: 'Explore' }).getByRole('link', { name: 'atlas', exact: true }).click();
      await page.getByRole('alert').getByText('could not load the atlas.').waitFor();
      await page.getByRole('button', { name: 'try again' }).press('Enter');
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Catalog atlas');
    } else {
      assert.equal(await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'atlas', exact: true }).getAttribute('href'), '/atlas');
      await page.setViewportSize({ width, height: 844 });
      const tile = page.getByRole('link', { name: 'Open the atlas, 1 track · 1 region · 1 cluster' });
      await tile.waitFor();
      assert.equal(reads, 1, 'the desktop tile warms the shared catalog once visible');
      await page.screenshot({ path: path.join(output, '1280-home-atlas.png') });
      await tile.click();
    }
    await page.getByText('1 track · 1 region · 1 cluster', { exact: true }).waitFor();
    const box = await canvas.boundingBox();
    assert.ok(box && box.width > 300 && box.height > 400);
    // the fit keeps the catalog clear of the floating title and the bottom controls (and phone tabs/dock)
    const [top, under] = await page.evaluate(() => [document.querySelector('.atlas header').clientHeight, document.querySelector('.atlas .under').clientHeight]);
    const cap = px => Math.min(px, box.height / 3);
    const position = { x: box.width / 2, y: box.height / 2 + (cap(top) - cap(under + 64)) / 2 };
    const frame = await page.getByTestId('app-frame').boundingBox();
    const nav = await page.getByRole('navigation', { name: 'Main navigation' }).boundingBox();
    assert.ok(Math.abs(box.y) < 1, 'the atlas starts at the top of the page');
    if (phone) assert.ok(Math.abs(box.width - width) < 1 && Math.abs(box.height - 844) < 1, 'phones get the whole screen under the floating chrome');
    else assert.ok(Math.abs(box.x - (nav.x + nav.width)) < 1 && Math.abs(box.x + box.width - (frame.x + frame.width)) < 1, 'the atlas runs from the nav to the window edge');
    if (phone) {
      await canvas.tap({ position });
      await canvas.tap({ position });
    } else {
      await page.clock.install();
      await canvas.hover({ position });
      await page.getByText(point.title, { exact: true }).waitFor();
      await canvas.click({ position });
      await page.getByRole('status').getByText(/^starting /).waitFor();
      await page.clock.fastForward(10_001);
      await page.getByRole('status').getByText('could not play this track from the atlas. select it to try again.').waitFor();
      releaseLookup();
      await canvas.click({ position });
    }
    const dock = page.getByTestId('player-dock');
    await dock.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    assert.equal(selections, phone ? 1 : 2, 'track playback uses the resolved Next identity');
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await canvas.press('ArrowRight');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await page.screenshot({ path: path.join(output, width + '-atlas.png') });
    await page.goBack();
    await page.getByTestId('home-track-row').first().waitFor();
    await page.goForward();
    await page.getByRole('button', { name: 'Zoom in' }).waitFor();
    assert.equal(reads, phone ? 2 : 1, 'returning to the atlas uses the loaded catalog');
    await dock.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(`${width}px: atlas navigation, retry, point playback, zoom and cache passed`);
  } finally {
    releaseLookup();
    await context.close();
  }
}

(async () => {
  const origin = await serve();
  const browser = await chromium.launch();
  try { for (const width of [390, 1280]) await verify(browser, origin, width); }
  finally { await browser.close(); close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
