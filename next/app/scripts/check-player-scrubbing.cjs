const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');
const dist = process.env.PLAYER_SCRUB_DIST || path.resolve(__dirname, '../dist');
const output = process.env.PLAYER_SCRUB_OUTPUT || '/tmp/plyr-player-scrubbing';
const audio = Buffer.alloc(44 + 8000 * 120 * 2);
audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
let origin;
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, origin).pathname;
    if (pathname === '/audio.wav') {
      const match = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      const start = match ? Number(match[1]) : 0, end = match?.[2] ? Math.min(Number(match[2]), audio.length - 1) : audio.length - 1;
      res.writeHead(match ? 206 : 200, { 'content-type': 'audio/wav', 'content-length': end - start + 1, 'accept-ranges': 'bytes', ...(match ? { 'content-range': `bytes ${start}-${end}/${audio.length}` } : {}) });
      res.end(audio.subarray(start, end + 1)); return;
    }
    let file = path.join(dist, decodeURIComponent(pathname));
    try { if (!(await fs.stat(file)).isFile()) throw Error(); } catch { file = path.join(dist, 'index.html'); }
    const mime = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html';
    res.writeHead(200, { 'content-type': mime }); res.end(await fs.readFile(file));
  } catch { res.writeHead(500); res.end(); }
});
(async () => {
  await fs.mkdir(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const safari = process.env.PLAYER_SCRUB_BROWSER === 'webkit';
  const browser = safari ? await webkit.launch({ executablePath: process.env.WEBKIT_EXECUTABLE }) : await chromium.launch({ channel: 'chrome' });
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: width === 390 ? 'light' : 'dark', isMobile: width === 390, hasTouch: width === 390 });
      const track = { object: 'track', id: 'scrub-fixture', record: { uri: 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/fm.plyr.track/scrub', cid: null, collection: 'fm.plyr.track', rkey: 'scrub', revision: null }, metadata: { title: 'Local scrubbing fixture', artist_name: 'Local artist', duration_seconds: 120, created_at: '2026-11-06T00:00:00Z', description: null, album: null }, artist: { did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', profile: { handle: 'fixture.test', display_name: 'Local artist', avatar_url: null } }, media: { artwork: null }, access: { visibility: 'public' }, metrics: { play_count: 0, like_count: 0 } };
      await context.route('**/*', async route => {
        const req = route.request(), u = new URL(req.url());
        if (u.origin === origin) return route.continue();
        if (u.origin !== 'https://api.next.plyr.fm') return route.abort();
        const data = u.pathname.endsWith('/playback') ? { object: 'playback', track_id: track.id, record: track.record, availability: { status: 'available', delivery: { url: origin + '/audio.wav', media_type: 'audio/wav' } } } : u.pathname === '/v1/tracks/scrub-fixture' ? track : u.pathname === '/v1/charts' ? { period: 'week', data: [] } : { object: 'list', data: u.pathname === '/v1/tracks' ? [track] : [], has_more: false };
        await route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*' } });
      });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', e => { errors.push(e.message); console.log('pageerror', e.message); });
      await page.addInitScript(() => { const OriginalAudio = window.Audio; window.fixtureAudio = []; window.Audio = class extends OriginalAudio { constructor(...args) { super(...args); window.fixtureAudio.push(this); } }; });
      await page.goto(origin + '/track/scrub-fixture');
      await page.getByRole('button', { name: 'Play', exact: true }).first().click();
      await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
      const slider = page.getByRole('slider', { name: 'Playback position', exact: true });
      await slider.waitFor();
      await page.waitForFunction(() => document.querySelector('[aria-label="Playback position"]')?.getAttribute('aria-disabled') !== 'true' && window.fixtureAudio.some(audio => audio.readyState >= 2 && audio.duration === 120), null, { timeout: 15000 });
      await page.waitForTimeout(600);
      await slider.evaluate(node => { window.scrubSamples = []; new MutationObserver(records => { for (const r of records) window.scrubSamples.push({ old: Number(r.oldValue), value: Number(node.getAttribute('aria-valuenow')) }); }).observe(node, { attributes: true, attributeFilter: ['aria-valuenow'], attributeOldValue: true }); });
      for (const fraction of [.7, .25, .8, .4]) {
      if (fraction === .8) await page.getByRole('button', { name: 'Pause', exact: true }).first().click();
      const box = await slider.boundingBox(); assert.ok(box);
      const touch = width === 390 && !safari ? await context.newCDPSession(page) : null;
      if (touch) {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * .1, y: box.y + box.height / 2 }] });
        for (let step = 1; step <= 24; step++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width * (.1 + (fraction - .1) * step / 24), y: box.y + box.height / 2 }] });
      } else {
        await page.mouse.move(box.x + box.width * .1, box.y + box.height / 2); await page.mouse.down();
        await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2, { steps: 24 });
      }
      await page.waitForTimeout(40);
      const release = Number(await slider.getAttribute('aria-valuenow'));
      await slider.evaluate(() => { window.releaseIndex = window.scrubSamples.length; });
      if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.mouse.up();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${output}/${width}.png` });
      const samples = await page.evaluate(() => window.scrubSamples.slice(window.releaseIndex));
      const media = await page.evaluate(() => window.fixtureAudio.filter(audio => audio.src.includes('/audio.wav')).map(audio => ({ time: audio.currentTime, paused: audio.paused })));
      console.log(JSON.stringify({ width, release, errors, samples, media }));
      assert.ok(media.some(audio => Math.abs(audio.time - release) < 5), 'Real audio seeks to the released position');
      assert.deepEqual(errors, [], 'First pointer scrub must not crash');
      assert.ok(release > 10, 'Dragging reaches intended position');
      assert.ok(samples.every(s => s.value >= release - 1), 'Released scrub position must not jump backward');
      if (fraction >= .8) assert.ok(samples.every(s => Math.abs(s.value - release) < 5), 'Paused seek remains stable');
      }
      await context.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
