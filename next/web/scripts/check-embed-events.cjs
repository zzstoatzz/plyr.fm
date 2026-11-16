const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
process.env.PLAYER_DIST ??= path.resolve(__dirname, '../build');
const { tracks, setup, serve, close } = require('./fixture-catalog.cjs');
const protocol = 'fm.plyr.embed.experimental.v1';
const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-embed-screens';

(async () => {
  await fs.mkdir(output, { recursive: true });
  const origin = process.env.EMBED_SITE_ORIGIN || await serve();
  const host = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><body><iframe title="embed" style="width:600px;height:150px"></iframe></body></html>'); });
  await new Promise(resolve => host.listen(0, '127.0.0.1', resolve));
  const parent = `http://127.0.0.1:${host.address().port}`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const { context, page, errors } = await setup(browser, 1280, 800);
    await context.addInitScript(() => {
      window.media = [];
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { if (!window.media.includes(this)) window.media.push(this); return play.call(this); };
    });
    await page.goto(parent);
    await page.evaluate(({ origin, protocol, id }) => {
      window.messages = [];
      const iframe = document.querySelector('iframe');
      window.addEventListener('message', event => {
        if (event.origin === origin && event.source === iframe.contentWindow && event.data.protocol === protocol) window.messages.push(event.data);
      });
      iframe.src = origin + '/embed/track/' + id;
    }, { origin, protocol, id: tracks[0].id });
    const embed = page.frameLocator('iframe');
    await embed.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.messages.length), 0, 'no unsolicited messages');
    const sourceFrame = page.frames().find(frame => frame.url().includes('/embed/track/'));
    await sourceFrame.evaluate(protocol => window.postMessage({ protocol, type: 'subscribe', subscription: 'not-parent', hz: 10 }, window.location.origin), protocol);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.messages.length), 0, 'reject non-parent window');
    const post = data => page.evaluate(({ origin, data }) => document.querySelector('iframe').contentWindow.postMessage(data, origin), { origin, data });
    await post({ protocol, type: 'subscribe', subscription: 'test', hz: 999 });
    await page.waitForFunction(() => window.messages.some(message => message.state === 'playing'));
    const first = await page.evaluate(() => window.messages.find(message => message.state === 'playing'));
    assert.equal(first.track.uri, tracks[0].record.uri);
    assert.equal(first.analysis, null);
    assert.equal(await page.evaluate(() => window.messages.find(message => message.type === 'ready').hz), 10);
    await embed.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.waitForFunction(() => window.messages.at(-1).state === 'paused');
    await embed.getByRole('slider', { name: 'Playback position' }).fill('10');
    await page.waitForFunction(() => window.messages.at(-1).position >= 9.5);
    assert.ok((await page.evaluate(() => window.messages.at(-1).discontinuity)) > first.discontinuity);
    const child = page.frames().find(frame => frame.url().includes('/embed/track/'));
    await child.evaluate(() => { window.media[0].playbackRate = 1.5; });
    await page.waitForFunction(() => window.messages.at(-1).rate === 1.5);
    const before = await page.evaluate(() => window.messages.length);
    await page.waitForTimeout(520);
    assert.ok((await page.evaluate(() => window.messages.length)) - before <= 6, 'bounded updates');
    await post({ protocol, type: 'unsubscribe', subscription: 'wrong' });
    await page.waitForTimeout(150);
    assert.ok((await page.evaluate(() => window.messages.length)) > before);
    await post({ protocol, type: 'unsubscribe', subscription: 'test' });
    await page.waitForTimeout(150);
    const stopped = await page.evaluate(() => window.messages.length);
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => window.messages.length), stopped);
    await embed.getByRole('button', { name: 'Play', exact: true }).click();
    assert.equal(await child.evaluate(() => window.media[0].paused), false, 'unsubscribe preserves audio');
    await page.screenshot({ path: path.join(output, 'cross-origin-embed.png') });
    const failedPath = `https://api.next.plyr.fm/v1/tracks/${tracks[1].id}/playback`;
    await page.route(failedPath, async route => {
      await new Promise(resolve => setTimeout(resolve, 600));
      await route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } });
    });
    await page.evaluate(({ origin, id }) => {
      window.messages = [];
      document.querySelector('iframe').src = origin + '/embed/track/' + id;
    }, { origin, id: tracks[1].id });
    await embed.getByRole('button', { name: 'Play', exact: true }).waitFor();
    await post({ protocol, type: 'subscribe', subscription: 'test', hz: 10 });
    await embed.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => window.messages.some(message => message.state === 'buffering'));
    await page.waitForFunction(() => window.messages.at(-1).state === 'error');
    await page.unroute(failedPath);
    await embed.getByRole('button', { name: 'Retry playback' }).click();
    await page.waitForFunction(() => window.messages.at(-1).state === 'playing');
    const replacement = await page.evaluate(() => window.messages.at(-1));
    assert.equal(replacement.track.uri, tracks[1].record.uri);
    assert.notEqual(replacement.instance, first.instance);
    assert.deepEqual(errors, []);
    await context.close();

    for (const width of [390, 1280]) for (const scheme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/experiments/embed');
      const audioFrame = page.frameLocator('iframe');
      await audioFrame.locator('audio').waitFor();
      await audioFrame.locator('audio').evaluate(audio => audio.play());
      await page.getByRole('status').filter({ hasText: 'playing' }).waitFor();
      await audioFrame.getByRole('button', { name: 'enable live comparison' }).click();

      await page.waitForFunction(() => Number(document.querySelectorAll('output')[1].textContent) > 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(output, `experiment-${width}-${scheme}.png`), fullPage: true });
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('cross-origin handshake, bounded updates, pause, seek, rate, teardown, unchanged playback and two consumers passed');
  } finally { await browser.close(); host.close(); close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
