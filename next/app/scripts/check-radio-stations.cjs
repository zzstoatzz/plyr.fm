// Radio: every station at once, tapping one opens the normal now playing in live mode, and leaving stops the audio.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');
const origin = 'https://next.plyr.fm';
const dist = path.resolve(__dirname, '../dist');
const did = 'did:plc:radiofixtureaaaaaaaaaaaa';
const titles = { loved: 'heavy rotation', fresh: 'first light', 'deep-cuts': 'side b, track nine', slop: 'a very long machine-made title that keeps going and going', firehose: 'segment 0412' };
const wav = (() => {
  const rate = 8000, seconds = 30, samples = rate * seconds, data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(2000 * Math.sin(2 * Math.PI * 220 * i / rate)), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
})();
const art = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#c86450"/></svg>';

async function prepare(context, reads, delay) {
  await context.addInitScript(() => {
    window.media = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { if (!window.media.includes(this)) window.media.push(this); return play.call(this); };
  });
  await context.route(origin + '/**', async route => {
    let file = path.join(dist, new URL(route.request().url()).pathname);
    try { if (!(await fs.stat(file)).isFile()) throw Error(); } catch { file = path.join(dist, 'index.html'); }
    await route.fulfill({ body: await fs.readFile(file), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html' });
  });
  await context.route('https://api.next.plyr.fm/**', route => {
    const { pathname } = new URL(route.request().url());
    const artist = pathname.match(/^\/v1\/artists\/([^/]+)$/);
    if (pathname.endsWith('/metrics')) return route.fulfill({ json: { object: 'artist_metrics', artist_did: did, totals: { plays: 2, tracks: 1, duration_seconds: 240 }, top_track: null } });
    if (artist) return route.fulfill({ json: { object: 'artist', did, handle: decodeURIComponent(artist[1]), display_name: 'artist 1', avatar_url: null, bio: null, track_count: 1 } });
    return route.fulfill({ json: { object: 'list', data: [], cursor: null } });
  });
  await context.route('https://images.plyr.fm/**', route => route.fulfill({ contentType: 'image/svg+xml', body: art }));
  await context.route('https://api.plyr.fm/audio/**', route => route.fulfill({ contentType: 'audio/wav', body: wav }));
  await context.route('https://api.plyr.fm/radio/state?*', async route => {
    const slug = new URL(route.request().url()).searchParams.get('station');
    reads.push(slug);
    if (delay.ms) await new Promise(resolve => setTimeout(resolve, delay.ms));
    const at = Object.keys(titles).indexOf(slug);
    await route.fulfill({ json: {
      current: { id: 10 + at, title: titles[slug], artist: `artist ${at}`, artist_handle: `artist${at}.test`, artist_did: did, stream_url: `https://api.plyr.fm/audio/${slug}`,
        duration: 240, artwork_url: `https://images.plyr.fm/images/${slug}.png`, thumbnail_url: null,
        atproto_record_uri: `at://${did}/fm.plyr.track/3lradio${at}`, atproto_record_cid: 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5kpqcsgz7soitae',
        created_at: '2026-11-01T00:00:00Z', like_count: 1, play_count: 2 },
      current_ends_at: new Date(Date.now() + 120_000).toISOString(), progress_seconds: 120, up_next: [],
    } });
  });
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    for (const width of [390, 1280]) {
      const reads = [], delay = { ms: 0 };
      const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: 'dark' });
      await prepare(context, reads, delay);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/radio');
      for (const title of Object.values(titles)) await page.getByText(title, { exact: false }).first().waitFor();
      assert.deepEqual([...new Set(reads)].sort(), Object.keys(titles).sort(), 'every station loads at once');
      assert.equal(reads.length, 5, 'each station is read once, not polled on a short beat');
      const tiles = await page.getByRole('button', { name: /^Listen to .* radio$/ }).evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect()));
      assert.equal(tiles.length, 5);
      assert.ok(tiles.every(tile => tile.right <= width), 'the grid fits the screen');
      const firehose = tiles[4], squares = tiles.slice(0, 4);
      if (width < 600) assert.equal(new Set(squares.map(tile => Math.round(tile.top))).size, 2, 'two rows of two on a phone');
      else assert.equal(new Set(squares.map(tile => Math.round(tile.top))).size, 1, 'one row on a wide screen');
      assert.ok(firehose.top > Math.max(...squares.map(tile => tile.top)) && firehose.width > squares[0].width * 1.9, 'firehose spans the width below the others');
      const corner = await page.getByRole('button', { name: 'Listen to loved radio', exact: true }).evaluate(node => getComputedStyle(node.firstElementChild).borderTopLeftRadius);
      assert.ok(parseFloat(corner) > 0 && parseFloat(corner) <= 16, `tiles have small rounded corners (${corner})`);
      const embed = page.getByRole('button', { name: 'embed radio in your stream' });
      assert.equal(await embed.getAttribute('aria-expanded'), 'false', 'the embed links start folded away');
      assert.equal(await page.locator('a[href*="/embed/radio"]').count(), 0);
      await embed.click();
      assert.equal(await page.locator('a[href*="/embed/radio"]').count(), 5, 'every station has an embed link');
      await page.getByRole('link', { name: 'Ana’s radio' }).waitFor();
      if (process.env.RADIO_SHOTS) await page.screenshot({ path: `${process.env.RADIO_SHOTS}-${width}-grid.png`, fullPage: true });
      assert.equal(await page.evaluate(() => window.media.length), 0, 'nothing loads audio before a station is picked');

      await page.getByRole('button', { name: 'Listen to fresh radio', exact: true }).click();
      const sheet = page.getByRole('dialog', { name: 'Now playing' });
      await sheet.waitFor();
      await sheet.getByText('fresh radio · live').waitFor();
      await sheet.getByRole('heading', { name: titles.fresh }).waitFor();
      await page.waitForFunction(() => window.media.some(audio => !audio.paused && audio.src.includes('/audio/fresh')));
      for (const name of ['Next', 'Previous', 'Queue', 'Playback position']) assert.equal(await sheet.getByLabel(name, { exact: true }).count(), 0, `no ${name} on live radio`);
      const progress = sheet.getByRole('progressbar', { name: 'Song progress' });
      assert.ok(Number(await progress.getAttribute('aria-valuenow')) >= 120, 'progress follows the station clock, not the local audio');
      await sheet.getByRole('button', { name: 'Pause', exact: true }).click();
      await page.waitForFunction(() => window.media.every(audio => audio.paused));
      await sheet.getByRole('button', { name: 'Play', exact: true }).click();
      await page.waitForFunction(() => window.media.some(audio => !audio.paused));
      if (process.env.RADIO_SHOTS) await page.screenshot({ path: `${process.env.RADIO_SHOTS}-${width}-now-playing.png` });
      await sheet.getByRole('link', { name: 'Artist: artist 1' }).click();
      await page.waitForURL(`**/u/artist1.test`);
      await page.getByText('artist 1').first().waitFor();
      assert.ok(await page.evaluate(() => window.media.some(audio => !audio.paused)), 'the radio keeps playing while you look at the artist');
      await page.getByRole('button', { name: 'Stop radio', exact: true }).click();
      await page.waitForFunction(() => window.media.every(audio => audio.paused));
      assert.equal(await page.getByRole('button', { name: 'Stop radio', exact: true }).count(), 0, 'stopping leaves the radio entirely');

      delay.ms = 3000;
      if (width < 800) await page.getByRole('link', { name: 'Home', exact: true }).click();
      await page.getByRole('link', { name: 'Radio', exact: true }).first().click();
      await page.getByText(titles.loved).first().waitFor({ timeout: 1000 });
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('radio: five stations load at once (firehose wide below the rest, rounded tiles, embed links folded into one disclosure, sister-radio credit) and redraw instantly on return; a station opens the normal now playing live (no seek, skip or queue), the artist stays tappable, and stop radio silences it');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
