const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { createRequire } = require('node:module');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const requireFrontend = createRequire(path.resolve(__dirname, '../../../frontend/package.json'));
const { chromium } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : requireFrontend('playwright');
const dist = process.env.QUEUE_DIST || path.resolve(__dirname, '../dist');
const output = process.env.QUEUE_OUTPUT || '/tmp/plyr-next-queue';
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

async function setup(browser, width, theme, queue = tracks) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true, colorScheme: theme });
  await context.addInitScript(theme => localStorage.setItem('plyr-next:prefs', JSON.stringify({ theme, playThrough: true, keepPlaying: false })), theme);
  const page = await context.newPage();
  page.setDefaultTimeout(Number(process.env.QUEUE_TIMEOUT) || 15_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://api.next.plyr.fm/**', async route => {
    const url = new URL(route.request().url());
    let body = {};
    if (url.pathname === '/v1/tracks') body = { object: 'list', data: queue, has_more: false };
    else if (url.pathname === '/v1/charts/tracks') body = { period: 'week', data: [] };
    else if (url.pathname.endsWith('/playback')) {
      await page.waitForTimeout(350);
      body = { object: 'playback', track_id: queue[0].id, record: queue[0].record,
        availability: { status: 'available', delivery: { url: origin + '/audio.wav', media_type: 'audio/wav' } } };
    }
    await route.fulfill({ json: body });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await page.getByRole('button', { name: 'Open now playing', exact: true }).waitFor();
  await shot(page, `${width}-${theme}-busy`);
  await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
  await page.waitForTimeout(350);
  await shot(page, `${width}-${theme}-now-playing`);
  await page.getByRole('button', { name: 'Queue', exact: true }).click();
  await handle(page, 'Alpha').waitFor();
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
    const cdp = await context.newCDPSession(page);
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
    const beta = await handle(page, 'Beta').boundingBox();
    await touchDrag(page, cdp, handle(page, 'Gamma'), beta.y + 10);
    assert.deepEqual((await order(page)).slice(0, 3), ['Gamma', 'Beta', 'Alpha']);
    await touchDrag(page, cdp, handle(page, 'Gamma'), width === 390 ? 755 : 815, false, 850);
    assert.ok((await order(page)).indexOf('Gamma') > 5, 'Holding at the edge scrolls to farther queue positions');
    await handle(page, 'Beta').scrollIntoViewIfNeeded();
    const cancelBox = await handle(page, 'Beta').boundingBox();
    const beforeTouchCancel = await order(page);
    await touchDrag(page, cdp, handle(page, 'Beta'), cancelBox.y + 110, true);
    assert.deepEqual(await order(page), beforeTouchCancel);
    assert.match(await page.getByRole('button', { name: 'Open now playing', exact: true }).innerText(), /Current song/);
    assert.equal(await page.getByRole('button', { name: 'Move up', exact: true }).count(), 0);
    await shot(page, `${width}-${theme}-queue`);
    const primary = await page.getByRole('button', { name: /^(Pause|Play)$/ }).boundingBox();
    await page.mouse.move(primary.x + primary.width / 2, primary.y + primary.height / 2);
    await page.mouse.down();
    await shot(page, `${width}-${theme}-pressed`);
    await page.mouse.up();
    const changeBox = await handle(page, 'Beta').boundingBox();
    await page.mouse.move(changeBox.x + 22, changeBox.y + 28);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.move(changeBox.x + 22, changeBox.y + 110, { steps: 5 });
    await page.getByRole('button', { name: 'Next', exact: true }).evaluate(node => node.click());
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('[aria-valuetext="Moving"]').count(), 0);
    assert.match(await page.getByRole('button', { name: 'Open now playing', exact: true }).innerText(), /Beta/);
    assert.deepEqual(errors, []);
    console.log(`${width}/${theme}: mouse, touch, keyboard focus, cancellation, autoscroll and queue change passed (${Math.round(performance.now() - started)}ms)`);
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}

async function duplicates(browser) {
  const { context, page, errors } = await setup(browser, 390, 'light', [tracks[0], tracks[1], tracks[2], tracks[3], tracks[2], tracks[4]]);
  try {
    await mouseDrag(page, handle(page, 'Beta').first(), handle(page, 'Beta').last());
    assert.deepEqual(await order(page), ['Alpha', 'Gamma', 'Beta', 'Beta', 'Delta']);
    await mouseDrag(page, handle(page, 'Beta').last(), handle(page, 'Alpha'));
    assert.deepEqual(await order(page), ['Beta', 'Alpha', 'Gamma', 'Beta', 'Delta']);
    assert.match(await page.getByRole('button', { name: 'Open now playing', exact: true }).innerText(), /Current song/);
    assert.deepEqual(errors, []);
    console.log('Duplicate record occurrences reorder independently; dragging does not change playback');
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 1280]) for (const theme of ['light', 'dark']) await standard(browser, width, theme);
    await duplicates(browser);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
