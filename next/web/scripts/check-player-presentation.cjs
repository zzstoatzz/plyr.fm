const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { tracks, setup, serve, close } = require('./fixture-catalog.cjs');

const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-svelte-player-presentation';

async function verify(browser, origin, width, scheme) {
  const phone = width === 390;
  const height = phone ? 760 : 900;
  const { context, page, errors } = await setup(browser, width, height, { phone: true, scheme, scale: phone && scheme === 'dark' ? 1.5 : 1 });
  try {
    await page.route(url => url.hostname === 'api.next.plyr.fm' && url.pathname === '/v1/tracks', route => route.fulfill({ json: {
      object: 'list', has_more: false, data: [
        { ...tracks[0], metadata: { ...tracks[0].metadata, album: 'Sketches at Dawn', description: 'A recording made at dawn on the porch. '.repeat(80) + '\n\n0:00 morning\n0:25 field\n1:00 porch' } },
        ...tracks.slice(1)
      ]
    } }));
    await page.addInitScript(() => {
      const NativeAudio = window.Audio;
      window.createdAudio = [];
      window.Audio = class extends NativeAudio {
        constructor(...args) { super(...args); window.createdAudio.push(this); }
      };
    });
    await page.goto(origin);
    await page.getByTestId('home-track-row').first().getByRole('button', { name: /^Play / }).click();
    await page.waitForFunction(() => window.createdAudio.some(audio => audio.currentTime > 0 && !audio.paused));
    await page.evaluate(() => { window.playingAudio = window.createdAudio.find(audio => !audio.paused); });
    const dock = page.getByTestId('player-dock');
    const opener = dock.getByRole('button', { name: 'Open now playing' });
    const dialog = page.getByRole('dialog', { name: 'Now playing' });
    const panel = page.getByTestId('now-playing-dismiss-region');
    const hero = page.getByTestId('now-playing-hero');
    const details = page.getByTestId('now-playing-details');
    const artwork = page.getByTestId('now-playing-artwork');
    const hint = page.getByTestId('coachmark');
    const header = page.getByTestId('now-playing-header');
    const condensed = page.getByTestId('now-playing-condensed');
    const slider = dialog.getByRole('slider', { name: 'Playback position', exact: true });
    const waitAtRest = () => page.waitForFunction(() => !document.querySelector('[data-testid="now-playing-dismiss-region"]')?.style.transform);
    const open = async () => { await opener.click(); await dialog.waitFor(); await waitAtRest(); };
    const capture = name => page.screenshot({ path: path.join(output, `${width}-${scheme}-${name}.png`) });
    const drag = await context.newCDPSession(page);
    const touch = (type, points = []) => drag.send('Input.dispatchTouchEvent', {
      type, touchPoints: points.map(([x, y], id) => ({ x, y, id }))
    });
    const setScroll = y => dialog.evaluate((node, scroll) => { node.scrollTop = scroll; }, y);
    const scrollTop = () => dialog.evaluate(node => node.scrollTop);
    const offset = () => panel.evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m42);
    const present = async () => { await waitAtRest(); assert.ok(await dialog.isVisible()); };
    const continuity = async () => {
      const previous = await page.evaluate(() => window.playingAudio.currentTime);
      await page.waitForFunction(before => window.playingAudio.currentTime > before && !window.playingAudio.paused, previous);
      assert.equal(await page.evaluate(() => window.createdAudio.filter(audio => audio.src).length), 1);
    };
    await open();
    await dialog.getByText('now: morning', { exact: true }).waitFor();
    await dialog.getByText(/^−[0-9]+:[0-9]{2}$/).waitFor();
    if (phone) {
      await hint.waitFor();
      const queue = dialog.getByRole('link', { name: 'Open queue' });
      const from = await artwork.boundingBox();
      const [bubble, first, below, queueBox] = await Promise.all([hint.boundingBox(), hero.boundingBox(), details.boundingBox(), queue.boundingBox()]);
      await capture('first-open');
      assert.ok(below.y >= height - 1 && first.y + first.height >= height - 1, 'details start below the fold');
      assert.ok(bubble.y >= queueBox.y + queueBox.height && bubble.y + bubble.height <= height, `the more-below hint fits after the controls: ${JSON.stringify({ bubble, queueBox, height })}`);
      await hint.getByRole('button', { name: 'got it', exact: true }).click();
      await hint.waitFor({ state: 'detached' });
      assert.deepEqual(await artwork.boundingBox(), from, 'dismissing the hint does not move the cover');
      assert.deepEqual(await details.boundingBox(), below, 'dismissing the hint does not move details');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await open();
      assert.equal(await hint.count(), 0, 'a seen hint stays dismissed');

      const headerBox = await header.boundingBox();
      const x = headerBox.x + headerBox.width / 2, y = headerBox.y + headerBox.height / 2;
      await touch('touchStart', [[x, y]]);
      await touch('touchMove', [[x, y + 24]]);
      await page.waitForTimeout(120);
      await touch('touchEnd');
      await present();
      await touch('touchStart', [[x, y]]);
      await touch('touchMove', [[x + 90, y + 24]]);
      await touch('touchMove', [[x + 2, y + 160]]);
      await touch('touchEnd');
      await present();
      await touch('touchStart', [[x, y]]);
      await touch('touchMove', [[x, y + 150]]);
      await page.waitForFunction(() => document.querySelector('[data-testid="now-playing-dismiss-region"]').getBoundingClientRect().top > 100);
      await touch('touchStart', [[x, y + 150], [x + 30, y]]);
      await touch('touchEnd');
      await present();
      await touch('touchStart', [[x, y]]);
      await touch('touchMove', [[x, y + 150]]);
      await touch('touchCancel');
      await present();
      await touch('touchStart', [[x, y]]);
      await touch('touchMove', [[x, y + 150]]);
      await page.setViewportSize({ width, height: height + 30 });
      await touch('touchEnd');
      await present();
      await page.setViewportSize({ width, height });

      const range = await slider.boundingBox();
      const before = await page.evaluate(() => window.playingAudio.currentTime);
      await touch('touchStart', [[range.x + 7, range.y + range.height / 2]]);
      await touch('touchMove', [[range.x + range.width * 0.55, range.y + range.height / 2 + 5]]);
      await touch('touchEnd');
      await page.waitForFunction(previous => window.playingAudio.currentTime > previous + 20, before);
      await present();

      await setScroll(600);
      await condensed.waitFor();
      assert.ok(await condensed.getByRole('button', { name: 'Pause', exact: true }).isVisible());
      await capture('scrolled');
      const flick = async start => {
        await setScroll(start);
        await touch('touchStart', [[10, 260]]);
        for (const distance of [25, 50, 75, 100]) await touch('touchMove', [[10, 260 + distance]]);
        await touch('touchEnd');
        await page.waitForFunction(initial => document.querySelector('dialog.now-sheet').scrollTop < initial - 110, start, { timeout: 1500 });
        await present();
      };
      await flick(950);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await open();
      await flick(250);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await open();
      await setScroll(110);
      await page.waitForFunction(() => document.querySelector('dialog.now-sheet').scrollTop === 110);
      const body = [10, 260];
      await touch('touchStart', [body]);
      await touch('touchMove', [[body[0], body[1] + 50]]);
      const remainingScroll = await scrollTop();
      assert.ok(Math.abs(remainingScroll - 60) <= 8, `a downward content pull first scrolls (scrollTop ${remainingScroll})`);
      assert.equal(await offset(), 0, 'the sheet stays still before reaching the top');
      await touch('touchMove', [[body[0], body[1] + 150]]);
      await page.waitForFunction(() => {
        const sheet = document.querySelector('[data-testid="now-playing-dismiss-region"]');
        const offset = new DOMMatrix(getComputedStyle(sheet).transform).m42;
        return sheet.closest('dialog').scrollTop === 0 && offset >= 30 && offset <= 50;
      });
      await touch('touchMove', [[body[0], body[1] + 220]]);
      await touch('touchEnd');
      await dialog.waitFor({ state: 'hidden' });
      await continuity();
      await open();
      assert.equal(await scrollTop(), 0, 'reopening resets scroll');
    } else {
      const [art, controls] = await Promise.all([artwork.boundingBox(), slider.boundingBox()]);
      assert.ok(art.x + art.width < controls.x, 'desktop artwork and controls sit side by side');
      assert.ok(art.y >= 50 && art.y + art.height <= height, 'long descriptions keep the artwork visible on open');
      assert.deepEqual(await dialog.boundingBox(), { x: 0, y: 0, width, height }, 'desktop player fills the viewport');
      await dialog.getByRole('slider', { name: 'Volume', exact: true }).fill('0.35');
      await page.waitForFunction(() => window.playingAudio.volume === 0.35);
      await capture('wide');
      await setScroll(500);
      await condensed.waitFor();
      const closeBox = await dialog.getByRole('button', { name: 'Close', exact: true }).boundingBox();
      assert.ok(closeBox.x > width - 80, 'Close stays at the top right after scrolling');
      await setScroll(0);
      await condensed.waitFor({ state: 'hidden' });
      const x = art.x + art.width / 2, y = art.y + 20;
      await touch('touchStart', [[x, y]]);
      await touch('touchMove', [[x, y + 180]]);
      await touch('touchEnd');
      await present();
    }
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.ok(await opener.evaluate(node => node === document.activeElement), 'Escape returns focus to the dock');
    await continuity();
    assert.deepEqual(errors, []);
    console.log(`${width}px ${scheme}: player layout, scrub, gesture arbitration, Escape and continued audio passed`);
  } finally {
    await context.close();
  }
}

(async () => {
  const origin = await serve();
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1280]) for (const scheme of ['light', 'dark']) await verify(browser, origin, width, scheme);
  } finally {
    await browser.close();
    close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
