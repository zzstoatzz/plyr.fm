const { runDesktop } = require('./desktop-player-check.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { createRequire } = require('node:module');
const path = require('node:path');
const requireFrontend = createRequire(path.resolve(__dirname, '../../../frontend/package.json'));
const { chromium, webkit } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : requireFrontend('playwright');
const dist = process.env.PLAYER_DIST || path.resolve(__dirname, '../dist');
const output = process.env.PLAYER_OUTPUT || '/tmp/plyr-player-presentation';
fs.mkdirSync(output, { recursive: true });
const uri = 'at://did:plc:fixture/fm.plyr.track/player-presentation';
const track = {
  object: 'track', id: 'trk_' + Buffer.from(uri).toString('base64url'),
  record: { uri, cid: 'fixture', revision: null, collection: 'fm.plyr.track', rkey: 'player-presentation' },
  metadata: { title: 'acoustic guitar cover of vodka cranberry (one take)', description: 'A quiet recording from one afternoon.\n\n0:00 tuning\n0:40 first verse\n1:50 chorus', album: 'A quiet room', duration_seconds: 236, created_at: '2026-11-04T00:00:00Z' },
  artist: { did: 'did:plc:fixture', profile: { handle: 'fixture.test', display_name: 'jack', avatar_url: null } },
  media: { artwork: { url: 'https://player-fixture.invalid/cover.jpg' } }, access: { visibility: 'public' }, metrics: { play_count: 12, like_count: 7 }
};
const mediaUrl = 'https://player-fixture.invalid/audio.wav';
const audio = Buffer.alloc(44 + 8000 * 236 * 2);
audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
const coverPath = process.env.PLAYER_COVER || '/tmp/player-presentation-cover.jpg';
const server = http.createServer((request, response) => {
  let filename = path.join(dist, decodeURIComponent(request.url.split('?')[0]));
  if (!fs.existsSync(filename) || fs.statSync(filename).isDirectory()) filename = path.join(dist, 'index.html');
  response.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.json') ? 'application/json' : 'text/html');
  response.end(fs.readFileSync(filename));
});
let origin;
const screenshot = (page, name) => page.screenshot({ path: path.join(output, `${name}.png`) });

async function setup(browser, width, theme, selected = track, scale = 1, height = 900) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, colorScheme: theme });
  if (process.env.PLAYER_FORCE_FALLBACK) await context.addInitScript(() => {
    const supports = CSS.supports.bind(CSS);
    CSS.supports = (...args) => args.join(' ').includes('pan-down') ? false : supports(...args);
  });
  await context.addInitScript(({ theme, scale }) => localStorage.setItem('plyr-next:prefs', JSON.stringify({ theme, scale, playThrough: true })), { theme, scale });
  await context.route('**/*', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort());
  await context.route('https://player-fixture.invalid/**', async route => {
    if (route.request().url().endsWith('/cover.jpg')) {
      if (fs.existsSync(coverPath)) await route.fulfill({ body: fs.readFileSync(coverPath), contentType: 'image/jpeg' });
      else await route.abort();
      return;
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
    const body = audio.subarray(start, end + 1);
    await route.fulfill({ status: range ? 206 : 200, body, headers: {
      'content-type': 'audio/wav', 'content-length': String(body.length), 'accept-ranges': 'bytes',
      'access-control-allow-origin': '*', ...(range ? { 'content-range': `bytes ${start}-${end}/${audio.length}` } : {})
    } });
  });
  await context.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) { window.__playerPresentationMedia = this; return play.apply(this, args); };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://api.next.plyr.fm/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { await route.abort(); return; }
    let body = {};
    if (url.pathname.endsWith('/playback')) body = { object: 'playback', track_id: selected.id, record: selected.record,
      availability: { status: 'available', delivery: { url: mediaUrl, media_type: 'audio/wav' } } };
    else if (url.pathname.startsWith('/v1/artists/') && url.pathname.endsWith('/metrics')) body = { totals: { plays: 12, tracks: 1, duration_seconds: 236 }, top_track: null };
    else if (url.pathname.startsWith('/v1/artists/')) body = { object: 'artist', did: selected.artist.did, handle: 'fixture.test', display_name: 'jack', bio: null, avatar_url: null, support_url: null };
    else if (url.pathname === '/v1/albums' || url.pathname === '/v1/playlists') body = { object: 'list', data: [], has_more: false };
    else if (url.pathname.endsWith('/likes')) body = { object: 'list', data: [], has_more: false };
    else if (url.pathname === '/v1/tracks/' + selected.id) body = selected;
    else if (url.pathname === '/v1/tags') body = { object: 'list', data: [], has_more: false };
    else if (url.pathname === '/v1/tracks') body = { object: 'list', data: [selected], has_more: false };
    else if (url.pathname === '/v1/charts/tracks') body = { period: 'week', data: [] };
    await route.fulfill({ json: body });
  });
  await page.goto(origin + '/track/' + selected.id);
  await page.getByRole('button', { name: 'Add to queue', exact: true }).waitFor();
  await page.waitForTimeout(150);
  return { context, page, errors };
}

