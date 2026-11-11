const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const origin = 'https://next.plyr.fm';
const dist = process.env.PLAYBACK_DIST;

function gateMediaLoading() {
  const Native = window.Audio;
  const held = [];
  let activated = false;
  window.__restoreMedia = [];
  window.Audio = function (source) {
    const audio = new Native();
    if (!activated) { audio.preload = 'none'; held.push(audio); }
    if (source) audio.src = source;
    window.__restoreMedia.push(audio);
    return audio;
  };
  window.Audio.prototype = Native.prototype;
  addEventListener('pointerdown', () => {
    activated = true;
    for (const audio of held.splice(0)) { audio.preload = 'auto'; audio.load(); }
  }, true);
}

(async () => {
  assert.ok(dist, 'set PLAYBACK_DIST to an exported web build');
  const feed = await (await fetch('https://api.next.plyr.fm/v1/tracks?limit=1')).json();
  const track = feed.data[0].id;
  const browser = await playwright.chromium.launch({ headless: true, channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(gateMediaLoading);
  await context.route(origin + '/**', async route => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    let file = path.join(dist, pathname);
    try { if (!(await fs.stat(file)).isFile()) throw new Error(); } catch { file = path.join(dist, 'index.html'); }
    const type = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2' }[path.extname(file)] ?? 'text/html';
    await route.fulfill({ body: await fs.readFile(file), contentType: type });
  });
  const page = await context.newPage();
  let resolved = 0;
  page.on('request', request => { if (/\/v1\/tracks\/[^/]+\/playback$/.test(new URL(request.url()).pathname)) resolved++; });
  const dock = page.getByTestId('player-dock');
  const clock = async () => {
    const [minutes, seconds] = (await dock.getByText(/^\d+:\d\d$/).first().innerText()).split(':').map(Number);
    return minutes * 60 + seconds;
  };
  try {
    await page.goto(`${origin}/track/${track}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Play', exact: true }).first().click();
    await page.waitForFunction(() => window.__restoreMedia.some(audio => !audio.paused && audio.currentTime > 0.5), undefined, { timeout: 20_000 });
    const slider = dock.getByRole('slider', { name: 'Playback position' });
    const box = await slider.boundingBox();
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);
    await page.waitForFunction(() => window.__restoreMedia.some(audio => !audio.paused && audio.currentTime > 8), undefined, { timeout: 20_000 });
    await dock.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.waitForTimeout(500);
    const saved = await clock();
    assert.ok(saved >= 8, `a seek moved playback forward before the reload (${saved}s)`);

    resolved = 0;
    await page.reload({ waitUntil: 'domcontentloaded' });
    const play = dock.getByRole('button', { name: 'Play', exact: true });
    await play.waitFor({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    assert.equal(await play.isEnabled(), true, 'the restored track is ready to play without waiting for audio');
    assert.equal(await dock.getByLabel('Loading playback').count(), 0, 'a restored track shows no loading indicator');
    assert.ok(Math.abs(await clock() - saved) <= 1, 'the restored track shows its saved position');
    assert.equal(resolved, 0, 'restoring a paused track requests no audio');
    assert.equal(await page.evaluate(() => window.__restoreMedia.filter(audio => audio.currentSrc).length), 0, 'restoring a paused track attaches no audio source');

    await play.click();
    await page.waitForFunction(() => window.__restoreMedia.some(audio => !audio.paused && audio.currentTime > 0), undefined, { timeout: 20_000 });
    const resumed = await page.evaluate(() => Math.max(...window.__restoreMedia.filter(audio => !audio.paused).map(audio => audio.currentTime)));
    assert.ok(resumed >= saved - 1 && resumed < saved + 5, `playback resumes from the saved position (${resumed}s after ${saved}s)`);
    assert.equal(resolved, 1, 'pressing play resolves the audio once');
    console.log(JSON.stringify({ track, saved, resumed, result: 'passed' }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.stack); process.exit(1); });
