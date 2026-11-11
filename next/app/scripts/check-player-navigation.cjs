const { runDesktop } = require('./desktop-player-check.cjs');
const assert = require('node:assert/strict');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');

async function run(browser, width) {
  const { context, page, errors } = await setup(browser, width, 'dark');
  let audioRequests = 0;
  let baselineAudioRequests = 0;
  let documents = 0;
  page.on('request', request => { if (request.isNavigationRequest()) documents++; });
  page.on('request', request => { if (request.url().endsWith('/audio.wav')) audioRequests++; });
  await page.route('https://api.next.plyr.fm/v1/tracks?**', async route => {
    const artist = new URL(route.request().url()).searchParams.has('artist_did');
    const data = artist ? [track] : [...Array.from({ length: 20 }, (_, i) => ({ ...track, id: track.id + i, metadata: { ...track.metadata, title: `Earlier recording ${i + 1}` } })), track];
    await route.fulfill({ json: { object: 'list', data, has_more: false } });
  });
  const scrollPosition = async () => {
    const feed = page.getByTestId('home-feed').filter({ visible: true });
    const target = await feed.count() ? feed.last() : page.getByRole('link').filter({ hasText: track.metadata.title }).last();
    return target.evaluate(node => {
      while (node && !(node.clientHeight > 100 && node.scrollHeight > node.clientHeight + 100 && /auto|scroll/.test(getComputedStyle(node).overflowY))) node = node.parentElement;
      return node?.scrollTop ?? -1;
    });
  };
  const continuity = async () => {
    const before = await page.evaluate(() => window.__navigationMedia.currentTime);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(before => window.__navigationMedia === window.__playerPresentationMedia && !window.__navigationMedia.paused && window.__navigationMedia.currentTime > before, before), true, 'Navigation preserves exact playing media and progress');
    assert.equal(audioRequests, baselineAudioRequests, 'Navigation does not fetch another audio source');
    assert.equal(documents, 0, 'Internal navigation never requests a new document');
  };
  try {
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/');
    await page.getByRole('button', { name: 'Play ' + track.metadata.title, exact: true }).click({ position: { x: 22, y: 40 } });
    await page.waitForFunction(() => window.__playerPresentationMedia?.currentTime > 0);
    await page.evaluate(() => { window.__navigationMedia = window.__playerPresentationMedia; });
    baselineAudioRequests = audioRequests;
    assert.ok(baselineAudioRequests > 0);
    const origin = await scrollPosition();
    assert.ok(origin > 100, 'Origin Home has real scrolled context');
    await screenshot(page, `navigation-${width}-origin`);
    await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
    await page.getByTestId('now-playing-scroll').getByRole('link').first().click();
    await page.waitForURL('**/u/fixture.test');
    await continuity();
    const trackLink = page.getByRole('link').filter({ hasText: track.metadata.title }).first();
    await trackLink.click();
    await page.waitForURL('**/track/' + track.id);
    await continuity();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForURL('**/u/fixture.test');
    await continuity();
    await page.goBack();
    await page.waitForURL(url => url.pathname === '/');
    await continuity();
    assert.ok(Math.abs(await scrollPosition() - origin) < 2, 'Browser back restores originating Home scroll');
    assert.notEqual(await page.getByRole('link', { name: 'Home', exact: true }).evaluate(node => getComputedStyle(node).backgroundColor), await page.getByRole('link', { name: 'Search', exact: true }).evaluate(node => getComputedStyle(node).backgroundColor), 'Returned Home tab is visibly active');
    await page.goForward();
    await page.waitForURL('**/u/fixture.test');
    await continuity();
    await page.getByRole('link').filter({ hasText: track.metadata.title }).first().click();
    await page.waitForURL('**/track/' + track.id);
    await page.route('https://api.next.plyr.fm/v1/tracks/*/likes**', route => route.fulfill({ json: {
      object: 'list', data: [{ record: { uri: 'at://did:plc:liker/fm.plyr.like/example' }, actor: { did: 'did:plc:liker', profile: { display_name: 'A listener', handle: 'fixture.test', avatar_url: null } } }], has_more: false
    } }));
    await page.getByRole('button', { name: 'See 7 likes' }).click();
    await page.getByRole('link').filter({ hasText: 'A listener' }).click();
    await page.waitForURL('**/u/fixture.test');
    assert.equal(await page.getByText('liked by', { exact: true }).count(), 0, 'Row callback closes likes drawer without swallowing navigation');
    await continuity();
    assert.deepEqual(errors, []);
    console.log(`${width}: browser/app back and forward preserve audio, origin tab and scroll`);
  } catch (error) { await screenshot(page, `navigation-${width}-failure`); throw error; }
  finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}

withPlayerHarness(async browser => { for (const width of [390, 1280]) { if (width >= 800) await runDesktop(browser, width, 'dark', { setup, track, screenshot }); else await run(browser, width); } })
  .catch(error => { console.error(error); process.exitCode = 1; });