async function plainControls(page) {
  const controls = page.getByRole('button', { name: /^(Play|Pause)$/ });
  for (const control of await controls.all()) {
    const style = await control.evaluate(node => ({ background: getComputedStyle(node).backgroundColor,
      border: getComputedStyle(node).borderWidth, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }));
    assert.equal(style.background, 'rgba(0, 0, 0, 0)');
    assert.equal(style.border, '0px');
    assert.ok(style.width >= 44 && style.height >= 44);
  }
}

async function gesture(page, cdp, start, dx, dy, { cancel = false, wait = 25, steps = 12, resize = false } = {}) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y, id: 1 }] });
  for (let step = 1; step <= steps; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + dx * step / steps, y: start.y + dy * step / steps, id: 1 }] });
    if (wait) await page.waitForTimeout(wait);
  }
  if (resize) { await page.setViewportSize({ width: 430, height: 900 }); await page.waitForTimeout(150); }
  await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(550);
}

async function twoFingerCancel(page, cdp, start) {
  const finger = (id, dy, dx = 0) => ({ x: start.x + dx, y: start.y + dy, id });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger(1, 0)] });
  for (const dy of [20, 45, 80]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [finger(1, dy)] });
    await page.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger(1, 80), finger(2, 80, 30)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [finger(1, 160), finger(2, 160, 30)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(550);
}

