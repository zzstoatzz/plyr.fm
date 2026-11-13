const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { createRequire } = require('node:module');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const requireFrontend = createRequire(path.resolve(__dirname, '../../../frontend/package.json'));
const { chromium, webkit } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : requireFrontend('playwright');
const engine = process.env.QUEUE_BROWSER || 'chromium';
const dist = process.env.QUEUE_DIST || path.resolve(__dirname, '../dist');
const output = process.env.QUEUE_OUTPUT || '/tmp/plyr-next-queue';
const fixtureAudio = 'https://queue-fixture.invalid/audio.wav';
fs.mkdirSync(output, { recursive: true });
const titles = ['Current song', 'Alpha', 'Beta', 'Gamma', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra'];
const tracks = titles.map((title, index) => {
  const uri = `at://did:plc:fixture/fm.plyr.track/${index}`;
  return {
    object: 'track', id: 'trk_' + Buffer.from(uri).toString('base64url'),
    record: { uri, cid: 'fixture', revision: null, collection: 'fm.plyr.track', rkey: String(index) },
    metadata: { title, description: null, album: null, duration_seconds: 600, created_at: '2026-11-04T00:00:00Z' },
    artist: { did: 'did:plc:fixture', profile: { handle: 'fixture.test', display_name: 'Test artist', avatar_url: null } },
    media: { artwork: null }, access: { visibility: 'public' }, metrics: { play_count: 0, like_count: 0 }
  };
});
const audio = Buffer.alloc(44 + 8000 * 600 * 2);
audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
const server = http.createServer((request, response) => {
  if (request.url === '/audio.wav') { response.setHeader('Content-Type', 'audio/wav'); response.end(audio); return; }
  let filename = path.join(dist, decodeURIComponent(request.url.split('?')[0]));
  if (!fs.existsSync(filename) || fs.statSync(filename).isDirectory()) filename = path.join(dist, 'index.html');
  response.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.json') ? 'application/json' : 'text/html');
  response.end(fs.readFileSync(filename));
});
let origin;
const order = page => page.locator('[aria-label^="Reorder "]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label').slice(8)));
const handle = (page, title) => page.getByLabel(`Reorder ${title}`, { exact: true });
const shot = (page, name) => page.screenshot({ path: path.join(output, `${name}.png`) });

