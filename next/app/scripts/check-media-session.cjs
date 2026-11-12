const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');
const origin = 'https://next.plyr.fm';
const dist = path.resolve(__dirname, '../dist');

function recordMediaSession() {
  try { localStorage.setItem('plyr-next:prefs', JSON.stringify({ keepPlaying: true })); } catch { /* storage unavailable */ }
  const handlers = {};
  window.__mediaHandlers = handlers;
  window.__mediaPosition = undefined;
  const session = navigator.mediaSession;
  const set = session.setActionHandler.bind(session);
  session.setActionHandler = (action, handler) => { if (handler) handlers[action] = handler; else delete handlers[action]; set(action, handler); };
  const position = session.setPositionState.bind(session);
  session.setPositionState = state => { window.__mediaPosition = state; position(state); };
  const Native = window.Audio;
  window.__media = [];
  window.Audio = class extends Native { constructor(...args) { super(...args); this.muted = true; window.__media.push(this); } };
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(recordMediaSession);
    if (!process.env.MEDIA_SESSION_LIVE) await context.route(origin + '/**', async route => {
      let file = path.join(dist, new URL(route.request().url()).pathname);
      try { if (!(await fs.stat(file)).isFile()) throw Error(); } catch { file = path.join(dist, 'index.html'); }
      await route.fulfill({ body: await fs.readFile(file), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html' });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const session = () => page.evaluate(() => ({
      state: navigator.mediaSession.playbackState, title: navigator.mediaSession.metadata?.title, artist: navigator.mediaSession.metadata?.artist,
      artwork: navigator.mediaSession.metadata?.artwork.length, handlers: Object.keys(window.__mediaHandlers).sort(), position: window.__mediaPosition,
    }));
    const audio = () => page.evaluate(() => { const media = window.__media.find(item => item.currentSrc && !item.ended) ?? window.__media.at(-1); return { paused: media.paused, time: media.currentTime }; });
    const fire = (action, details = {}) => page.evaluate(([name, extra]) => window.__mediaHandlers[name]({ action: name, ...extra }), [action, details]);

    await page.goto(origin);
    await page.getByTestId('home-track-row').first().waitFor();
    assert.deepEqual((await session()).handlers, [], 'nothing is registered before a track is chosen');
    const rows = page.getByTestId('home-track-row');
    const first = await rows.nth(0).getByRole('link').first().innerText();
    const box = await rows.nth(0).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 20);
    await page.waitForFunction(() => window.__media.some(item => !item.paused && item.currentTime > 0.3), undefined, { timeout: 20_000 });

    let now = await session();
    assert.equal(now.title, first, 'the playing track is the session title');
    assert.ok(now.artist, 'the session names the artist');
    assert.equal(now.state, 'playing');
    assert.deepEqual(now.handlers, ['nexttrack', 'pause', 'play', 'previoustrack', 'seekbackward', 'seekforward', 'seekto'], 'every transport action is registered');
    assert.ok(now.position && now.position.duration > 0, 'position state carries the duration');

    await fire('pause');
    await page.waitForFunction(() => navigator.mediaSession.playbackState === 'paused');
    assert.equal((await audio()).paused, true, 'the pause action pauses the audio');
    await fire('play');
    await page.waitForFunction(() => navigator.mediaSession.playbackState === 'playing');
    assert.equal((await audio()).paused, false, 'the play action resumes the audio');

    const target = Math.min(30, now.position.duration / 2);
    await fire('seekto', { seekTime: target });
    await page.waitForFunction(seconds => window.__media.some(item => Math.abs(item.currentTime - seconds) < 3), target, { timeout: 10_000 });
    const before = (await audio()).time;
    await fire('seekforward', { seekOffset: 10 });
    await page.waitForFunction(seconds => window.__media.some(item => item.currentTime > seconds + 8), before, { timeout: 10_000 });
    await page.waitForFunction(seconds => window.__mediaPosition?.position > seconds + 8, before, { timeout: 5_000 });

    await fire('nexttrack');
    await page.waitForFunction(title => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title !== title, first, { timeout: 20_000 });
    const second = (await session()).title;
    await page.waitForFunction(() => window.__mediaPosition?.position < 3 && window.__media.some(item => !item.paused && item.currentTime > 0.2 && item.currentTime < 3), undefined, { timeout: 20_000 });
    await fire('previoustrack');
    await page.waitForFunction(title => navigator.mediaSession.metadata?.title === title, first, { timeout: 20_000 });
    assert.deepEqual(errors, []);
    console.log(`media session: metadata, playback and position state, and play/pause/seek/skip/next/previous actions passed (${first} → ${second} → ${first})`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
