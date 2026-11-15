const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
process.env.PLAYER_DIST ??= path.resolve(__dirname, '../build');
const { tracks, collectionTracks, setup, serve, close } = require('./fixture-catalog.cjs');

let origin = process.env.NEXT_WEB_URL;
const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-svelte-shell';

async function screen(browser, phone, scheme) {
  const width = phone ? 390 : 1280;
  const { context, page, errors } = await setup(browser, width, phone ? 844 : 960, { phone, scheme });
  const capture = async name => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' fits the window');
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-${name}.png`) });
  };
  try {
    const featuredTracks = [tracks[0], tracks[1], {
      ...tracks[2],
      artist: { ...tracks[2].artist, did: 'did:plc:otherartist', profile: { ...tracks[2].artist.profile, display_name: 'another artist' } }
    }];
    await page.route('https://api.next.plyr.fm/v1/charts/tracks?**', route => {
      if (new URL(route.request().url()).searchParams.get('period') !== 'all_time') return route.fallback();
      return route.fulfill({ json: { data: featuredTracks.map(track => ({ track })) } });
    });
    const linkedTrack = { ...tracks[0], legacy_id: 1667, metadata: { ...tracks[0].metadata, tags: ['ambient', 'home recordings', 'field & nature'] } };
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: async ({ url }) => sessionStorage.setItem('shared-track', url) });
    });
    await page.route(/^https:\/\/api\.next\.plyr\.fm\/v1\/tracks(?:\?|$)/, route => route.fulfill({
      json: { object: 'list', data: [linkedTrack, ...tracks.slice(1)], has_more: false }
    }));
    await page.route('https://api.next.plyr.fm/v1/tracks/1667', route => route.fulfill({ json: linkedTrack }));
    await page.route('https://api.next.plyr.fm/v1/tracks/' + tracks[0].id, route => route.fulfill({ json: linkedTrack }));
    await page.goto(origin + '/track/' + tracks[0].id + '?ref=fixture');
    await page.waitForURL('**/track/1667?ref=fixture');
    await page.getByRole('heading', { name: linkedTrack.metadata.title, exact: true }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: linkedTrack.metadata.title, exact: true }).waitFor();
    const commentsRequests = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname.endsWith('/comments')) commentsRequests.push(request);
    });
    await page.goto(origin);
    await page.getByTestId('home-track-row').first().waitFor();
    await page.getByTestId('home-chart').waitFor();
    const featured = page.getByTestId('home-featured');
    const artistPath = await featured.getByRole('link').getAttribute('href');
    const expectedCovers = featuredTracks.filter(track => artistPath === '/u/' + track.artist.did).map(track => track.media.artwork.url);
    assert.ok(expectedCovers.length > 0, 'the spotlight selected a fixture artist');
    assert.deepEqual(await featured.locator('img').evaluateAll(images => images.map(image => image.src)), expectedCovers,
      'the artist spotlight only uses covers from the selected artist');
    await capture('home');
    if (phone) {
      const links = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link');
      assert.deepEqual((await links.allTextContents()).map(label => label.trim().replace(/sign in$/, '')), ['home', 'search', 'library', 'account']);
    }
    await page.getByRole('button', { name: 'Open links menu' }).click();
    const linksMenu = page.getByRole('dialog', { name: 'links' });
    await linksMenu.getByRole('link', { name: 'documentation docs.plyr.fm' }).waitFor();
    await linksMenu.getByRole('link', { name: 'status page' }).waitFor();
    await capture('links-menu');
    await page.keyboard.press('Escape');
    await linksMenu.waitFor({ state: 'hidden' });

    const firstRow = page.getByTestId('home-track-row').first();
    await firstRow.getByRole('link', { name: 'replyomatic', exact: true }).click();
    await page.waitForURL('**/u/' + tracks[0].artist.did);
    await page.goBack();
    const firstTitle = firstRow.getByRole('link', { name: tracks[0].metadata.title, exact: true });
    assert.equal(await firstTitle.getAttribute('href'), '/track/1667');
    await firstTitle.click();
    await page.waitForURL('**/track/1667');
    await page.getByRole('heading', { name: tracks[0].metadata.title, exact: true }).waitFor();
    const tags = page.getByRole('navigation', { name: 'Tags', exact: true });
    const tag = tags.getByRole('link', { name: 'field & nature', exact: true });
    assert.equal(new URL(await tag.getAttribute('href'), origin).searchParams.get('tag'), 'field & nature');
    assert.equal(await page.getByText('A recording made at dawn.', { exact: false }).isVisible(), false);
    await page.getByText('details', { exact: true }).click();
    await page.getByText('A recording made at dawn.', { exact: false }).waitFor();
    await capture('track');
    assert.equal(commentsRequests.length, 0, 'track render leaves comment fetch deferred');
    const opener = page.getByRole('button', { name: 'comments', exact: true });
    await opener.click();
    const comments = page.getByRole('dialog', { name: 'comments', exact: true });
    await comments.getByText('I love this moment.').waitFor();
    assert.equal(commentsRequests.length, 1);
    await comments.getByRole('link', { name: 'A Listener' }).waitFor();
    await capture('track-comments');
    await page.keyboard.press('Escape');
    await comments.waitFor({ state: 'hidden' });
    assert.ok(await opener.evaluate(node => node === document.activeElement));
    let releaseDelivery;
    let deliveries = 0;
    const waiting = new Promise(resolve => { releaseDelivery = resolve; });
    const playbackUrl = 'https://api.next.plyr.fm/v1/tracks/' + tracks[0].id + '/playback';
    await page.route(playbackUrl, async route => { deliveries++; await waiting; await route.fallback(); });
    const loading = page.waitForRequest(playbackUrl);
    await page.getByRole('article').getByRole('button', { name: 'Play', exact: true }).click();
    await loading;
    await opener.click();
    await comments.getByRole('button', { name: 'Play from 0:14' }).click();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'home', exact: true }).click();
    await page.waitForURL(origin + '/');
    releaseDelivery();
    const dock = page.getByTestId('player-dock');
    const slider = dock.getByRole('slider', { name: 'Playback position' });
    await page.waitForFunction(node => node.valueAsNumber >= 14, await slider.elementHandle());
    assert.equal(deliveries, 1, 'choosing a timestamp during delivery does not start it again');
    await page.getByTestId('home-track-row').first().getByRole('link', { name: tracks[0].metadata.title, exact: true }).click();
    await dock.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('article').getByRole('button', { name: 'Play', exact: true }).click();
    await dock.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
    await dock.getByRole('button', { name: 'Open now playing' }).click();
    const dialog = page.getByRole('dialog', { name: 'Now playing' });
    await dialog.getByRole('heading', { name: tracks[0].metadata.title }).waitFor();
    await page.waitForFunction(node => getComputedStyle(node).transform === 'none', await dialog.getByTestId('now-playing-dismiss-region').elementHandle());
    const cover = await dialog.getByTestId('now-playing-artwork').boundingBox();
    if (phone) assert.ok(cover.width >= width - 35, 'now playing cover fills the phone');
    await dialog.getByRole('button', { name: 'Share track' }).click();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('shared-track')), origin + '/track/1667');
    await capture('now-playing');
    await dialog.getByRole('slider', { name: 'Playback position' }).fill('12');
    if (phone) {
      const client = await context.newCDPSession(page);
      const touch = (type, y) => client.send('Input.dispatchTouchEvent', { type, touchPoints: y === undefined ? [] : [{ x: 190, y }] });
      const panel = dialog.locator('.now');
      await touch('touchStart', 120);
      await touch('touchMove', 146);
      await page.waitForTimeout(100);
      await touch('touchEnd');
      await dialog.waitFor();
      await page.waitForFunction(node => getComputedStyle(node).transform === 'none', await panel.elementHandle());
      await touch('touchStart', 120);
      await touch('touchMove', 162);
      await touch('touchMove', 297);
      await page.waitForFunction(node => new DOMMatrix(getComputedStyle(node).transform).m42 > 100, await panel.elementHandle());
      await touch('touchEnd');
      await dialog.waitFor({ state: 'hidden' });
      assert.ok(Number(await dock.getByRole('slider', { name: 'Playback position' }).inputValue()) >= 11);
    } else await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    if (phone) {
      await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'library', exact: true }).click();
      await page.getByRole('link', { name: 'open queue', exact: true }).click();
    }
    else await dock.getByRole('button', { name: 'Queue', exact: true }).click();
    const queue = page.getByRole('region', { name: 'Queue', exact: true });
    const remove = queue.getByRole('button', { name: `Remove ${tracks[0].metadata.title}` });
    await remove.waitFor();
    await capture('queue');
    await remove.click();
    await remove.waitFor({ state: 'detached' });
    await page.reload();
    await dock.getByRole('button', { name: 'Open now playing' }).waitFor();
    await dock.getByRole('button', { name: 'Play', exact: true }).waitFor();
    const position = Number(await dock.getByRole('slider', { name: 'Playback position' }).inputValue());
    assert.ok(position >= 11 && position < 18, 'reload restores the seek position without autoplay');
    await page.goto(origin + '/track/missing-track');
    await page.getByRole('heading', { name: '404', exact: true }).waitFor();
    await page.getByText("we couldn't find what you're looking for").waitFor();
    const backHome = page.getByRole('link', { name: 'go home', exact: true });
    await backHome.click();
    await page.waitForURL(origin + '/');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function queueGroups(browser, phone, scheme) {
  const width = phone ? 390 : 1280;
  const { context, page, errors } = await setup(browser, width, phone ? 844 : 960, { phone, scheme });
  try {
    await page.goto(origin);
    const navigation = page.getByRole('navigation', { name: 'Main navigation' });
    const dock = page.getByTestId('player-dock');
    await page.getByTestId('home-chart').getByRole('button', { name: `Play ${tracks[0].metadata.title}`, exact: true }).click();
    await dock.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    const picks = page.getByTestId('home-track-row');
    for (const index of [0, 1, 2, 3]) {
      await picks.nth(index).getByRole('button', { name: `Add ${tracks[index].metadata.title} to queue` }).click();
    }
    if (phone) {
      await navigation.getByRole('link', { name: 'library', exact: true }).click();
      await page.getByRole('link', { name: 'open queue', exact: true }).click();
    }
    else await dock.getByRole('button', { name: 'Queue', exact: true }).click();
    const queue = page.getByRole('region', { name: 'Queue', exact: true });
    const upNext = queue.getByRole('region', { name: 'up next', exact: true });
    const continuation = queue.getByRole('region', { name: /next from/ });
    await upNext.getByRole('button', { name: `Remove ${tracks[3].metadata.title}` }).waitFor({ timeout: 3000 });
    await continuation.getByRole('button', { name: `Remove ${tracks[8].metadata.title}` }).waitFor();
    assert.equal(await upNext.getByRole('listitem').count(), 4);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-queue-grouped.png`) });

    await upNext.getByRole('button', { name: `Move ${tracks[3].metadata.title} up` }).click();
    await upNext.getByRole('listitem').nth(2).getByRole('link', { name: tracks[3].metadata.title, exact: true }).waitFor();
    await queue.getByRole('button', { name: 'clear your queued tracks' }).click();
    await upNext.getByText('no tracks queued by you.').waitFor();
    assert.ok(await continuation.getByRole('link', { name: tracks[8].metadata.title, exact: true }).isVisible());
    const promote = continuation.getByRole('button', { name: `Move ${tracks[2].metadata.title} into up next` });
    await promote.focus();
    await promote.press('Enter');
    const promoted = upNext.getByRole('button', { name: `Play ${tracks[2].metadata.title}`, exact: true });
    await page.waitForFunction(node => document.activeElement === node, await promoted.elementHandle());
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function statsScreen(browser, phone, scheme) {
  const width = phone ? 390 : 1280;
  const { context, page, errors } = await setup(browser, width, phone ? 844 : 960, { phone, scheme });
  let reads = 0;
  try {
    await page.route('https://api.next.plyr.fm/v1/stats', route => {
      const visits = ++reads - Number(phone);
      if (visits === 2 || visits === 4) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: { object: 'platform_stats', plays: 393 + visits, tracks: 1422, artists: 122, duration_seconds: 532800, updated_at_ms: 1794651020000 } });
    });
    const chartTrack = tracks[0];
    const did = chartTrack.artist.did;
    const artist = { did, handle: 'alice.test', display_name: 'Alice Example' };
    let weekReads = 0;
    let artistLookups = 0;
    await page.route('https://api.next.plyr.fm/v1/charts/tracks?**', route => {
      const params = new URL(route.request().url()).searchParams;
      if (params.get('limit') !== '5') return route.fallback();
      const period = params.get('period');
      if (period === 'week' && ++weekReads === 1) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: { data: period === 'all_time' ? [] : [{ rank: 1, period_like_count: 12, track: chartTrack }] } });
    });
    await page.route('https://api.next.plyr.fm/v1/search?**', route => {
      const params = new URL(route.request().url()).searchParams;
      assert.equal(params.get('types'), 'artist');
      const match = { id: did, title: artist.display_name, owner: artist };
      return route.fulfill({ json: { data: params.get('q') === 'alice' ? [match] : [] } });
    });
    await page.route('https://api.next.plyr.fm/v1/artists/**', route => {
      if (!new URL(route.request().url()).pathname.endsWith('/metrics')) return route.fulfill({ json: artist });
      artistLookups += 1;
      return route.fulfill({ json: { totals: { tracks: 3, plays: 57, duration_seconds: 1200 },
        top_track: { id: chartTrack.id, title: chartTrack.metadata.title, play_count: 42 } } });
    });
    await page.goto(origin);
    await page.getByTestId('home-track-row').first().waitFor();
    assert.equal(reads, 0, 'stats do not load in the home shell');
    if (phone) {
      await page.getByRole('button', { name: 'Open links menu' }).click();
      await page.getByText('1,422 tracks · 122 artists', { exact: true }).waitFor();
      await page.getByRole('navigation', { name: 'Explore' }).getByRole('link', { name: 'stats', exact: true }).click();
    } else {
      await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'stats', exact: true }).click();
    }
    await page.waitForURL('**/stats');
    await page.getByRole('heading', { name: 'stats', exact: true }).waitFor();
    await page.getByText('394', { exact: true }).waitFor();
    await page.getByText('6d 4h', { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.getByLabel('Catalog totals').evaluate(node =>
      getComputedStyle(node).gridTemplateColumns.split(' ').filter(size => Number.parseFloat(size) > 0).length
    ), phone ? 3 : 4);
    const chart = page.getByRole('region', { name: 'most liked tracks', exact: true });
    await chart.getByText('12 likes').waitFor();
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-stats.png`) });
    await chart.getByRole('button', { name: '7 days', exact: true }).click();
    await chart.getByRole('alert').waitFor();
    await chart.getByRole('button', { name: 'retry track chart' }).click();
    await chart.getByText('12 likes').waitFor();
    assert.ok(await chart.getByRole('button', { name: '7 days', exact: true }).evaluate(button => document.activeElement === button));
    await chart.getByRole('button', { name: 'all time', exact: true }).click();
    await chart.getByText('no likes in this time range.').waitFor();
    assert.equal(artistLookups, 0, 'artist metrics are fetched only after selection');
    const input = page.getByRole('searchbox', { name: 'find an artist', exact: true });
    await input.fill('unknown');
    await page.getByText('no artists found for “unknown”.').waitFor();
    await input.fill('@alice');
    const link = page.getByRole('link', { name: 'Alice Example @alice.test' });
    await link.waitFor();
    await input.press('Tab');
    assert.ok(await link.evaluate(item => item === document.activeElement));
    await page.keyboard.press('Enter');
    await page.waitForURL('**/stats?artist=*#artist-stats');
    await page.getByLabel('artist totals').getByText('57', { exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'artist stats', exact: true }).getByRole('link', { name: chartTrack.metadata.title, exact: true }).count(), 0,
      'artist metrics can include an unlisted most-played track');
    await page.getByRole('navigation', { name: 'stats breadcrumb' }).getByRole('link', { name: 'stats', exact: true }).click();
    await page.waitForURL('**/stats#artist-stats');
    assert.equal(await page.getByLabel('artist totals').count(), 0);
    await page.getByRole('button', { name: 'refresh stats' }).click();
    await page.getByRole('alert').getByText('could not refresh stats.').waitFor();
    assert.ok(await page.getByText('394', { exact: true }).isVisible(), 'failed refresh keeps the last totals');
    await page.getByRole('button', { name: 'try again' }).click();
    await page.getByText('396', { exact: true }).waitFor();
    assert.equal(reads, 3 + Number(phone));
    await page.reload();
    await page.getByRole('alert').getByText('could not load stats.').waitFor();
    await page.getByRole('button', { name: 'try again' }).press('Enter');
    await page.getByText('398', { exact: true }).waitFor();
    assert.ok(await page.getByRole('button', { name: 'refresh stats' }).evaluate(button => document.activeElement === button),
      'retry keeps keyboard focus on the same action');
    assert.equal(reads, 5 + Number(phone));
    await page.goto(origin + '/stats?artist=' + encodeURIComponent(did) + '#artist-stats');
    const artistTotals = page.getByLabel('artist totals');
    await artistTotals.getByText('57', { exact: true }).waitFor();
    assert.ok(await artistTotals.evaluate(element => element.getBoundingClientRect().top < innerHeight));
    assert.equal(await page.getByRole('region', { name: 'most liked tracks', exact: true }).count(), 0);
    assert.equal(reads, 5 + Number(phone), 'a direct artist view does not fetch catalog totals');
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-artist-stats.png`) });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function collectionControls(browser, phone, scheme) {
  const width = phone ? 390 : 1280;
  const kind = phone ? 'album' : 'playlist';
  const title = `Fixture ${kind}`;
  const collectionPath = `/${kind}/fixture`;
  const { context, page, errors } = await setup(browser, width, phone ? 844 : 960, { phone, scheme });
  try {
    await page.addInitScript(() => {
      const NativeAudio = window.Audio;
      window.Audio = class extends NativeAudio {
        constructor() {
          super();
          window.collectionAudio = this;
        }
      };
    });
    const requests = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname.endsWith('/playback')) requests.push(request);
    });
    await page.goto(origin + collectionPath);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    await page.getByText('track unavailable', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'add to queue', exact: true }).click();
    const navigation = page.getByRole('navigation', { name: 'Main navigation' });
    if (phone) {
      await navigation.getByRole('link', { name: 'library', exact: true }).click();
      await page.getByRole('link', { name: 'open queue', exact: true }).click();
    } else await navigation.getByRole('link', { name: 'queue', exact: true }).click();
    const queue = page.getByRole('region', { name: 'Queue', exact: true });
    const current = queue.getByRole('region', { name: 'now playing', exact: true });
    const picks = queue.getByRole('region', { name: 'up next', exact: true });
    await current.getByRole('link', { name: collectionTracks[0].metadata.title, exact: true }).waitFor({ timeout: 3000 });
    await picks.getByRole('link', { name: collectionTracks[2].metadata.title, exact: true }).waitFor();
    assert.deepEqual(await picks.getByRole('link').allTextContents(), collectionTracks.slice(1).map(track => track.metadata.title));
    assert.equal(requests.length, 0, 'add to queue does not request audio');
    await page.goBack();
    if (phone) {
      await page.waitForURL(origin + '/library');
      await page.goBack();
    }
    const play = page.getByRole('button', { name: `Play ${title}`, exact: true });
    const pause = page.getByRole('button', { name: `Pause ${title}`, exact: true });
    const dock = page.getByTestId('player-dock');
    const position = dock.getByRole('slider', { name: 'Playback position' });
    await play.click();
    await pause.waitFor();
    await position.fill('15');
    await page.waitForFunction(() => window.collectionAudio?.currentTime >= 14);
    await page.evaluate(() => window.collectionAudio.dispatchEvent(new Event('waiting')));
    assert.equal(await pause.isEnabled(), true, 'collection playback can be paused while buffering');
    await pause.click();
    await page.waitForFunction(() => window.collectionAudio.paused);
    await play.click();
    await pause.waitFor();
    assert.ok(Number(await position.inputValue()) >= 14, 'collection play resumes the current position');
    assert.equal(requests.length, 1, 'resuming reuses the current audio');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-${kind}.png`) });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function loginScreen(browser) {
  const { context, page, errors } = await setup(browser, 390, 844, { phone: true });
  try {
    await context.route('https://typeahead.waow.tech/**', route => route.fulfill({ json: {
      actors: [{ did: 'did:plc:fixture', handle: 'example.test', displayName: 'Example' }]
    } }));
    await page.goto(origin + '/oauth/callback?error=access_denied');
    await page.waitForURL(origin + '/login');
    await page.getByRole('alert').getByText('sign-in was cancelled.').waitFor();
    const input = page.getByRole('combobox', { name: 'atmosphere account' });
    await input.fill('exa');
    await page.getByRole('option', { name: /example.test/ }).waitFor();
    await input.press('ArrowDown');
    assert.equal(await input.getAttribute('aria-activedescendant'), 'account-match-0');
    await input.press('Escape');
    assert.equal(await input.getAttribute('aria-expanded'), 'false');
    assert.ok(await input.evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 16));
    await page.screenshot({ path: path.join(output, '390-login.png') });
    const jam = '/jam/did%3Aplc%3Afixture~room';
    await page.goto(origin + jam);
    const join = page.getByRole('link', { name: 'sign in to join' });
    await join.waitFor();
    assert.equal(await join.getAttribute('href'), '/login?return_to=' + encodeURIComponent(jam + '?join=1'));
    await page.goto(origin + jam + '~invalid');
    await page.getByRole('alert').getByText('this jam link is invalid.').waitFor();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function keyboard(browser, phone, scheme) {
  const width = phone ? 390 : 1280;
  const { context, page, errors } = await setup(browser, width, phone ? 844 : 960, { phone, scheme });
  const press = key => page.keyboard.press(key);
  const blur = () => page.evaluate(() => document.activeElement.blur());
  const modifier = phone ? 'Meta' : 'Control';
  const dock = page.getByTestId('player-dock');
  try {
    await page.goto(origin);
    const opener = page.getByTestId('home-track-row').first().getByRole('link', { name: tracks[0].metadata.title, exact: true });
    await opener.focus();
    await press('?');
    const guide = page.getByRole('dialog', { name: 'keyboard shortcuts' });
    await guide.waitFor({ timeout: 3000 });
    assert.ok(await guide.getByText('seek back or forward 10 seconds').isVisible());
    assert.ok((await guide.boundingBox()).height < (phone ? 844 : 960) * 0.8, 'shortcuts fit in a compact dialog');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-shortcuts.png`) });
    await press('q');
    assert.equal(new URL(page.url()).pathname, '/');
    assert.equal(await page.getByTestId('queue-panel').count(), 0);
    await press('Escape');
    await guide.waitFor({ state: 'hidden' });
    assert.ok(await opener.evaluate(node => document.activeElement === node));

    if (!phone) {
      const help = page.getByRole('button', { name: 'keyboard shortcuts', exact: true });
      await help.click();
      await guide.waitFor();
      await press('Escape');
      assert.equal(await help.evaluate(node => document.activeElement === node), true);
      await opener.focus();
    }

    await press('q');
    const queue = page.getByRole('region', { name: 'Queue', exact: true });
    await queue.getByText('your queue is empty.').waitFor({ timeout: 5000 });
    if (phone) assert.equal(new URL(page.url()).pathname, '/queue');
    await press('q');
    await queue.waitFor({ state: 'hidden' });
    assert.equal(new URL(page.url()).pathname, '/');
    if (phone) {
      await page.goForward();
      await page.waitForURL('**/queue');
      await queue.getByText('your queue is empty.').waitFor();
      await press('q');
      await page.waitForURL(origin + '/');
    }

    const chartOpener = page.getByTestId('home-chart').getByRole('link', { name: tracks[0].metadata.title, exact: true });
    await page.route('https://api.next.plyr.fm/v1/playlists?**', route => route.fulfill({ json: { data: [{
      object: 'playlist', id: 'fixture', metadata: { name: 'At the edge of the day' },
      owner: { did: tracks[0].artist.did, profile: tracks[0].artist.profile }, media: tracks[0].media
    }], has_more: false } }));
    await chartOpener.focus();
    await press(`${modifier}+k`);
    await page.waitForURL('**/search');
    const searchHistoryLength = await page.evaluate(() => history.length);
    const search = page.getByRole('searchbox');
    await search.waitFor();
    assert.ok(await search.evaluate(node => document.activeElement === node));
    const popular = page.getByRole('region', { name: 'popular tracks' });
    const playlists = page.getByRole('region', { name: 'playlists', exact: true });
    await popular.getByRole('link').first().waitFor();
    await page.getByRole('region', { name: 'artists to explore' }).getByRole('link').first().waitFor();
    await playlists.getByRole('link').first().waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-search-empty.png`) });
    const hit = {
      object: 'search_result', type: 'track', id: tracks[0].id, title: tracks[0].metadata.title,
      record: tracks[0].record, image_url: tracks[0].media.artwork.url,
      owner: { did: tracks[0].artist.did, ...tracks[0].artist.profile }
    };
    const artistHit = { ...hit, type: 'artist', id: hit.owner.did, title: hit.owner.display_name, image_url: hit.owner.avatar_url };
    let submitted = 0;
    await page.route('https://api.next.plyr.fm/v1/search?**', route => {
      const params = new URL(route.request().url()).searchParams;
      const term = params.get('q');
      if (term === 'q?' && params.get('limit') === '40' && ++submitted === 1) {
        return route.fulfill({ status: 503, json: { error: 'temporarily unavailable' } });
      }
      return route.fulfill({ json: { object: 'list', data: term === 'sketch' ? [hit, artistHit] : [], has_more: false } });
    });
    await search.fill('🎧');
    await page.getByText('type at least two characters to search.').waitFor();
    await search.fill('sketch');
    const suggestions = page.getByRole('list', { name: 'search suggestions' }).getByRole('link');
    const suggestion = suggestions.first();
    await suggestion.waitFor();
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('[aria-label="search suggestions"] img')];
      return images.length === 2 && images.every(image => image.complete && image.naturalWidth > 0);
    });
    assert.equal(await suggestions.nth(1).locator('img').getAttribute('src'), artistHit.image_url);
    assert.equal(new URL(page.url()).search, '', 'suggestions do not submit the query');
    await search.press('ArrowDown');
    assert.ok(await suggestion.evaluate(node => document.activeElement === node));
    await suggestion.press('ArrowUp');
    assert.ok(await search.evaluate(node => document.activeElement === node));
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-search-suggestions.png`) });
    await search.fill('');
    await press('q');
    await press('?');
    assert.equal(await search.inputValue(), 'q?');
    assert.equal(await guide.isVisible(), false);
    await search.press('Enter');
    await page.waitForURL('**/search?q=q%3F');
    await page.getByText('could not search. try again.').waitFor();
    await search.press('Enter');
    await page.getByText('no results for “q?”.').waitFor();
    await page.route('https://api.next.plyr.fm/v1/charts/tracks?**', async route => {
      if (new URL(route.request().url()).searchParams.get('period') === 'month') {
        await new Promise(resolve => setTimeout(resolve, 1800));
      }
      await route.fallback();
    }, { times: 2 });
    await press('Escape');
    await page.waitForURL(origin + '/');
    await opener.waitFor();
    await page.waitForFunction(node => document.activeElement === node, await chartOpener.elementHandle());
    assert.ok(await chartOpener.evaluate(node => {
      const { top, bottom } = node.getBoundingClientRect();
      return top >= 0 && bottom <= innerHeight;
    }), 'the restored link is in view');
    assert.equal(await page.evaluate(() => history.length), searchHistoryLength, 'search and its query share one browser entry');
    await page.goForward();
    await page.waitForURL('**/search?q=q%3F');
    await page.getByText('no results for “q?”.').waitFor();
    await press('Escape');
    await page.waitForURL(origin + '/');
    const navigation = page.getByRole('navigation', { name: 'Main navigation' });
    await chartOpener.waitFor();
    await chartOpener.focus();
    await press(`${modifier}+k`);
    await page.waitForURL(origin + '/search');
    const recent = page.getByRole('region', { name: 'recent searches' });
    const recentQuery = recent.getByRole('link', { name: 'q?', exact: true });
    await recentQuery.waitFor();
    const recentHistory = await page.evaluate(() => history.length);
    await recentQuery.click();
    await page.waitForURL('**/search?q=q%3F');
    await press('Escape');
    await page.waitForURL(origin + '/');
    assert.equal(await page.evaluate(() => history.length), recentHistory);
    await navigation.getByRole('link', { name: 'search', exact: true }).click();
    await page.waitForURL(origin + '/search');
    await recent.getByRole('button', { name: 'clear', exact: true }).click();
    await recent.waitFor({ state: 'hidden' });
    assert.ok(await search.evaluate(node => document.activeElement === node));
    await navigation.getByRole('link', { name: 'home', exact: true }).click();
    await page.waitForURL(origin + '/');

    await press(`${modifier}+Comma`);
    await page.waitForURL('**/settings');
    await page.getByRole('heading', { name: 'settings', exact: true }).waitFor();
    await press(`${modifier}+k`);
    await page.waitForURL('**/search');
    await press(`${modifier}+k`);
    await page.waitForURL('**/settings');

    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'home', exact: true }).click();
    const row = page.getByTestId('home-track-row').first();
    await row.scrollIntoViewIfNeeded();
    const artistLink = row.getByRole('link', { name: 'replyomatic', exact: true });
    const artistBounds = await artistLink.boundingBox();
    const rowBounds = await row.boundingBox();
    const x = rowBounds.x + rowBounds.width - (phone ? 66 : 120);
    const y = artistBounds.y + artistBounds.height / 2;
    assert.ok(x > artistBounds.x + artistBounds.width, 'artist link ends before the blank part of the row');
    if (phone) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    assert.equal(new URL(page.url()).pathname, '/', 'the blank part of the row does not navigate');
    await dock.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await page.getByTestId('home-track-row').nth(1).getByRole('button', { name: `Add ${tracks[1].metadata.title} to queue` }).click();
    await blur();
    await press('Space');
    await dock.getByRole('button', { name: 'Play', exact: true }).waitFor();
    const position = dock.getByRole('slider', { name: 'Playback position' });
    await position.fill('12');
    await blur();
    const actualPosition = () => position.inputValue().then(Number);
    await press('ArrowRight');
    assert.equal(await actualPosition(), 22);
    await press('ArrowLeft');
    assert.equal(await actualPosition(), 12);
    await press('J');
    assert.equal(await actualPosition(), 0);

    const volume = dock.getByRole('slider', { name: 'Volume', includeHidden: true });
    if (!phone) {
      await volume.fill('0.35');
      await volume.focus();
      await press('m');
      assert.equal(await volume.inputValue(), '0.35', 'volume slider keeps its focus');
    }
    const beforeMute = await volume.inputValue();
    await dock.getByRole('button', { name: 'Play', exact: true }).focus();
    await press('m');
    assert.equal(await volume.inputValue(), '0');
    await press('M');
    assert.equal(await volume.inputValue(), beforeMute);
    await press('l');
    await dock.getByText(tracks[1].metadata.title, { exact: true }).waitFor();
    await press('j');
    await dock.getByText(tracks[0].metadata.title, { exact: true }).waitFor();
    if (!phone) {
      await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'queue', exact: true }).click();
      await page.waitForURL('**/queue');
      const dockQueue = dock.getByRole('button', { name: 'Queue', exact: true, pressed: true });
      await dockQueue.waitFor({ timeout: 3000 });
      assert.equal(await dockQueue.isDisabled(), true);
      assert.equal(new URL(page.url()).pathname, '/queue');
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function textFields(browser) {
  const { context, page } = await setup(browser, 390, 664, { phone: true, scheme: 'light', scale: 0.9 });
  try {
    for (const [path, field] of [
      ['/search', '#search-query'],
      ['/stats', '#stat-artist'],
      ['/login', '#account-handle']
    ]) {
      await page.goto(origin + path);
      const input = page.locator(field);
      await input.tap();
      assert.ok(await input.evaluate(node => parseFloat(getComputedStyle(node).fontSize)) >= 16,
        `${path}: a focused text field below 16px triggers iOS Safari zoom`);
    }
  } finally { await context.close(); }
}

(async () => {
  await mkdir(output, { recursive: true });
  const staticBuild = !origin;
  if (staticBuild) origin = await serve();
  const browser = await chromium.launch();
  try {
    await textFields(browser);
    for (const phone of [true, false]) {
      for (const scheme of ['light', 'dark']) {
        await screen(browser, phone, scheme);
        await queueGroups(browser, phone, scheme);
        await collectionControls(browser, phone, scheme);
        await keyboard(browser, phone, scheme);
        await statsScreen(browser, phone, scheme);
      }
    }
    await loginScreen(browser);
    console.log(`Svelte shell, queue, shortcuts and sign-in passed at phone and desktop widths → ${output}`);
  } finally { await browser.close(); if (staticBuild) close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