async function run(browser, width, theme) {
  const { context, page, errors } = await setup(browser, width, theme);
  const name = `${width}-${theme}`;
  try {
    await plainControls(page);
    await screenshot(page, name + '-track');
    const like = page.getByRole('button', { name: 'See 7 likes' });
    const queue = page.getByRole('button', { name: 'Add to queue', exact: true });
    const play = page.getByRole('button', { name: 'Play', exact: true });
    const geometry = await Promise.all([page.getByTestId('track-like-controls').boundingBox(), play.boundingBox(), queue.boundingBox()]);
    assert.ok(Math.abs((geometry[1].x + geometry[1].width / 2) - (geometry[0].x + geometry[0].width / 2 + geometry[2].x + geometry[2].width / 2) / 2) < 2);
    await like.click();
    await page.getByText('liked by', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await play.click();
    await page.getByRole('button', { name: 'Open now playing', exact: true }).waitFor();
    await screenshot(page, name + '-busy');
    await page.waitForFunction(() => window.__playerPresentationMedia?.currentTime > 0);
    await page.waitForFunction(() => {
      const controls = [...document.querySelectorAll('[aria-label="Pause"]')];
      return controls.length === 2 && controls.every(node => node.querySelector('svg') && !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true');
    });
    for (const control of await page.getByRole('button', { name: 'Pause', exact: true }).all()) assert.equal(await control.isEnabled(), true);
    await plainControls(page);
    await screenshot(page, name + '-mini');
    await page.evaluate(() => { window.__sameMedia = window.__playerPresentationMedia; });
    const open = async () => {
      await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
      await page.getByTestId('now-playing-dismiss-region').waitFor();
      await page.waitForTimeout(300);
    };
    await open();
    await plainControls(page);
    if (width < 600) {
      const [fold, details] = await Promise.all([page.getByTestId('now-playing-scroll').boundingBox(), page.getByTestId('now-playing-artist').boundingBox()]);
      assert.ok(details.y >= fold.y + fold.height, 'The details start below the first screen instead of peeking into it');
      const hint = page.getByTestId('coachmark');
      await hint.waitFor();
      const bubble = await hint.boundingBox();
      assert.ok(bubble.y + bubble.height <= fold.y + fold.height, 'The more-below hint sits on the first screen');
      await page.waitForTimeout(300);
      await screenshot(page, name + '-now-playing-hint');
      await hint.getByRole('button', { name: 'got it', exact: true }).click();
      await hint.waitFor({ state: 'detached' });
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await open();
      await page.waitForTimeout(1000);
      assert.equal(await page.getByTestId('coachmark').count(), 0, 'A dismissed hint never comes back');
    }
    await screenshot(page, name + '-now-playing');
    const cdp = await context.newCDPSession(page);
    const header = page.getByTestId('now-playing-dismiss-region');
    const box = await header.boundingBox();
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const remains = async () => {
      assert.equal(await header.isVisible(), true);
      assert.ok(Math.abs((await header.boundingBox()).y - box.y) < 2, 'Cancelled panel snaps back');
    };
    await gesture(page, cdp, start, 0, 24); await remains();
    await gesture(page, cdp, start, 0, 80, { wait: 40 }); await remains();
    await gesture(page, cdp, start, 100, 18); await remains();
    await gesture(page, cdp, start, 0, -100); await remains();
    await gesture(page, cdp, start, 0, 160, { cancel: true }); await remains();
    if (width < 600) {
      await twoFingerCancel(page, cdp, start); await remains();
      await gesture(page, cdp, start, 0, 150, { resize: true });
      assert.equal(await header.isVisible(), true);
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);
      await remains();
    }
    const slider = page.getByRole('slider', { name: 'Playback position', exact: true });
    const scrub = await slider.boundingBox();
    const beforeScrub = await page.evaluate(() => window.__playerPresentationMedia.currentTime);
    await gesture(page, cdp, { x: scrub.x + 12, y: scrub.y + scrub.height / 2 }, scrub.width * 0.55, 8);
    assert.equal(await header.isVisible(), true, 'Scrubbing must not dismiss the player');
    const value = await page.evaluate(() => window.__playerPresentationMedia.currentTime);
    assert.ok(value > beforeScrub + 30, 'Touch drag must actually seek media beyond ordinary playback');
    const art = await page.getByTestId('now-playing-artwork').boundingBox();
    await gesture(page, cdp, { x: art.x + art.width / 2, y: art.y + art.height / 2 }, 0, 140);
    if (width < 600) {
      const continuous = async () => {
        assert.equal(await header.isVisible(), false, 'Content pull collapses to dock');
        await page.getByRole('button', { name: 'Open now playing', exact: true }).waitFor();
        const before = await page.evaluate(() => window.__sameMedia.currentTime);
        await page.waitForTimeout(300);
        assert.equal(await page.evaluate(before => window.__sameMedia === window.__playerPresentationMedia && !window.__sameMedia.paused && window.__sameMedia.currentTime > before, before), true, 'Collapse preserves playing media');
      };
      await continuous(); await open();
      for (const target of ['now-playing-title', 'now-playing-time']) {
        const body = await page.getByTestId(target).boundingBox();
        await gesture(page, cdp, { x: body.x + body.width / 2, y: body.y + body.height / 2 }, 0, 150);
        await continuous(); await open();
      }
      const below = await page.getByTestId('now-playing-scroll').boundingBox();
      await gesture(page, cdp, { x: width / 2, y: below.y + below.height - 12 }, 0, 140);
      await continuous(); await open();
      const pause = await page.getByTestId('now-playing-scroll').getByRole('button', { name: 'Pause', exact: true }).boundingBox();
      await gesture(page, cdp, { x: pause.x + pause.width / 2, y: pause.y + pause.height / 2 }, 0, 150);
      await remains();
      const currentScrub = await slider.boundingBox();
      await gesture(page, cdp, { x: currentScrub.x + currentScrub.width / 2, y: currentScrub.y + currentScrub.height / 2 }, 50, 150);
      await remains();
    } else assert.equal(await header.isVisible(), true, 'Desktop artwork does not dismiss');
    if (width < 600) {
      await gesture(page, cdp, start, 0, 180);
      assert.equal(await header.isVisible(), false, 'Deliberate top swipe dismisses');
      await open();
      await gesture(page, cdp, start, 0, 90, { wait: 1, steps: 2 });
      assert.equal(await header.isVisible(), false, 'A deliberate short fast flick dismisses');
      await open();
    } else {
      await gesture(page, cdp, start, 0, 180);
      assert.equal(await header.isVisible(), true, 'Floating desktop player does not use full-screen swipe');
    }
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await header.waitFor({ state: 'hidden' });
    assert.equal(await header.isVisible(), false);
    await open();
    await page.keyboard.press('Escape');
    await header.waitFor({ state: 'hidden', timeout: 2000 });
    assert.equal(await header.isVisible(), false, 'onRequestClose remains available');
    await open();
    await page.getByTestId('now-playing-scroll').getByRole('link').first().click();
    await page.waitForURL('**/u/fixture.test');
    await header.waitFor({ state: 'hidden', timeout: 2000 });
    assert.equal(await header.isVisible(), false, 'Artist link retains normal tap navigation');
    assert.equal(await page.evaluate(() => window.__sameMedia === window.__playerPresentationMedia && !window.__sameMedia.paused), true);
    assert.deepEqual(errors, []);
    console.log(name + ': plain controls, balanced detail, likes, protected controls/links, body pull, playback continuity, scroll arbitration and cancellation passed');
  } catch (error) {
    await screenshot(page, name + '-failure');
    throw error;
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}

async function hintRoom(browser) {
  // A phone-height screen: the first open makes room for the more-below hint instead of covering like/share/queue.
  const { context, page, errors } = await setup(browser, 390, 'dark', track, 1, 760);
  try {
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
    const hint = page.getByTestId('coachmark');
    await hint.waitFor();
    await page.waitForTimeout(300);
    const [bubble, queue, fold] = await Promise.all([hint.boundingBox(), page.getByTestId('now-playing-scroll').getByRole('button', { name: 'Queue', exact: true }).boundingBox(),
      page.getByTestId('now-playing-scroll').boundingBox()]);
    assert.ok(bubble.y >= queue.y + queue.height, 'The hint sits below like/share/queue instead of covering them');
    assert.ok(bubble.y + bubble.height <= fold.y + fold.height, 'The hint stays on the first screen');
    await screenshot(page, '390-dark-760-now-playing-hint');
    const art = await page.getByTestId('now-playing-artwork').boundingBox();
    await hint.getByRole('button', { name: 'got it', exact: true }).click();
    await hint.waitFor({ state: 'detached' });
    assert.deepEqual(await page.getByTestId('now-playing-artwork').boundingBox(), art, 'Dismissing the hint does not shift the player');
    assert.deepEqual(errors, []);
    console.log('390x760: the more-below hint has its own room and dismissing it keeps the layout still');
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}

async function longContent(browser) {
  const selected = { ...track, media: { artwork: null }, metadata: { ...track.metadata,
    title: 'A very long title with ünicode — an extended live recording from a quiet room across several evenings',
    album: 'A collection with a deliberately long album name that wraps naturally' } };
  const { context, page, errors } = await setup(browser, 390, 'dark', selected, 1.4, 620);
  try {
    await screenshot(page, '390-dark-long-missing-art-scale-1.4');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => window.__playerPresentationMedia?.currentTime > 0);
    await page.getByRole('button', { name: 'More', exact: true }).scrollIntoViewIfNeeded();
    await screenshot(page, '390-dark-long-detail-controls-scale-1.4');
    await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
    const header = page.getByTestId('now-playing-dismiss-region');
    await header.waitFor(); await page.waitForTimeout(300);
    const top = (await header.boundingBox()).y;
    const art = await page.getByTestId('now-playing-artwork').boundingBox();
    const cdp = await context.newCDPSession(page);
    await gesture(page, cdp, { x: art.x + art.width / 2, y: art.y + art.height / 2 }, 0, -130);
    assert.equal(await header.isVisible(), true);
    assert.ok(Math.abs((await header.boundingBox()).y - top) < 2);
    const scroll = page.getByTestId('now-playing-scroll');
    assert.ok(await scroll.evaluate(node => node.scrollTop) > 20, 'Upward touch scrolls native body');
    await screenshot(page, '390-dark-short-player-scrolled-scale-1.4');
    await gesture(page, cdp, { x: 25, y: 280 }, 0, 260);
    assert.equal(await header.isVisible(), true, 'Gesture starting scrolled does not dismiss');
    assert.ok(await scroll.evaluate(node => node.scrollTop) <= 1, 'Downward touch returns body to top');
    await gesture(page, cdp, { x: 25, y: 280 }, 0, 160);
    assert.equal(await header.isVisible(), false, 'Fresh downward pull at top collapses');
    await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
    await header.waitFor();
    await page.waitForTimeout(300);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 25, y: 280, id: 1 }] });
    for (const y of [260, 240, 220, 260, 300, 340, 380, 420, 460]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 25, y, id: 1 }] });
      await page.waitForTimeout(30);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(550);
    assert.equal(await header.isVisible(), true, 'Upward intent cannot reverse into dismissal in same touch');
    await page.getByRole('button', { name: 'Open track page', exact: true }).scrollIntoViewIfNeeded();
    await screenshot(page, '390-dark-short-player-scrolled-scale-1.4');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    assert.deepEqual(errors, []);
    console.log('Long title, missing artwork, scale1.4 and short-viewport body scrolling passed');
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}

