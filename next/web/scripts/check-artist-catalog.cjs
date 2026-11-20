const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { artistDid, tracks, setup, serve, close } = require('./fixture-catalog.cjs');
const { method, names, trackIdFromUri, uriFromId } = require('./xrpc-fixture.cjs');

const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-svelte-artist';
const api = 'https://api.next.plyr.fm';
const artistPath = '/u/sketches.test';
const artistName = 'a rather long name for an artist who records at home';
const album = {
  object: 'album',
  id: 'alb_fixture',
  record: { uri: `at://${artistDid}/fm.plyr.list/catalog`, cid: 'bafyfixture', collection: 'fm.plyr.list', rkey: 'catalog' },
  metadata: { name: 'Porch recordings', created_at: tracks[0].metadata.created_at, updated_at: null },
  owner: { did: artistDid, profile: tracks[0].artist.profile },
  metrics: { member_count: 2, available_count: 1, total_plays: 12 },
  members: [
    { position: 0, subject: tracks[0].record, availability: 'available', track: tracks[0] },
    { position: 1, subject: tracks[1].record, availability: 'unavailable', track: null }
  ]
};
const albumPage = [
  { ...album, id: 'alb_second', metadata: { ...album.metadata, name: 'A second album' } },
  { ...album, id: 'alb_empty', metadata: { ...album.metadata, name: 'A private draft' }, metrics: { member_count: 0, available_count: 0, total_plays: 0 } }
];
const pageOf = (data, cursor) => ({ object: 'list', data, has_more: !!cursor, next_cursor: cursor });
const fail = (route, message) => route.fulfill({ status: 503, json: { error: { message } } });

