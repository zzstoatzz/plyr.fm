const path = require('node:path');
const { chromium } = require('playwright');

const fixtureFile = require.resolve('./fixture-catalog.cjs');
const build = path.resolve(process.argv[2] || path.join(__dirname, '../build'));
const repeats = Number(process.env.PERF_RUNS || 3);
if (!Number.isInteger(repeats) || repeats < 1) throw new Error('PERF_RUNS must be a positive integer');

process.env.PLAYER_DIST = build;
const fixture = require(fixtureFile);

function trackPerformance() {
  const stats = window.plyrPerformance = { lcp: 0, cls: 0, blockingMs: 0, audio: new Set() };
  const observe = (type, callback) => new PerformanceObserver(list => {
    for (const entry of list.getEntries()) callback(entry);
  }).observe({ type, buffered: true });
  observe('largest-contentful-paint', entry => { stats.lcp = entry.startTime; });
  let start = -Infinity, last = -Infinity, sum = 0;
  observe('layout-shift', entry => {
    if (entry.hadRecentInput) return;
    if (entry.startTime - last > 1000 || entry.startTime - start > 5000) {
      start = entry.startTime;
      sum = 0;
    }
    sum += entry.value;
    last = entry.startTime;
    stats.cls = Math.max(stats.cls, sum);
  });
  observe('longtask', entry => { stats.blockingMs += Math.max(0, entry.duration - 50); });
  window.Audio = class extends Audio {
    constructor(...args) {
      super(...args);
      stats.audio.add(this);
    }
  };
}

async function sample(browser, origin, width) {
  const phone = width === 390;
  const { context, page } = await fixture.setup(browser, width, phone ? 844 : 900, { phone });
  await context.addInitScript(trackPerformance);
  try {
    const cdp = await context.newCDPSession(page);
    if (phone) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false, latency: 120, downloadThroughput: 200_000, uploadThroughput: 93_750
      });
    }
    await page.goto(origin, { waitUntil: 'commit' });
    const row = page.getByTestId('home-track-row').first();
    await row.waitFor();
    const homeTrackMs = await page.evaluate(() => performance.now());
    // Collect late layout shifts before interacting with the page.
    await page.waitForTimeout(750);
    const home = await page.evaluate(() => {
      const { lcp, cls, blockingMs } = window.plyrPerformance;
      const jsBytes = performance.getEntriesByType('resource')
        .filter(item => new URL(item.name).pathname.endsWith('.js'))
        .reduce((total, item) => total + item.encodedBodySize, 0);
      return { lcp, cls, blockingMs, jsBytes };
    });
    const track = row.locator('a[href^="/track/"]').first();
    const href = await track.getAttribute('href');
    const play = page.getByRole('button', { name: 'Play', exact: true }).filter({ visible: true }).first();
    const now = () => page.evaluate(() => performance.timeOrigin + performance.now());
    const navStart = await now();
    await track.click();
    await page.waitForURL(url => url.pathname === href);
    await play.waitFor();
    const trackPageMs = await now() - navStart;
    const playStart = await now();
    await play.click();
    await page.waitForFunction(() => [...document.querySelectorAll('audio'), ...window.plyrPerformance.audio]
      .some(audio => !audio.paused && audio.currentTime > 0.01));
    const playMs = await now() - playStart;
    return { ...home, homeTrackMs, trackPageMs, playMs };
  } finally { await context.close(); }
}

(async () => {
  const origin = await fixture.serve();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    for (const width of [390, 1280]) {
      const samples = [];
      for (let i = 0; i < repeats; i++) samples.push(await sample(browser, origin, width));
      const median = Object.fromEntries(Object.keys(samples[0]).map(key => {
        const values = samples.map(sample => sample[key]).sort((a, b) => a - b);
        const middle = Math.floor(values.length / 2);
        return [key, values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2];
      }));
      console.log(JSON.stringify({ build, width, samples, median }));
    }
  } finally { await browser.close(); fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
