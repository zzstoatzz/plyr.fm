const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
process.env.PLAYER_DIST ??= path.resolve(__dirname, '../build');
const { tracks, setup, serve, close } = require('./fixture-catalog.cjs');

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

    await page.getByRole('link', { name: tracks[0].metadata.title, exact: true }).first().click();
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
    await capture('now-playing');
    await dialog.getByRole('slider', { name: 'Playback position' }).fill('12');
    if (phone) {
      const client = await context.newCDPSession(page);
      const touch = (type, y) => client.send('Input.dispatchTouchEvent', { type, touchPoints: y === undefined ? [] : [{ x: 190, y }] });
      const panel = dialog.locator('.now');
      await touch('touchStart', 120);
      await touch('touchMove', 146);
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
    await chartOpener.focus();
    await press(`${modifier}+k`);
    await page.waitForURL('**/search');
    const searchHistoryLength = await page.evaluate(() => history.length);
    const search = page.getByRole('searchbox');
    await search.waitFor();
    assert.ok(await search.evaluate(node => document.activeElement === node));
    await press('q');
    await press('?');
    assert.equal(await search.inputValue(), 'q?');
    assert.equal(await guide.isVisible(), false);
    await search.press('Enter');
    await page.waitForURL('**/search?q=q%3F');
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

    await press(`${modifier}+Comma`);
    await page.waitForURL('**/settings');
    await page.getByRole('heading', { name: 'settings', exact: true }).waitFor();
    await press(`${modifier}+k`);
    await page.waitForURL('**/search');
    await press(`${modifier}+k`);
    await page.waitForURL('**/settings');

    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'home', exact: true }).click();
    await page.getByTestId('home-track-row').first().getByRole('button', { name: `Play ${tracks[0].metadata.title}`, exact: true }).click();
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

(async () => {
  await mkdir(output, { recursive: true });
  const staticBuild = !origin;
  if (staticBuild) origin = await serve();
  const browser = await chromium.launch();
  try {
    for (const phone of [true, false]) {
      for (const scheme of ['light', 'dark']) {
        await screen(browser, phone, scheme);
        await queueGroups(browser, phone, scheme);
        await keyboard(browser, phone, scheme);
      }
    }
    await loginScreen(browser);
    console.log(`Svelte shell, queue, shortcuts and sign-in passed at phone and desktop widths → ${output}`);
  } finally { await browser.close(); if (staticBuild) close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
