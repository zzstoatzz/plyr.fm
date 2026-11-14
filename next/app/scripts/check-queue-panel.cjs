// The desktop queue panel: docks beside the page on wide windows, floats over it on narrower ones, stays open across pages
// and reloads, and leaves phones on the queue screen. Also looks at the artist of the week on the desktop home. Run after `npm run build:web`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { createRequire } = require('node:module');
const path = require('node:path');
const requireFrontend = createRequire(path.resolve(__dirname, '../../../frontend/package.json'));
const { chromium } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : requireFrontend('playwright');
const dist = process.env.PLAYER_DIST || path.resolve(__dirname, '../dist');
const output = process.env.QUEUE_PANEL_OUTPUT || '/tmp/plyr-queue-panel';
const images = process.env.QUEUE_PANEL_IMAGES;
fs.mkdirSync(output, { recursive: true });

const artistDid = 'did:plc:fixtureartist';
const tracks = Array.from({ length: 9 }, (_, index) => {
  const uri = `at://${artistDid}/fm.plyr.track/t${index}`;
  return {
    object: 'track', id: 'trk_' + Buffer.from(uri).toString('base64url'),
    record: { uri, cid: `bafy${index}`, revision: null, collection: 'fm.plyr.track', rkey: `t${index}` },
    metadata: { title: `${String(300 + index * 7)} - sketch number ${index + 1}`, description: null, album: null, duration_seconds: 120 + index * 31, created_at: `2026-11-0${index + 1}T00:00:00Z` },
    artist: { did: artistDid, profile: { handle: 'sketches.test', display_name: 'replyomatic', avatar_url: 'https://panel-fixture.invalid/avatar.jpg', bio: 'ambient sketches, one a day, numbered as they come.' } },
    media: { artwork: { url: `https://panel-fixture.invalid/art/${index}.jpg` } }, access: { visibility: 'public' }, metrics: { play_count: 9 - index, like_count: 3 }
  };
});
const audio = Buffer.alloc(44 + 8000 * 240 * 2);
audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
const pictures = images ? fs.readdirSync(images).filter(name => name.endsWith('.jpg')).sort().map(name => path.join(images, name)) : [];
const server = http.createServer((request, response) => {
  let filename = path.join(dist, decodeURIComponent(request.url.split('?')[0]));
  if (!fs.existsSync(filename) || fs.statSync(filename).isDirectory()) filename = path.join(dist, 'index.html');
  response.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.json') ? 'application/json' : 'text/html');
  response.end(fs.readFileSync(filename));
});
let origin;

