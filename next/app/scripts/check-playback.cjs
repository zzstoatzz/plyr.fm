const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const runAccounting = require('./check-playback-accounting.cjs');
const runRadioAccounting = require('./check-radio-accounting.cjs');
const runShortPlayback = require('./check-short-playback.cjs');
const runSurfaces = require('./check-playback-surfaces.cjs');

const started = performance.now();
const origin = process.env.PLAYBACK_URL || 'https://next.plyr.fm';
const track = process.env.PLAYBACK_TRACK || 'trk_YXQ6Ly9kaWQ6cGxjOjZwbWJzbndlcm1haHYzcnBqaWxrcmd4by9mbS5wbHlyLnRyYWNrLzNtemNycWdoNDJxMjI';
const output = path.resolve(process.env.PLAYBACK_OUTPUT || `/tmp/plyr-next-playback-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const requireFrontend = createRequire(path.resolve(__dirname, '../../../frontend/package.json'));
const playwright = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : requireFrontend('playwright');
const browserName = process.env.PLAYBACK_BROWSER || 'chromium';
const reports = [];
const mediaState = () => window.__plyrPlaybackMedia.map(audio => ({
  playing: !audio.paused, time: audio.currentTime, duration: audio.duration,
  ready: audio.readyState, seeking: audio.seeking, error: audio.error?.code,
}));

async function prepareContext(context, theme) {
  if (process.env.PLAYBACK_DIST) {
    const root = path.resolve(process.env.PLAYBACK_DIST);
    await context.route(origin + '/**', async route => {
      const candidate = path.join(root, new URL(route.request().url()).pathname);
      const exists = await fs.stat(candidate).then(stat => stat.isFile(), () => false);
      await route.fulfill({ path: exists ? candidate : path.join(root, 'index.html') });
    });
  }
  await context.addInitScript(selected => localStorage.setItem('plyr-next:prefs', JSON.stringify({ theme: selected })), theme);
  await context.addInitScript(() => {
    window.__plyrPlaybackMedia = [];
    window.__plyrPlaybackEvents = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      if (!window.__plyrPlaybackMedia.includes(this)) {
        window.__plyrPlaybackMedia.push(this);
        for (const type of ['playing', 'pause', 'waiting', 'seeking', 'seeked', 'ended', 'error']) {
          this.addEventListener(type, () => window.__plyrPlaybackEvents.push({ type, at: performance.now(), position: this.currentTime, error: this.error?.code }));
        }
      }
      return play.apply(this, args);
    };
  });
}

async function run(browser, width, theme) {
  const runStarted = performance.now();
  const name = `${browserName}-${width}-${theme}`;
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: theme });
  await prepareContext(context, theme);
  const page = await context.newPage();
  page.setDefaultTimeout(40_000);
  const report = { name, timingsMs: {}, requests: [], requestFailures: [], consoleErrors: [], playbackLogs: [], media: [], screenshots: [] };
  reports.push(report);
  const requestStart = new Map();
  page.on('request', request => {
    if (request.resourceType() === 'fetch' || /\/v1\//.test(request.url())) requestStart.set(request, performance.now());
  });
  page.on('response', response => {
    const request = response.request();
    if (!requestStart.has(request)) return;
    const url = new URL(request.url());
    report.requests.push({ method: request.method(), host: url.host, path: url.pathname, status: response.status(), elapsedMs: Math.round(performance.now() - requestStart.get(request)) });
  });
  page.on('requestfailed', request => {
    const url = new URL(request.url());
    report.requestFailures.push({ host: url.host, path: url.pathname, error: request.failure()?.errorText });
  });
  page.on('pageerror', error => report.consoleErrors.push(error.message));
  page.on('console', message => {
    if (/\[playback\]|\[play/.test(message.text())) report.playbackLogs.push(message.text());
  });
  async function timed(label, action) {
    const before = performance.now();
    await action();
    report.timingsMs[label] = Math.round(performance.now() - before);
  }
  async function screenshot(label) {
    await page.waitForTimeout(400);
    const file = `${name}-${label}.png`;
    await page.screenshot({ path: path.join(output, file), fullPage: false });
    report.screenshots.push(file);
  }
  try {
    await timed('homeReady', async () => {
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.locator(`a[href="/track/${track}"]`).first().waitFor();
    });
    await screenshot('home');
    await timed('homeToTrack', async () => {
      await page.locator(`a[href="/track/${track}"]`).first().click();
      await page.getByRole('button', { name: 'Play', exact: true }).first().waitFor();
    });
    await screenshot('track');
    await timed('tapToAudibleProgress', async () => {
      await page.getByRole('button', { name: 'Play', exact: true }).first().click();
      await page.waitForFunction(() => window.__plyrPlaybackMedia.some(audio => !audio.paused && audio.currentTime > 0.15 && audio.readyState >= 2));
    });
    await timed('openNowPlaying', async () => {
      await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
      await page.getByRole('heading', { name: 'Now playing', exact: true }).waitFor();
      await page.getByRole('slider', { name: 'Playback position', exact: true }).waitFor();
    });
    await screenshot('now-playing');
    await timed('pause', async () => {
      await page.getByRole('button', { name: 'Pause', exact: true }).last().click();
      await page.waitForFunction(() => window.__plyrPlaybackMedia.every(audio => audio.paused));
    });
    await timed('seek', async () => {
      const slider = page.getByRole('slider', { name: 'Playback position', exact: true });
      const box = await slider.boundingBox();
      assert.ok(box, 'The playback slider must have geometry');
      await slider.click({ position: { x: box.width * 0.2, y: box.height / 2 } });
      await page.waitForFunction(() => window.__plyrPlaybackMedia.some(audio => audio.currentTime > 1));
    });
    await timed('resume', async () => {
      await page.getByRole('button', { name: 'Play', exact: true }).last().click();
      await page.waitForFunction(() => window.__plyrPlaybackMedia.some(audio => !audio.paused));
    });
    if (process.env.PLAYBACK_EXPECT_RECEIPT === '1') {
      const response = await page.waitForResponse(response => /\/v1\/tracks\/[^/]+\/plays/.test(response.url()) && response.ok(), { timeout: 40_000 });
      report.receipt = await response.json();
      assert.equal(report.receipt.object, 'play_receipt');
    }
    report.media = await page.evaluate(mediaState);
    report.mediaEvents = await page.evaluate(() => window.__plyrPlaybackEvents);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await screenshot('resumed');
    await timed('retryAfter503', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Play', exact: true }).first().waitFor();
      let rejected = false;
      await page.route(`**/v1/tracks/${track}/playback`, async route => {
        if (rejected) return route.continue();
        rejected = true;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Injected playback retry check' } }) });
      });
      await page.getByRole('button', { name: 'Play', exact: true }).first().click();
      await page.getByRole('button', { name: 'Open now playing', exact: true }).waitFor();
      await page.getByText('Couldn’t play this track', { exact: true }).waitFor();
      await screenshot('retry');
      await page.getByRole('button', { name: 'Play', exact: true }).first().click();
      await page.waitForFunction(() => window.__plyrPlaybackMedia.some(audio => !audio.paused && audio.currentTime > 0.15));
      assert.equal(rejected, true);
    });
    assert.deepEqual(report.consoleErrors, [], 'No uncaught JavaScript errors');
    report.result = 'passed';
  } catch (error) {
    report.result = 'failed';
    report.error = error.stack;
    await screenshot('failure').catch(() => {});
    throw error;
  } finally {
    report.wallMs = Math.round(performance.now() - runStarted);
    await context.close();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ origin, track, totalMs: Math.round(performance.now() - started), reports }, null, 2));
    console.log(JSON.stringify({ name, result: report.result, timingsMs: report.timingsMs, requests: report.requests.length }));
  }
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const options = browserName === 'chromium' ? { channel: process.env.PLAYBACK_CHROMIUM_CHANNEL || 'chrome' } : {};
  if (process.env.PLAYBACK_EXECUTABLE) options.executablePath = process.env.PLAYBACK_EXECUTABLE;
  const browser = await playwright[browserName].launch(options);
  console.log(`Browser ready in ${Math.round(performance.now() - started)}ms`);
  try {
    const environment = { browser, browserName, prepareContext, origin, track, output, reports, started };
    if (process.env.SHORT_PLAYBACK === '1') await runShortPlayback(environment);
    const matrix = process.env.PLAYBACK_QUICK === '1' ? [[390, 'dark']] : [[390, 'light'], [390, 'dark'], [1280, 'light'], [1280, 'dark']];
    for (const [width, theme] of matrix) await run(browser, width, theme);
    if (process.env.RADIO_ACCOUNTING === '1') await runRadioAccounting(environment);
    if (process.env.PLAYBACK_SURFACES === '1') await runSurfaces(environment);
    if (process.env.ACCOUNTING === '1' || process.env.PLAYBACK_ACCOUNTING === '1') await runAccounting(environment);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