async function verify(browser, origin, width, scheme) {
  const phone = width === 390;
  const { context, page, errors } = await setup(browser, width, phone ? 844 : 960, { phone, scheme, scale: phone && scheme === 'dark' ? 2 : 1 });
  const reads = { tracks: 0, albums: 0, metrics: 0, playback: 0 };
  let whitespace = false;
  let listening = true;
  try {
    await page.addInitScript(() => {
      const NativeAudio = window.Audio;
      window.createdAudio = [];
      window.Audio = class extends NativeAudio {
        constructor(...args) { super(...args); window.createdAudio.push(this); }
      };
    });
    page.on('request', request => {
      if (method(new URL(request.url())) === 'getPlayback') reads.playback++;
    });
    await page.route(url => url.origin === api && method(url) === 'getArtist' && url.searchParams.get('actor') === 'sketches.test', route => route.fulfill({ json: {
      object: 'artist', did: artistDid, handle: 'sketches.test', display_name: whitespace ? ' \t ' : artistName,
      bio: 'Recordings from an afternoon at home.', avatar_url: 'https://panel-fixture.invalid/avatar.jpg',
      support_url: whitespace ? 'javascript:alert(1)' : 'https://example.test/support'
    } }));
    await page.route(url => url.origin === api && method(url) === 'getArtistMetrics' && url.searchParams.get('actor') === artistDid, route => {
      reads.metrics++;
      if (reads.metrics === 1) return fail(route, 'totals unavailable');
      return route.fulfill({ json: { object: 'artist_metrics', artist_did: artistDid, totals: { tracks: 2, plays: 1, duration_seconds: 180 }, top_track: null } });
    });
    await page.route(`${api}/xrpc/fm.plyr.unspecced.listTracks?**`, route => {
      const params = new URL(route.request().url()).searchParams;
      if (params.get('artistDid') !== artistDid) return route.fallback();
      reads.tracks++;
      return route.fulfill({ json: params.has('cursor') ? pageOf([tracks[1]]) : pageOf([tracks[0]], 'next-track') });
    });
    await page.route(`${api}/xrpc/fm.plyr.unspecced.listAlbums?**`, route => {
      reads.albums++;
      if (reads.albums === 1) return fail(route, 'album catalog unavailable');
      const params = new URL(route.request().url()).searchParams;
      return route.fulfill({ json: params.has('cursor') ? pageOf(albumPage) : pageOf([album], 'next-album') });
    });
    await page.route(url => url.origin === api && method(url) === 'getAlbum' && names(url, album.id), route => route.fulfill({ json: album }));
    await page.route(`https://plc.directory/${artistDid}`, route => route.fulfill({ json: {
      id: artistDid, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.fixture.invalid' }]
    } }));
    await page.route('https://pds.fixture.invalid/xrpc/com.atproto.repo.getRecord?**', route => {
      const params = new URL(route.request().url()).searchParams;
      if (params.get('collection') !== 'fm.teal.actor.status' || params.get('rkey') !== 'self') return route.fulfill({ status: 400, json: { error: 'RecordNotFound' } });
      const started = Date.now() - 65_000;
      return route.fulfill({ json: { uri: `at://${artistDid}/fm.teal.actor.status/self`, value: {
        $type: 'fm.teal.actor.status', time: new Date(started).toISOString(), expiry: new Date(listening ? started + 600_000 : started + 1000).toISOString(),
        item: { trackName: 'Morning drone', artists: [{ artistName: 'Field Band' }], releaseName: 'Tapes', duration: 200,
          playedTime: new Date(started).toISOString(), originUri: `https://plyr.fm/track/${tracks[0].id}` }
      } } });
    });

    await page.goto(origin + artistPath);
    await page.getByRole('heading', { name: artistName, exact: true }).waitFor();
    const nowListening = page.getByRole('link', { name: `${artistName} is listening to Morning drone by Field Band`, exact: true });
    await nowListening.waitFor();
    assert.equal(await nowListening.getAttribute('href'), `/track/${tracks[0].id}`);
    assert.match(await nowListening.innerText(), /^listening to Morning drone\s·\sField Band$/);
    const support = page.getByRole('link', { name: /^Support .+ at example\.test\/support$/ });
    assert.equal(await support.getAttribute('href'), 'https://example.test/support');
    assert.equal(await page.getByRole('link', { name: 'edit profile' }).count(), 0);
    await page.getByText('couldn’t load totals.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'retry totals' }).click();
    await page.getByText('of music', { exact: false }).waitFor();
    assert.equal(await page.locator('.hero-chip').allTextContents().then(chips => chips.join(' | ')), '1 play | 2 tracks | 3m of music');
    const tabs = page.getByRole('tablist', { name: 'Artist catalog' });
    const tab = name => tabs.getByRole('tab', { name, exact: true });
    const panel = name => page.getByRole('tabpanel', { name, exact: true });
    assert.equal(await tab('tracks').getAttribute('aria-selected'), 'true');
    const firstTrack = panel('tracks').getByRole('link', { name: tracks[0].metadata.title, exact: true });
    await firstTrack.waitFor();
    assert.equal(reads.albums, 0, 'the albums endpoint stays lazy');

    await page.getByRole('button', { name: 'more tracks', exact: true }).click();
    const secondTrack = panel('tracks').getByRole('link', { name: tracks[1].metadata.title, exact: true });
    await secondTrack.waitFor();
    await page.getByRole('button', { name: `Play ${artistName}`, exact: true }).click();
    await page.waitForFunction(() => window.createdAudio.some(audio => audio.currentTime > 0 && !audio.paused));
    await page.evaluate(() => { window.catalogAudio = window.createdAudio.find(audio => !audio.paused); });
    const continuity = async () => {
      const position = await page.evaluate(() => window.catalogAudio.currentTime);
      await page.waitForFunction(before => window.catalogAudio.currentTime > before && !window.catalogAudio.paused, position);
      assert.equal(reads.playback, 1, 'route and tab changes leave the playing delivery alone');
    };
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-tracks.png`) });

    await tab('albums').click();
    await panel('albums').getByText('album catalog unavailable', { exact: true }).waitFor();
    await panel('albums').getByRole('button', { name: 'retry', exact: true }).click();
    await panel('albums').getByRole('link', { name: /Porch recordings/ }).waitFor();
    await panel('albums').getByRole('button', { name: 'more albums' }).click();
    await panel('albums').getByRole('link', { name: /A second album/ }).waitFor();
    assert.equal(await panel('albums').getByRole('link', { name: /A private draft|new album/ }).count(), 0);
    await tab('playlists').click();
    await panel('playlists').getByText('no playlists yet.').waitFor();
    await tab('likes').click();
    await panel('likes').getByText('no likes yet.').waitFor();
    await tab('likes').press('Home');
    await secondTrack.waitFor();
    assert.equal(await tab('tracks').getAttribute('tabindex'), '0');
    assert.equal(await tab('likes').getAttribute('tabindex'), '-1');
    await page.keyboard.press('ArrowRight');
    await panel('albums').getByRole('link', { name: /A second album/ }).waitFor();
    assert.equal(await tab('albums').evaluate(node => document.activeElement === node), true);
    assert.deepEqual({ tracks: reads.tracks, albums: reads.albums }, { tracks: 2, albums: 3 }, 'tab changes reuse the two loaded pages');
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'albums');
    await continuity();
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-albums.png`) });

    await panel('albums').getByRole('link', { name: /Porch recordings/ }).click();
    await page.getByRole('heading', { name: 'Porch recordings' }).waitFor();
    await page.getByText('track unavailable', { exact: true }).waitFor();
    await continuity();
    await page.goBack();
    await page.waitForURL(origin + artistPath + '?tab=albums');
    await panel('albums').getByRole('link', { name: /A second album/ }).waitFor();
    assert.deepEqual({ tracks: reads.tracks, albums: reads.albums }, { tracks: 2, albums: 3 }, 'Back restores the section and its loaded pages');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'the catalog fits the viewport');
    await continuity();

    whitespace = true;
    listening = false;
    await page.reload();
    await page.getByRole('heading', { name: 'sketches.test', exact: true }).waitFor();
    assert.equal(await page.title(), 'sketches.test · plyr.fm');
    assert.equal(await support.count(), 0, 'only a web URL renders as a support link');
    assert.equal(await page.getByText('listening to').count(), 0, 'an expired status shows nothing');
    await panel('albums').getByRole('link', { name: /Porch recordings/ }).waitFor();
    assert.deepEqual(errors, []);
    console.log(`${width}px ${scheme}: artist paging, retries, keyboard tabs, Back and playback continuity passed`);
  } finally {
    await context.close();
  }
}

(async () => {
  const origin = await serve();
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1280]) {
      for (const scheme of ['light', 'dark']) await verify(browser, origin, width, scheme);
    }
  } finally {
    await browser.close();
    close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
