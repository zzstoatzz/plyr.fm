const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
process.env.PLAYER_DIST ??= path.resolve(__dirname, '../build');
const { tracks, setup, serve, close } = require('./fixture-catalog.cjs');
const { method, trackIdFromUri } = require('./xrpc-fixture.cjs');

const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-svelte-radio';
const slugs = ['loved', 'fresh', 'deep-cuts', 'slop', 'firehose'];
const airing = tracks[1];
const titles = ['Heavy rotation', airing.metadata.title, 'Side B, track nine', 'Long station title that does not fit in one line', 'on air now'];
const broadcastDir = path.join(__dirname, 'fixtures/live-hls');
const broadcastCover = 'https://live-fixture.invalid/firehose/cover.png';
const radioUri = slug => `at://did:plc:fixtureartist/fm.plyr.track/radio-${slug}`;
const id = uri => 'trk_' + Buffer.from(uri).toString('base64url');
const audio = Buffer.alloc(44 + 8000 * 2 * 10);
audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);

async function fixture(browser, width, scheme, fastChange = false) {
  const { context, page, errors } = await setup(browser, width, 884, { phone: width === 390, scheme });
  await context.addInitScript(() => {
    window.media = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!window.media.includes(this)) window.media.push(this);
      return play.call(this);
    };
  });
  const starts = new Map();
  const reads = new Map();
  const receipts = [];
  const appViewWrites = [];
  await context.route('https://api.plyr.fm/**', route => {
    if (new URL(route.request().url()).pathname === '/tracks/42') return route.fulfill({ json: { atproto_record_uri: tracks[0].record.uri } });
    return route.abort();
  });
  await page.route('https://api.next.plyr.fm/xrpc/fm.plyr.unspecced.getRadioState?**', route => {
    const url = new URL(route.request().url());
    const slug = url.searchParams.get('station');
    if (!slugs.includes(slug)) return route.abort();
    assert.equal(route.request().method(), 'GET');
    assert.equal(url.searchParams.get('catalogOnly'), slug === 'firehose' ? 'false' : 'true', 'only the broadcasting station asks for its live stream');
    const now = Date.now();
    if (!starts.has(slug)) starts.set(slug, now);
    const start = starts.get(slug);
    const changed = fastChange && now >= start + 6500;
    const title = changed ? 'Next live song' : titles[slugs.indexOf(slug)];
    reads.set(slug, (reads.get(slug) ?? 0) + 1);
    // Like the real station: a sonified broadcast with no rotation behind it.
    if (slug === 'firehose') return route.fulfill({ json: {
      station: 'firehose', current: null, current_ends_at: null, progress_seconds: 0, up_next: [],
      live: { stream_url: 'https://live-fixture.invalid/firehose/index.m3u8', kind: 'hls', started_at: '2026-11-15T06:46:15Z', artwork_url: broadcastCover }
    } });
    return route.fulfill({ json: {
      current: {
        id: slugs.indexOf(slug) + 1, title, artist: 'Fixture radio artist', artist_handle: 'sketches.test', artist_did: 'did:plc:fixtureartist',
        stream_url: `https://live-fixture.invalid/${slug}-${changed ? 'next' : 'first'}.wav`, duration: 10,
        artwork_url: `https://panel-fixture.invalid/art/${slugs.indexOf(slug)}.jpg`, thumbnail_url: null,
        atproto_record_uri: slug === 'fresh' ? airing.record.uri : radioUri(changed ? slug + '-next' : slug),
        atproto_record_cid: 'fixture-cid', created_at: '2026-11-14T00:00:00Z',
        like_count: 1, play_count: 0
      },
      current_ends_at: new Date(start + (fastChange && !changed ? 6500 : 50_000)).toISOString(),
      progress_seconds: changed ? 0.25 : 0.4 + Math.min(3, (now - start) / 1000),
      up_next: []
    } });
  });
  await context.route('https://live-fixture.invalid/firehose/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (name === 'cover.png') return route.fulfill({ contentType: 'image/png', body: await fs.readFile(path.join(__dirname, '../static/apple-touch-icon.png')).catch(() => Buffer.alloc(0)) });
    const type = name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
    return route.fulfill({ contentType: type, body: await fs.readFile(path.join(broadcastDir, path.basename(name))), headers: { 'access-control-allow-origin': '*' } });
  });
  await context.route(/^https:\/\/live-fixture\.invalid\/(?!firehose\/)/, route => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
    const from = range ? Number(range[1]) : 0;
    const to = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav', body: audio.subarray(from, to + 1),
      headers: { 'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${from}-${to}/${audio.length}` } : {}) } });
  });
  await page.route('https://api.next.plyr.fm/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'POST') return route.fallback();
    const trackId = method(url) === 'recordPlay' && url.searchParams.get('uri') ? trackIdFromUri(url.searchParams.get('uri')) : undefined;
    if (!trackId) { appViewWrites.push(url.pathname); return route.abort(); }
    const occurrence = url.searchParams.get('occurrence');
    receipts.push({ trackId, occurrence });
    return route.fulfill({ json: {
      object: 'play_receipt', track_id: trackId, occurrence, play_count: 1, counted: true,
      record: { uri: Buffer.from(trackId.slice(4), 'base64url').toString() },
      sources: { metrics: 'application_metrics', dedup: 'postgres_durable' },
      dedup: { status: 'claimed', window_seconds: 30 }
    } });
  });
  return { context, page, errors, reads, receipts, appViewWrites };
}