async function webkitFallback(browser) {
  const { context, page, errors } = await setup(browser, 390, 'dark');
  try {
    assert.equal(await page.evaluate(() => CSS.supports('touch-action', 'pan-x pan-down')), false);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => window.__playerPresentationMedia?.currentTime > 0);
    await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
    const art = page.getByTestId('now-playing-artwork');
    await art.waitFor(); await page.waitForTimeout(300);
    const cancelled = await art.evaluate(async target => {
      const point = (y) => ({ identifier: 1, target, clientX: 195, clientY: y, pageX: 195, pageY: y });
      const send = (type, y) => {
        const touches = type === 'touchend' ? [] : [point(y)];
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, { touches: { value: touches }, targetTouches: { value: touches }, changedTouches: { value: [point(y)] } });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      };
      send('touchstart', 200);
      const cancelled = [];
      for (let y = 210; y <= 360; y += 10) {
        cancelled.push(send('touchmove', y));
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      send('touchend', 360);
      return cancelled;
    });
    await page.waitForTimeout(600);
    assert.ok(cancelled.some(Boolean), 'WebKit fallback cancels eligible native scrolling');
    assert.equal(await page.getByTestId('now-playing-dismiss-region').count(), 0);
    assert.equal(await page.evaluate(() => !window.__playerPresentationMedia.paused), true);
    assert.deepEqual(errors, []);
    console.log('WebKit fallback: actual playback and dispatched TouchEvent downward collapse passed; no physical Safari touch claim');
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}

async function withPlayerHarness(run) {
  if (!process.env.PLAYER_URL) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = process.env.PLAYER_URL || `http://127.0.0.1:${server.address().port}`;
  console.log(`Player UI source: ${origin}; catalog and media are fixtures; real API/PDS mutations blocked`);
  const browser = process.env.PLAYER_WEBKIT ? await webkit.launch({ executablePath: process.env.WEBKIT_EXECUTABLE }) : await chromium.launch({ channel: 'chrome' });
  try { await run(browser); }
  finally { await browser.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
}

module.exports = { withPlayerHarness, setup, track, screenshot };

if (require.main === module) withPlayerHarness(async browser => {
  if (process.env.PLAYER_WEBKIT) { await webkitFallback(browser); return; }
  for (const width of [390, 1280]) for (const theme of ['light', 'dark']) { if (width >= 800) await runDesktop(browser, width, theme, { setup, track, screenshot }); else await run(browser, width, theme); }
  await hintRoom(browser);
  await longContent(browser);
}).catch(error => { console.error(error); process.exitCode = 1; if (server.listening) server.close(); });
