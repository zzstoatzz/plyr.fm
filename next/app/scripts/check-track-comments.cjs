// Timed comments: faces on the scrubber in now playing and on the track's own screen, the passing bubble, the pile card, the list,
// and a timestamp that plays from there. Run after `npm run build:web`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { createRequire } = require('node:module');
const path = require('node:path');
const requireFrontend = createRequire(path.resolve(__dirname, '../../../frontend/package.json'));
const { chromium } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : requireFrontend('playwright');
const dist = process.env.PLAYER_DIST || path.resolve(__dirname, '../dist');
const output = process.env.COMMENTS_OUTPUT || '/tmp/plyr-track-comments';
const avatars = process.env.COMMENTS_AVATARS ? fs.readdirSync(process.env.COMMENTS_AVATARS).filter(name => name.endsWith('.jpg')).map(name => path.join(process.env.COMMENTS_AVATARS, name)) : [];
fs.mkdirSync(output, { recursive: true });

const DURATION = 600;
const uri = 'at://did:plc:fixture/fm.plyr.track/comments';
const track = {
  object: 'track', id: 'trk_' + Buffer.from(uri).toString('base64url'),
  record: { uri, cid: 'bafyfixture', revision: null, collection: 'fm.plyr.track', rkey: 'comments' },
  metadata: { title: 'lo-fi beats mix #3', description: 'a sunday mix.', album: null, duration_seconds: DURATION, created_at: '2026-10-19T00:00:00Z' },
  artist: { did: 'did:plc:fixture', profile: { handle: 'fixture.test', display_name: 'AddLine', avatar_url: null } },
  media: { artwork: { url: 'https://comments-fixture.invalid/cover.jpg' } }, access: { visibility: 'public' }, metrics: { play_count: 4, like_count: 3 }
};
const people = ['lune', 'kestrel.wav', 'mossy', 'ok fern', 'dusk club', 'tomás', 'pith', 'marlo', 'hen', 'sable', 'juno', 'wren'];
const said = [[12, 'did the intro always have that tape hiss? love it'], [40, 'before rain is SO good'], [96, 'this transition'], [150, 'the sax here'],
  [153, 'yesss'], [156, 'came here for this'], [159, 'chills'], [162, 'again'], [240, 'out of time >>>'], [330, 'saving this whole mix'],
  [400, 'who is la cantina, need more'], [470, 'study mode'], [520, 'rain sounds'], [560, 'study playlist forever'], [592, 'perfect ending']];
const comments = said.map(([seconds, text], index) => ({
  record: { uri: `at://did:plc:p${index}/fm.plyr.comment/3m${index}`, cid: `bafyc${index}`, rkey: `3m${index}` },
  author: { did: `did:plc:p${index}`, handle: `${people[index % people.length].replace(/[^a-z]/g, '')}.test`, display_name: people[index % people.length],
    avatar_url: `https://comments-fixture.invalid/avatar/${index}.jpg` },
  subject: { uri, cid: 'bafyfixture' }, text, timestamp_ms: seconds * 1000, created_at: `2026-11-1${index % 4}T09:00:00Z`, updated_at: null,
}));
const audio = Buffer.alloc(44 + 8000 * DURATION * 2);
audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
const server = http.createServer((request, response) => {
  let filename = path.join(dist, decodeURIComponent(request.url.split('?')[0]));
  if (!fs.existsSync(filename) || fs.statSync(filename).isDirectory()) filename = path.join(dist, 'index.html');
  response.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.json') ? 'application/json' : 'text/html');
  response.end(fs.readFileSync(filename));
});
let origin;

async function setup(browser, width, theme, height = 900) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, deviceScaleFactor: Number(process.env.COMMENTS_SCALE || 1) });
  await context.addInitScript(({ theme }) => localStorage.setItem('plyr-next:prefs', JSON.stringify({ theme, scale: 1, playThrough: true })), { theme });
  await context.route('**/*', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort());
  await context.route('https://comments-fixture.invalid/**', async route => {
    const url = new URL(route.request().url()).pathname;
    const avatar = /\/avatar\/(\d+)\.jpg$/.exec(url);
    if (avatar || url.endsWith('/cover.jpg')) {
      const file = avatar ? avatars[Number(avatar[1]) % (avatars.length || 1)] : process.env.COMMENTS_COVER;
      if (file && fs.existsSync(file)) await route.fulfill({ body: fs.readFileSync(file), contentType: 'image/jpeg' });
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
    HTMLMediaElement.prototype.play = function (...args) { window.__commentsMedia = this; return play.apply(this, args); };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://api.next.plyr.fm/**', async route => {
    const url = new URL(route.request().url());
    let body = { object: 'list', data: [], has_more: false };
    if (url.pathname.endsWith('/playback')) body = { object: 'playback', track_id: track.id, record: track.record,
      availability: { status: 'available', delivery: { url: 'https://comments-fixture.invalid/audio.wav', media_type: 'audio/wav' } } };
    else if (url.pathname.endsWith('/comments')) body = { object: 'list', data: comments, has_more: false };
    else if (url.pathname.startsWith('/v1/artists/') && url.pathname.endsWith('/metrics')) body = { totals: { plays: 4, tracks: 1, duration_seconds: DURATION }, top_track: null };
    else if (url.pathname.startsWith('/v1/artists/')) body = { object: 'artist', did: track.artist.did, handle: 'fixture.test', display_name: 'AddLine', bio: null, avatar_url: null, support_url: null };
    else if (url.pathname === '/v1/tracks/' + track.id) body = track;
    else if (url.pathname === '/v1/tracks') body = { object: 'list', data: [track], has_more: false };
    else if (url.pathname === '/v1/charts/tracks') body = { period: 'week', data: [] };
    await route.fulfill({ json: body });
  });
  return { context, page, errors };
}