async function setup(browser, width, height = 900) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: 'dark', deviceScaleFactor: Number(process.env.QUEUE_PANEL_SCALE || 1) });
  await context.addInitScript(() => localStorage.setItem('plyr-next:prefs', JSON.stringify({ theme: 'dark', scale: 1, playThrough: true })));
  await context.route('**/*', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort());
  await context.route('https://panel-fixture.invalid/**', async route => {
    const url = new URL(route.request().url()).pathname;
    const picture = /\/art\/(\d+)\.jpg$/.exec(url);
    if (picture || url.endsWith('/avatar.jpg')) {
      const file = pictures.length ? pictures[picture ? Number(picture[1]) % pictures.length : pictures.length - 1] : undefined;
      if (file) await route.fulfill({ body: fs.readFileSync(file), contentType: 'image/jpeg' }); else await route.abort();
      return;
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
    const body = audio.subarray(start, end + 1);
    await route.fulfill({ status: range ? 206 : 200, body, headers: { 'content-type': 'audio/wav', 'content-length': String(body.length), 'accept-ranges': 'bytes',
      'access-control-allow-origin': '*', ...(range ? { 'content-range': `bytes ${start}-${end}/${audio.length}` } : {}) } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://api.next.plyr.fm/**', async route => {
    const url = new URL(route.request().url());
    const byId = tracks.find(track => url.pathname.startsWith('/v1/tracks/' + track.id));
    let body = { object: 'list', data: [], has_more: false };
    if (byId && url.pathname.endsWith('/playback')) body = { object: 'playback', track_id: byId.id, record: byId.record,
      availability: { status: 'available', delivery: { url: 'https://panel-fixture.invalid/audio.wav', media_type: 'audio/wav' } } };
    else if (byId && url.pathname === '/v1/tracks/' + byId.id) body = byId;
    else if (url.pathname === '/v1/tracks') body = { object: 'list', data: tracks, has_more: false };
    else if (url.pathname === '/v1/charts/tracks') body = { period: url.searchParams.get('period') || 'week', data: tracks.map((track, index) => ({ rank: index + 1, track, plays: 1, likes: track.metrics.like_count })) };
    else if (url.pathname.startsWith('/v1/artists/') && url.pathname.endsWith('/metrics')) body = { totals: { plays: 9, tracks: 9, duration_seconds: 2000 }, top_track: null };
    else if (url.pathname.startsWith('/v1/artists/')) body = { object: 'artist', did: artistDid, handle: 'sketches.test', display_name: 'replyomatic', bio: null, avatar_url: null, support_url: null };
    await route.fulfill({ json: body });
  });
  return { context, page, errors };
}

const shot = (page, name) => page.screenshot({ path: path.join(output, `${name}.png`) });

async function startPlaying(page) {
  await page.goto(origin + '/track/' + tracks[0].id);
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await page.getByTestId('player-dock').getByRole('button', { name: 'Open now playing', exact: true }).waitFor();
}

async function wide(browser) {
  const { context, page, errors } = await setup(browser, 1440);
  try {
    await page.goto(origin + '/');
    const featured = page.getByTestId('home-featured');
    await featured.getByRole('button', { name: /^Play all 9 by replyomatic/ }).waitFor();
    await page.waitForTimeout(800);
    await shot(page, '1440-home');
    await startPlaying(page);
    const frame = await page.getByTestId('app-frame').boundingBox();
    await page.getByTestId('player-dock').getByRole('button', { name: 'Queue', exact: true }).click();
    const panel = page.getByTestId('queue-panel');
    await panel.waitFor();
    assert.match(new URL(page.url()).pathname, /^\/track\//, 'the queue opens beside the page instead of replacing it');
    const box = await panel.boundingBox();
    assert.ok(Math.abs(box.x + box.width - (frame.x + frame.width)) < 2 && box.width >= 359, 'the panel docks at the right edge');
    const content = await page.getByRole('header', { name: 'lo' }).or(page.locator('h1')).first().boundingBox().catch(() => undefined);
    if (content) assert.ok(content.x + content.width <= box.x + 1, 'the page narrows instead of sliding under the panel');
    await panel.getByText(tracks[0].metadata.title).first().waitFor();
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await page.waitForURL(origin + '/');
    await panel.waitFor();
    await page.waitForTimeout(600);
    await shot(page, '1440-panel');
    await page.reload();
    await page.getByTestId('queue-panel').waitFor();
    await page.getByTestId('queue-panel').getByRole('button', { name: 'Close queue', exact: true }).click();
    await page.getByTestId('queue-panel').waitFor({ state: 'detached' });
    await page.reload();
    await page.getByTestId('home-featured').waitFor();
    assert.equal(await page.getByTestId('queue-panel').count(), 0, 'a closed panel stays closed after reload');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function narrow(browser) {
  const { context, page, errors } = await setup(browser, 1100);
  try {
    await startPlaying(page);
    await page.getByTestId('player-dock').getByRole('button', { name: 'Queue', exact: true }).click();
    const panel = page.getByTestId('queue-panel');
    await panel.waitFor();
    const [box, frame] = await Promise.all([panel.boundingBox(), page.getByTestId('app-frame').boundingBox()]);
    assert.ok(box.x + box.width < frame.x + frame.width, 'on a narrower window the panel floats inside the edge');
    await page.waitForTimeout(400);
    await shot(page, '1100-floating');
    await page.mouse.click(300, 300);
    await panel.waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function phone(browser) {
  const { context, page, errors } = await setup(browser, 390, 844);
  try {
    await startPlaying(page);
    assert.equal(await page.getByTestId('queue-panel').count(), 0);
    await page.goto(origin + '/queue');
    await page.getByRole('heading', { name: 'queue', exact: true }).or(page.getByRole('header', { name: 'queue', exact: true })).first().waitFor();
    assert.equal(await page.getByTestId('queue-panel').count(), 0, 'phones keep the queue screen, never the panel');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    await wide(browser);
    await narrow(browser);
    await phone(browser);
    console.log('queue panel ok →', output);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exit(1); });