async function setup(browser, width, theme, queue = tracks, enqueue = []) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true, colorScheme: theme });
  await context.addInitScript(({ theme, accent }) => localStorage.setItem('plyr-next:prefs', JSON.stringify({ theme, accent, playThrough: true, keepPlaying: false })), { theme, accent: process.env.QUEUE_ACCENT || '#6a9fff' });
  await context.route('**/*', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort('blockedbyclient'));
  await context.route(fixtureAudio, async route => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
    const body = audio.subarray(start, end + 1);
    await route.fulfill({ status: range ? 206 : 200, body, headers: {
      'content-type': 'audio/wav', 'content-length': String(body.length), 'accept-ranges': 'bytes',
      'access-control-allow-origin': '*', ...(range ? { 'content-range': `bytes ${start}-${end}/${audio.length}` } : {})
    } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(Number(process.env.QUEUE_TIMEOUT) || 15_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const receipts = new Map();
  await page.route('https://api.next.plyr.fm/**', async route => {
    const url = new URL(route.request().url());
    let body = {};
    if (route.request().method() === 'POST') {
      const track = queue.find(item => url.pathname === '/v1/tracks/' + item.id + '/plays');
      const occurrence = url.searchParams.get('occurrence');
      if (!track || !occurrence) { await route.abort('blockedbyclient'); return; }
      if (!receipts.has(occurrence)) receipts.set(occurrence, receipts.size + 1);
      body = { object: 'play_receipt', occurrence, track_id: track.id, record: { uri: track.record.uri },
        play_count: receipts.get(occurrence), counted: true, dedup: { status: 'duplicate', window_seconds: 30 },
        sources: { metrics: 'application_metrics', dedup: 'postgres_durable' } };
    } else if (url.pathname === '/v1/tracks') body = { object: 'list', data: queue, has_more: false };
    else if (url.pathname === '/v1/charts/tracks') body = { period: 'week', data: [] };
    else if (url.pathname.endsWith('/playback')) {
      await page.waitForTimeout(350);
      body = { object: 'playback', track_id: queue[0].id, record: queue[0].record,
        availability: { status: 'available', delivery: { url: fixtureAudio, media_type: 'audio/wav' } } };
    }
    await route.fulfill({ json: body, headers: { 'access-control-allow-origin': new URL(origin).origin, 'access-control-allow-credentials': 'true' } });
  });
  await page.goto(origin);
  await page.getByTestId('home-track-row').first().getByRole('button', { name: /^Play / }).click({ position: { x: 22, y: 40 } });
  await page.getByRole('button', { name: 'Open now playing', exact: true }).waitFor();
  for (const title of enqueue) {
    await page.getByTestId('home-track-row').filter({ hasText: title }).first().getByRole('button', { name: /More options/ }).click();
    await page.getByRole('button', { name: 'add to queue', exact: true }).click();
    await page.getByRole('button', { name: 'add to queue', exact: true }).waitFor({ state: 'detached' });
  }
  await shot(page, `${width}-${theme}-busy`);
  await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
  await page.waitForTimeout(350);
  await shot(page, `${width}-${theme}-now-playing`);
  await page.getByRole('button', { name: 'Queue', exact: true }).click();
  await handle(page, 'Alpha').waitFor();
  await page.getByText('drag the handles to reorder', { exact: true }).waitFor();
  const grip = await handle(page, 'Alpha').boundingBox();
  assert.ok(grip.width >= 44 && grip.height >= 44, 'Visible drag handles remain touch targets');
  return { context, page, errors };
}

async function mouseDrag(page, from, to, cancel = false) {
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.move(end.x + end.width / 2, (start.y > end.y ? end.y + 10 : end.y + end.height / 2 + 12), { steps: 15 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(80);
}

async function touchDrag(page, cdp, from, toY, cancel = false, hold = 0) {
  const start = await from.boundingBox();
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await page.waitForTimeout(80);
  for (let step = 1; step <= 20; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (toY - y) * step / 20, id: 1 }] });
    await page.waitForTimeout(12);
  }
  if (hold) await page.waitForTimeout(hold);
  await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(80);
}

async function standard(browser, width, theme) {
  const started = performance.now();
  const { context, page, errors } = await setup(browser, width, theme);
  try {
    const cdp = engine === 'chromium' ? await context.newCDPSession(page) : null;
    await mouseDrag(page, handle(page, 'Alpha'), handle(page, 'Gamma'));
    assert.deepEqual((await order(page)).slice(0, 3), ['Beta', 'Gamma', 'Alpha']);
    await handle(page, 'Alpha').focus();
    await page.keyboard.press('ArrowUp');
    assert.deepEqual((await order(page)).slice(0, 3), ['Beta', 'Alpha', 'Gamma']);
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Reorder Alpha');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    assert.deepEqual((await order(page)).slice(0, 3), ['Beta', 'Alpha', 'Gamma']);
    const beforeCancel = await order(page);
    await mouseDrag(page, handle(page, 'Alpha'), handle(page, 'Delta'), true);
    assert.deepEqual(await order(page), beforeCancel);
    if (cdp) {
      const beta = await handle(page, 'Beta').boundingBox();
      await touchDrag(page, cdp, handle(page, 'Gamma'), beta.y + 10);
      assert.deepEqual((await order(page)).slice(0, 3), ['Gamma', 'Beta', 'Alpha']);
      await touchDrag(page, cdp, handle(page, 'Delta'), width === 390 ? 755 : 815, false, 850);
      assert.ok((await order(page)).indexOf('Delta') > 5, 'Holding at the edge scrolls to farther queue positions');
      await handle(page, 'Beta').scrollIntoViewIfNeeded();
      const cancelBox = await handle(page, 'Beta').boundingBox();
      const beforeTouchCancel = await order(page);
      await touchDrag(page, cdp, handle(page, 'Beta'), cancelBox.y + 110, true);
      assert.deepEqual(await order(page), beforeTouchCancel);
    }
    assert.match(await page.getByRole('button', { name: 'Open now playing', exact: true }).innerText(), /Current song/);
    assert.equal(await page.getByRole('button', { name: 'Move up', exact: true }).count(), 0);
    await shot(page, `${width}-${theme}-queue`);
    const primary = await page.getByRole('button', { name: /^(Pause|Play)$/ }).boundingBox();
    await page.mouse.move(primary.x + primary.width / 2, primary.y + primary.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(100);
    await shot(page, `${width}-${theme}-pressed`);
    await page.mouse.up();
    const [nextUp] = await order(page);
    const changeBox = await handle(page, 'Beta').boundingBox();
    await page.mouse.move(changeBox.x + 22, changeBox.y + 28);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.move(changeBox.x + 22, changeBox.y + 110, { steps: 5 });
    await page.getByRole('button', { name: 'Next', exact: true }).evaluate(node => node.click());
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('[aria-valuetext="Moving"]').count(), 0);
    assert.match(await page.getByRole('button', { name: 'Open now playing', exact: true }).innerText(), new RegExp(nextUp));
    if (width === 390 && theme === 'light') {
      const target = handle(page, 'Alpha');
      await target.scrollIntoViewIfNeeded();
      const beforeResize = await order(page);
      const box = await target.boundingBox();
      await page.mouse.move(box.x + 22, box.y + 28);
      await page.mouse.down();
      await page.waitForTimeout(80);
      await page.mouse.move(box.x + 22, box.y + 100, { steps: 5 });
      await page.setViewportSize({ width: 430, height: 900 });
      await page.waitForTimeout(100);
      await page.mouse.up();
      assert.deepEqual(await order(page), beforeResize);
    }
    const beforeEnds = await order(page);
    await handle(page, 'Alpha').focus();
    await page.keyboard.press('End');
    assert.equal((await order(page)).at(-1), 'Alpha');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Reorder Alpha');
    await page.keyboard.press('Home');
    assert.deepEqual(await order(page), ['Alpha', ...beforeEnds.filter(title => title !== 'Alpha')]);
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Reorder Alpha');
    assert.deepEqual(errors, []);
    console.log(`${engine}/${width}/${theme}: mouse, ${engine === 'chromium' ? 'touch, autoscroll, ' : ''}keyboard focus, Home/End, cancellation and queue change passed (${Math.round(performance.now() - started)}ms)`);
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}

async function duplicates(browser) {
  const { context, page, errors } = await setup(browser, 390, 'light', tracks.slice(0, 5), ['Beta']);
  try {
    assert.deepEqual(await order(page), ['Beta', 'Alpha', 'Beta', 'Gamma', 'Delta']);
    await mouseDrag(page, handle(page, 'Beta').last(), handle(page, 'Beta').first());
    assert.deepEqual(await order(page), ['Beta', 'Beta', 'Alpha', 'Gamma', 'Delta']);
    await mouseDrag(page, handle(page, 'Delta'), handle(page, 'Alpha'));
    assert.deepEqual(await order(page), ['Beta', 'Beta', 'Delta', 'Alpha', 'Gamma']);
    assert.match(await page.getByRole('button', { name: 'Open now playing', exact: true }).innerText(), /Current song/);
    assert.deepEqual(errors, []);
    console.log('Duplicate record occurrences reorder independently; dragging does not change playback');
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}

(async () => {
  if (!process.env.QUEUE_URL) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = process.env.QUEUE_URL || `http://127.0.0.1:${server.address().port}`;
  console.log(`Queue UI source: ${origin}; catalog/media are fixtures; real API/PDS mutations blocked`);
  const browser = await (engine === 'webkit' ? webkit.launch({ executablePath: process.env.WEBKIT_EXECUTABLE, headless: true }) : chromium.launch({ channel: 'chrome', headless: true }));
  try {
    for (const width of [390, 1280]) for (const theme of ['light', 'dark']) await standard(browser, width, theme);
    await duplicates(browser);
  } finally { await browser.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; if (server.listening) server.close(); });