async function stationFlow(browser, origin, width, scheme) {
  const { context, page, errors, reads, appViewWrites } = await fixture(browser, width, scheme);
  try {
    await page.goto(origin + '/track/' + tracks[0].id);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const dock = page.getByTestId('player-dock');
    await dock.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await dock.getByRole('slider', { name: 'Playback position' }).fill('12');
    await dock.getByRole('button', { name: 'Pause', exact: true }).click();
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    if (width < 720) {
      await nav.getByRole('link', { name: 'home', exact: true }).click();
      await page.getByText('✻', { exact: true }).filter({ visible: true }).click();
      await page.getByRole('navigation', { name: 'Explore' }).getByRole('link', { name: 'radio' }).click();
    } else await nav.getByRole('link', { name: 'radio', exact: true }).click();

    const grid = page.getByTestId('radio-stations');
    for (const title of titles) await grid.getByText(new RegExp(title)).waitFor();
    assert.deepEqual([...reads.keys()].sort(), [...slugs].sort());
    assert.ok([...reads.values()].every(count => count === 1));
    assert.ok(await grid.evaluate(node => node.scrollWidth === node.clientWidth));
    const rows = await grid.getByRole('button').evaluateAll(nodes => nodes.slice(0, 4).map(node => Math.round(node.getBoundingClientRect().top)));
    assert.equal(new Set(rows).size, width < 600 ? 2 : 1);
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-stations.png`) });

    await grid.getByRole('button', { name: 'Listen to fresh radio', exact: true }).click();
    const now = page.getByRole('dialog', { name: 'Now playing' });
    await now.getByRole('heading', { name: airing.metadata.title, exact: true }).waitFor();
    assert.ok(await now.evaluate(node => document.activeElement === node), 'radio card pointer opens focus the sheet');
    await now.getByText('live · fresh radio', { exact: true }).waitFor();
    await page.waitForFunction(() => window.media.some(media => !media.paused && media.src.includes('fresh-first')));
    assert.equal(await now.getByRole('slider').count(), 0);
    assert.equal(await now.getByRole('button', { name: 'Next track' }).count(), 0);
    assert.ok(Number(await now.getByRole('progressbar', { name: 'Song progress' }).getAttribute('value')) >= 0.4);
    assert.deepEqual(await page.evaluate(() => { const meta = navigator.mediaSession.metadata; return meta && [meta.title, meta.album, navigator.mediaSession.playbackState]; }),
      [airing.metadata.title, 'fresh radio', 'playing'], 'radio fills the lock screen like any track');
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-live.png`) });
    assert.equal(new URL(page.url()).pathname, '/radio/fresh', 'the address bar names the station on air');
    await now.getByRole('button', { name: 'Share station', exact: true }).waitFor();
    await now.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.waitForFunction(() => window.media.every(media => media.paused));
    await now.getByRole('button', { name: 'Listen live', exact: true }).click();
    await page.waitForFunction(() => window.media.some(media => !media.paused));
    await now.getByRole('link', { name: 'Fixture radio artist' }).click();
    await page.waitForURL('**/u/**');
    assert.ok(await page.evaluate(() => window.media.some(media => !media.paused && media.src.includes('fresh-first'))));
    await now.waitFor({ state: 'hidden' });
    await page.keyboard.press('Space');
    await dock.getByRole('button', { name: 'Listen live', exact: true }).waitFor();
    await page.waitForFunction(() => window.media.every(media => media.paused));
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.media.some(media => !media.paused && media.src.includes('fresh-first')));
    await dock.getByRole('button', { name: 'Open now playing' }).click();
    await now.getByRole('button', { name: 'leave radio' }).click();
    await dock.getByText(tracks[0].metadata.title).waitFor();
    await dock.getByRole('button', { name: 'Play', exact: true }).waitFor();
    const resumedAt = Number(await dock.getByRole('slider', { name: 'Playback position' }).inputValue());
    assert.ok(resumedAt >= 11.5 && resumedAt < 14, 'leaving radio restores the personal checkpoint');

    await page.goto(origin + '/radio');
    await grid.getByRole('button', { name: 'Listen to fresh radio', exact: true }).click();
    await now.getByRole('link', { name: 'Fixture radio artist' }).click();
    await page.getByRole('button', { name: 'Play ' + airing.metadata.title, exact: true }).click();
    await dock.getByRole('slider', { name: 'Playback position' }).waitFor({ timeout: 5000 });
    await page.waitForFunction(() => window.media.some(media => !media.paused && media.src.includes('/audio.wav')));
    await page.getByRole('button', { name: 'Pause ' + airing.metadata.title, exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-radio-to-track.png`) });

    assert.deepEqual(appViewWrites, []);
    assert.deepEqual(errors, []);
    console.log(`station grid, live controls and queue handoff passed at ${width}px (${scheme})`);
  } finally { await context.close(); }
}

async function linkedStationFlow(browser, origin, width) {
  const { context, page, errors } = await fixture(browser, width, 'dark');
  try {
    await page.goto(origin + '/radio/deep-cuts');
    const linked = page.getByTestId('radio-linked');
    await linked.getByText('deep cuts radio', { exact: true }).waitFor();
    assert.equal(await page.title(), 'deep cuts radio · plyr.fm');
    assert.ok(await page.evaluate(() => window.media.every(media => media.paused)), 'a link waits for a tap before it plays');
    await linked.getByRole('button', { name: 'share' }).waitFor();
    await page.screenshot({ path: path.join(output, `${width}-linked-station.png`) });
    await linked.getByRole('button', { name: 'listen' }).click();
    const now = page.getByRole('dialog', { name: 'Now playing' });
    await now.getByText('live · deep cuts radio', { exact: true }).waitFor();
    await page.waitForFunction(() => window.media.some(media => !media.paused));
    await now.getByRole('button', { name: 'leave radio' }).click();
    await page.goto(origin + '/radio/jazz');
    await page.getByText("we couldn't find that station").waitFor();
    assert.deepEqual(errors, []);
    console.log(`a station link opens that station and waits for a tap at ${width}px`);
  } finally { await context.close(); }
}

async function broadcastFlow(browser, origin, width) {
  const { context, page, errors, receipts } = await fixture(browser, width, 'dark');
  try {
    await page.goto(origin + '/radio');
    const grid = page.getByTestId('radio-stations');
    const card = grid.getByRole('button', { name: 'Listen to firehose radio', exact: true });
    await card.getByText('on air now').waitFor();
    await page.waitForFunction(cover => [...document.querySelectorAll('[data-testid="radio-stations"] img')].some(img => img.currentSrc.includes(encodeURIComponent(cover)) || img.currentSrc === cover), broadcastCover);
    await card.click();
    const now = page.getByRole('dialog', { name: 'Now playing' });
    await now.getByRole('heading', { name: 'firehose', exact: true }).waitFor();
    await now.getByText('live · firehose radio', { exact: true }).waitFor();
    assert.equal(await now.getByRole('link', { name: 'the atproto firehose, sonified' }).count(), 0, 'a broadcast has no artist page to link to');
    await page.waitForFunction(() => window.media.some(media => !media.paused && media.currentTime > 0.5), null, { timeout: 15_000 });
    assert.deepEqual(await page.evaluate(() => { const meta = navigator.mediaSession.metadata; return meta && [meta.title, meta.artist, meta.album, meta.artwork.length, navigator.mediaSession.playbackState]; }),
      ['firehose', 'the atproto firehose, sonified', 'firehose radio', 1, 'playing'], 'the broadcast fills the lock screen');
    await page.screenshot({ path: path.join(output, `${width}-firehose-live.png`) });
    await now.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.waitForFunction(() => window.media.every(media => media.paused));
    await now.getByRole('button', { name: 'Listen live', exact: true }).click();
    await page.waitForFunction(() => window.media.some(media => !media.paused));
    await now.getByRole('button', { name: 'leave radio' }).click();
    await page.waitForFunction(() => window.media.every(media => media.paused));
    assert.deepEqual(receipts, [], 'a broadcast is never counted as a catalog play');
    assert.deepEqual(errors, []);
    console.log(`firehose broadcast plays over hls with lock screen metadata at ${width}px`);
  } finally { await context.close(); }
}

async function accountingAndEmbeds(browser, origin) {
  const { context, page, errors, receipts } = await fixture(browser, 600, 'dark', true);
  try {
    await page.goto(origin + '/embed/radio?station=loved&autoplay=1');
    const card = page.getByTestId('radio-embed');
    await card.getByText('Heavy rotation').waitFor();
    await page.waitForFunction(() => window.media.some(media => !media.paused && media.src.includes('loved-first')));
    assert.equal(await page.getByRole('navigation', { name: 'Main navigation' }).count(), 0);
    assert.equal(await page.getByTestId('player-dock').count(), 0);
    await card.getByText('Next live song').waitFor();
    await page.waitForFunction(() => window.media.some(media => !media.paused && media.src.includes('loved-next')));
    assert.equal(receipts.filter(item => item.trackId === id(radioUri('loved'))).length, 1, 'first airing earns one canonical play');
    assert.match(receipts[0].occurrence, /^[a-f0-9-]+$/i);
    await card.getByRole('button', { name: 'Pause' }).click();
    await page.waitForFunction(() => window.media.every(media => media.paused));
    assert.equal(await page.evaluate(async () => (await indexedDB.databases()).some(db => db.name === 'plyr-next-queue')), false);
    await page.screenshot({ path: path.join(output, 'radio-embed.png') });

    await page.setViewportSize({ width: 600, height: 140 });
    await page.goto(origin + '/embed/track/42');
    const trackEmbed = page.getByTestId('track-embed');
    await trackEmbed.getByRole('link', { name: tracks[0].metadata.title }).waitFor();
    await trackEmbed.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => window.media.some(media => !media.paused && media.src.includes('audio.wav')));
    await trackEmbed.getByRole('slider', { name: 'Playback position' }).fill('10');
    await page.waitForFunction(() => window.media.some(media => media.currentTime >= 9.5));
    assert.equal(await trackEmbed.getByRole('link', { name: tracks[0].metadata.title }).getAttribute('target'), '_blank');
    await page.screenshot({ path: path.join(output, 'track-embed.png') });
    await page.goto(origin + '/embed/u/sketches.test');
    await page.getByRole('heading', { name: 'replyomatic' }).waitFor();
    await page.getByRole('link', { name: tracks[0].metadata.title }).waitFor();
    assert.deepEqual(errors, []);
    console.log('embed autoplay, canonical radio accounting, station rollover, legacy track links and isolated playback passed');
  } finally { await context.close(); }
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const origin = await serve();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    for (const width of [390, 1280]) for (const scheme of ['light', 'dark']) await stationFlow(browser, origin, width, scheme);
    for (const width of [390, 1280]) await broadcastFlow(browser, origin, width);
    for (const width of [390, 1280]) await linkedStationFlow(browser, origin, width);
    await accountingAndEmbeds(browser, origin);
  } finally { await browser.close(); close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