const shot = (page, name) => page.screenshot({ path: path.join(output, `${name}.png`) });
const media = page => page.evaluate(() => window.__commentsMedia ? { time: window.__commentsMedia.currentTime, paused: window.__commentsMedia.paused } : undefined);

async function facesInside(page, scope) {
  const [row, faces] = await Promise.all([scope.getByTestId('scrubber-faces').boundingBox(),
    scope.getByTestId('scrubber-faces').getByRole('button').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()))]);
  assert.ok(faces.length > 0, 'faces render on the scrubber');
  for (const face of faces) assert.ok(face.left >= row.x - 0.5 && face.right <= row.x + row.width + 0.5, 'every pile stays inside the scrubber');
  return faces;
}

async function trackScreen(browser, width, theme) {
  const { context, page, errors } = await setup(browser, width, theme);
  const name = `${width}-${theme}`;
  try {
    await page.goto(origin + '/track/' + track.id);
    await page.getByRole('header', { name: /^comments/ }).or(page.getByRole('heading', { name: /^comments/ })).waitFor();
    await page.getByTestId('comment-row').first().waitFor();
    assert.equal(await page.getByTestId('comment-row').count(), comments.length);
    const texts = await page.getByTestId('comment-row').allInnerTexts();
    assert.ok(texts[0].includes('tape hiss') && texts.at(-1).includes('perfect ending'), 'comments read in time order');
    await page.getByRole('link', { name: 'Sign in to comment' }).waitFor();
    const faces = await facesInside(page, page);
    assert.ok(faces.length < comments.length, 'close comments share a pile');
    await page.getByTestId('comment-row').first().scrollIntoViewIfNeeded();
    await page.getByRole('header', { name: /^comments/ }).or(page.getByRole('heading', { name: /^comments/ })).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot(page, name + '-track-comments');
    await page.getByRole('button', { name: 'Play from 4:00' }).click();
    await page.waitForFunction(() => window.__commentsMedia && !window.__commentsMedia.paused && window.__commentsMedia.currentTime >= 239);
    const playing = await media(page);
    assert.ok(playing.time >= 239 && playing.time < 250, `a timestamp plays from there (at ${playing.time})`);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function nowPlaying(browser, width, theme) {
  const { context, page, errors } = await setup(browser, width, theme);
  const name = `${width}-${theme}`;
  try {
    await page.goto(origin + '/track/' + track.id);
    await page.getByRole('button', { name: 'Play from 2:30' }).click();
    await page.waitForFunction(() => window.__commentsMedia && !window.__commentsMedia.paused && window.__commentsMedia.currentTime >= 150);
    await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Now playing' });
    await sheet.getByTestId('scrubber-faces').waitFor();
    await sheet.getByTestId('scrubber-bubble').waitFor();
    assert.match(await sheet.getByTestId('scrubber-bubble').innerText(), /ok fern|yesss|came here|chills/);
    const [bubble, slider] = await Promise.all([sheet.getByTestId('scrubber-bubble').boundingBox(), sheet.getByRole('slider', { name: 'Playback position' }).boundingBox()]);
    assert.ok(bubble.y + bubble.height <= slider.y + 4, 'the bubble sits above the scrubber, never over the thumb');
    await facesInside(page, sheet);
    await page.waitForTimeout(250);
    await shot(page, name + '-now-playing-passing');
    await page.evaluate(() => { window.__commentsMedia.pause(); window.__commentsMedia.currentTime = 200; });
    await page.waitForTimeout(500);
    const pile = sheet.getByRole('button', { name: /^6 comments from 2:30/ });
    await pile.hover();
    const card = sheet.getByTestId('scrubber-card');
    await card.waitFor();
    await card.getByRole('link', { name: 'See all 15 comments' }).waitFor();
    assert.match(await card.innerText(), /3 more here · see all 15 comments/);
    assert.equal(await sheet.getByTestId('scrubber-bubble').count(), 0, 'no bubble while paused or while a card is open');
    await shot(page, name + '-now-playing-pile');
    await page.mouse.move(5, 5);
    await card.waitFor({ state: 'detached' });
    await sheet.getByRole('link', { name: 'See all 15 comments' }).waitFor();
    await page.getByRole('link', { name: 'Sign in to comment' }).first().waitFor();
    await shot(page, name + '-now-playing-idle');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    for (const [width, theme] of [[1280, 'dark'], [1280, 'light'], [390, 'dark']]) {
      await trackScreen(browser, width, theme);
      await nowPlaying(browser, width, theme);
    }
    console.log('track comments ok →', output);
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
