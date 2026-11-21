const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { tracks, setup, serve, close } = require('./fixture-catalog.cjs');
const { method } = require('./xrpc-fixture.cjs');

async function transition(browser, origin, width, reducedMotion) {
  const phone = width < 600;
  const { context, page, errors } = await setup(browser, width, 844, { phone });
  try {
    await page.emulateMedia({ reducedMotion });
    await page.addInitScript(() => {
      const NativeAudio = window.Audio;
      window.audioElements = [];
      window.Audio = class extends NativeAudio {
        constructor(...args) { super(...args); window.audioElements.push(this); }
      };
    });
    const deliveries = [];
    page.on('request', request => {
      if (method(new URL(request.url())) === 'getPlayback') deliveries.push(request);
    });
    const moreTracks = tracks.map(track => ({ ...track, id: track.id + 'more', metadata: { ...track.metadata, title: 'Later page: ' + track.metadata.title } }));
    await page.route(url => method(url) === 'listTracks' && url.hostname === 'api.next.plyr.fm', route => {
      const more = new URL(route.request().url()).searchParams.has('cursor');
      return route.fulfill({ json: { object: 'list', data: more ? moreTracks : tracks, has_more: !more, next_cursor: more ? null : 'next-page' } });
    });
    await page.goto(origin);
    await page.getByTestId('home-track-row').first().getByRole('button', { name: /^Play / }).click();
    const dock = page.getByTestId('player-dock');
    await dock.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    const opener = dock.getByRole('button', { name: 'Open now playing' });
    const dialog = page.getByRole('dialog', { name: 'Now playing' });
    const panel = page.getByTestId('now-playing-dismiss-region');
    const sampleFrames = () => page.evaluate(() => {
      const frames = [];
      window.playerFrames = frames;
      const tick = () => {
        const sheet = document.querySelector('[data-testid="now-playing-dismiss-region"]');
        const dock = document.querySelector('[data-testid="player-dock"]');
        const art = sheet?.querySelector('[data-testid="now-playing-artwork"]');
        const title = sheet?.querySelector('[data-testid="now-playing-title"]');
        const box = art?.getBoundingClientRect();
        frames.push({
          path: location.pathname,
          top: sheet?.getClientRects().length ? sheet.getBoundingClientRect().top : null,
          dock: dock?.getClientRects().length > 0,
          art: box?.width ? { x: box.x, y: box.y, width: box.width } : null,
          titleScale: title ? new DOMMatrix(getComputedStyle(title).transform).a : null
        });
        if (window.playerFrames === frames && frames.length < 240) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const rest = (await dock.boundingBox()).y;
    await sampleFrames();
    await page.getByTestId('home-track-row').last().scrollIntoViewIfNeeded();
    const pagedTrack = page.getByRole('link', { name: moreTracks[0].metadata.title, exact: true });
    await pagedTrack.scrollIntoViewIfNeeded();
    const homeScroll = await page.evaluate(() => window.scrollY);
    assert.ok(homeScroll > 0, 'the fixture can exercise Home scroll restoration');
    await opener.click();
    await dialog.waitFor();
    const closeButton = dialog.getByRole('button', { name: 'Close', exact: true });
    assert.ok(await dialog.evaluate(node => document.activeElement === node), 'opening focuses the dialog itself');
    assert.equal(await closeButton.evaluate(node => node.matches(':focus-visible')), false, 'opening does not highlight Close');
    await page.keyboard.press('Tab');
    assert.ok(await closeButton.evaluate(node => node.matches(':focus-visible')), 'keyboard navigation still highlights Close');
    await page.waitForFunction(sheet => !sheet.style.transform, await panel.elementHandle());
    const opened = await page.evaluate(() => window.playerFrames.filter(frame => frame.top !== null));
    if (phone && reducedMotion === 'no-preference') {
      const tops = opened.map(frame => Math.round(frame.top));
      assert.ok(tops[0] > rest / 2, 'tap open starts near the dock');
      assert.ok(new Set(tops).size >= 5, 'opening renders intermediate positions');
      assert.ok(tops.every((top, index) => !index || top <= tops[index - 1]));
      assert.ok(opened.every(frame => frame.dock), 'the dock stays rendered under the sheet');
      assert.ok(opened[0].titleScale < 1 && opened.at(-1).titleScale > 0.99, 'the title grows from dock size');
    } else assert.ok(opened.every(frame => Math.abs(frame.top - opened[0].top) < 2), 'the sheet appears at rest');
    const dockArt = await dock.locator('img').first().boundingBox();
    await sampleFrames();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const closed = await page.evaluate(() => window.playerFrames.filter(frame => frame.top !== null));
    if (phone && reducedMotion === 'no-preference') {
      const tops = closed.map(frame => Math.round(frame.top));
      assert.ok(tops.every((top, index) => !index || top >= tops[index - 1]), `closing descends monotonically (${tops.join(', ')})`);
      assert.ok(new Set(tops).size >= 5 && tops.at(-1) > rest / 2);
      const last = closed.at(-1).art;
      assert.ok(last && Math.abs(last.x - dockArt.x) < 12 && Math.abs(last.y - dockArt.y) < 24 && last.width < dockArt.width + 24, 'the cover lands on the dock');
    } else assert.ok(closed.every(frame => Math.abs(frame.top - closed[0].top) < 2), 'the sheet closes without translation');
    await opener.evaluate(node => {
      if (document.activeElement !== node) throw new Error('closing should return focus to the dock');
    });

    if (phone && reducedMotion === 'no-preference') {
      const box = await opener.boundingBox();
      const cdp = await context.newCDPSession(page);
      const from = box.y + box.height / 2;
      const finger = (type, amount) => cdp.send('Input.dispatchTouchEvent', {
        type, touchPoints: type === 'touchEnd' ? [] : [{ x: box.x + 110, y: from - rest * amount }]
      });
      await finger('touchStart', 0);
      await finger('touchMove', 0.12);
      await finger('touchEnd');
      await dialog.waitFor({ state: 'hidden' });
      await finger('touchStart', 0);
      await finger('touchMove', 0.25);
      await dialog.waitFor();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await finger('touchEnd');
      await finger('touchStart', 0);
      const sizes = [];
      for (const stop of [0.25, 0.5, 0.75]) {
        await finger('touchMove', stop);
        await page.waitForFunction(({ expected }) => {
          const sheet = document.querySelector('[data-testid="now-playing-dismiss-region"]');
          return sheet && Math.abs(sheet.getBoundingClientRect().top - expected) < 12;
        }, { expected: rest * (1 - stop) }, { timeout: 3000 });
        sizes.push((await dialog.getByTestId('now-playing-artwork').boundingBox()).width);
      }
      assert.ok(sizes[0] > dockArt.width + 20 && sizes[0] < sizes[1] && sizes[1] < sizes[2], 'art grows as the sheet rises');
      await finger('touchEnd');
      await page.waitForFunction(sheet => !sheet.style.transform, await panel.elementHandle());
      assert.ok((await dialog.getByTestId('now-playing-artwork').boundingBox()).width > sizes[2]);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    }

    await opener.click();
    await dialog.waitFor();
    await page.waitForFunction(sheet => !sheet.style.transform, await panel.elementHandle());
    const destinations = [
      ['replyomatic', `/u/${tracks[0].artist.profile.handle}`],
      ['Open queue', '/queue']
    ];
    // what used to need a detour lives here now; the list had no tags, so they come from the track read
    await dialog.getByTestId('now-playing-tags').waitFor();
    assert.deepEqual(await dialog.getByTestId('now-playing-tags').getByRole('link').allTextContents(), ['ambient', 'home recordings', 'field & nature']);
    assert.equal(await dialog.getByTestId('now-playing-tags').getByRole('link', { name: 'ambient' }).getAttribute('href'), '/?tag=ambient');
    assert.equal(await dialog.getByRole('link', { name: 'about this track' }).count(), 0, 'no detour to the same details');
    for (const [name, destination] of destinations) {
      const source = new URL(page.url()).pathname;
      const link = dialog.getByRole('link', { name, exact: true });
      await link.scrollIntoViewIfNeeded();
      const atRest = (await panel.boundingBox()).y;
      await sampleFrames();
      await link.click();
      await page.waitForURL(origin + destination);
      await dialog.waitFor({ state: 'hidden' });
      const left = await page.evaluate(() => window.playerFrames);
      assert.ok(left.some(frame => frame.path === source), 'observed the source while navigating');
      assert.ok(left.filter(frame => frame.path === source).every(frame => frame.top !== null && frame.top - atRest < 8), 'the previous page remains covered');
      if (phone && reducedMotion === 'no-preference') {
        const exits = left.filter(frame => frame.path === destination && frame.top !== null);
        assert.ok(exits.some(frame => frame.top - atRest > 40), 'the sheet slides over the destination');
        assert.ok(exits.at(-1).top > rest - 24, 'the scrolled sheet reaches the dock before disappearing');
      }
      if (destination !== destinations.at(-1)[1]) {
        await opener.click();
        await dialog.waitFor();
        await page.waitForFunction(sheet => !sheet.style.transform, await panel.elementHandle());
      }
    }
    for (const path of [destinations[0][1], '/']) {
      await page.goBack();
      await page.waitForURL(origin + path);
    }
    await pagedTrack.waitFor();
    await page.waitForFunction(expected => Math.abs(window.scrollY - expected) < 2, homeScroll);
    await dock.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await opener.press('Enter');
    await dialog.waitFor();
    assert.ok(await closeButton.evaluate(node => node === document.activeElement), 'keyboard open retains direct focus on Close');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(deliveries.length, 1, 'no playback delivery refetch');
    assert.equal(await page.evaluate(() => window.audioElements.filter(audio => audio.src).length), 1, 'the same audio element keeps playing');
    assert.deepEqual(errors, []);
    console.log(`${width}px, ${reducedMotion}: player transitions and uninterrupted artist navigation passed`);
  } finally {
    await context.close();
  }
}

(async () => {
  const origin = await serve();
  const browser = await chromium.launch();
  try {
    await transition(browser, origin, 390, 'no-preference');
    await transition(browser, origin, 390, 'reduce');
    await transition(browser, origin, 1280, 'no-preference');
  } finally {
    await browser.close();
    close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
