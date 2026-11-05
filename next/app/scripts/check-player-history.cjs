const assert = require('node:assert/strict');
const { withPlayerHarness, setup, track, screenshot } = require('./check-player-presentation.cjs');

async function run(browser, width) {
  const { context, page, errors } = await setup(browser, width, 'dark');
  let audioRequests = 0;
  page.on('request', request => { if (request.url().endsWith('/audio.wav')) audioRequests++; });
  try {
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/');
    await page.getByRole('button', { name: 'Play', exact: true }).last().click();
    await page.waitForFunction(() => window.__playerPresentationMedia?.currentTime > 0);
    await page.evaluate(() => { window.__historyMedia = window.__playerPresentationMedia; });
    const baselineRequests = audioRequests;
    const continuity = async () => {
      const before = await page.evaluate(() => window.__historyMedia.currentTime);
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(before => window.__historyMedia === window.__playerPresentationMedia && !window.__historyMedia.paused && window.__historyMedia.currentTime > before, before), true);
      assert.equal(audioRequests, baselineRequests);
    };
    const expanded = page.getByTestId('now-playing-dismiss-region');
    const open = async () => {
      await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
      await page.waitForURL('**/now-playing');
      await expanded.waitFor();
      await page.getByRole('dialog').waitFor();
      assert.equal(await page.getByRole('dialog').count(), 1, 'Only one real DOM dialog presents Now Playing');
      await page.waitForTimeout(200);
      const frame = await page.getByRole('dialog').boundingBox();
      assert.deepEqual(frame, { x: 0, y: 0, width, height: 900 }, 'Dialog covers the entire shell viewport');
    };
    const home = async () => {
      await page.waitForURL(url => url.pathname === '/');
      assert.equal(await expanded.count(), 0);
      await continuity();
      assert.equal(new URL(page.url()).pathname, '/', 'Closing consumes only the modal history entry');
    };
    await open();
    await screenshot(page, `history-${width}-expanded`);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), true, 'Keyboard focus stays in the single modal');
    }
    await page.goBack(); await home();
    await page.goForward();
    await page.waitForURL('**/now-playing'); await expanded.waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).evaluate(node => { node.click(); node.click(); });
    await home();
    await page.goBack();
    await page.waitForURL('**/track/' + track.id);
    await continuity();
    await page.goForward(); await home();
    await open();
    await page.keyboard.press('Escape'); await home();
    await open();
    await page.getByRole('button', { name: 'Track details', exact: true }).click();
    await page.waitForURL('**/track/' + track.id); await continuity();
    await open();
    await page.getByRole('button', { name: 'Track details', exact: true }).click();
    await page.waitForURL('**/track/' + track.id);
    await page.goBack(); await home();
    await open();
    await page.getByTestId('now-playing-scroll').getByRole('link').click();
    await page.waitForURL('**/u/fixture.test'); await continuity();
    await page.goBack(); await home();
    await open();
    await page.getByRole('button', { name: 'Queue', exact: true }).click();
    await page.waitForURL('**/queue'); await continuity();
    await page.goBack(); await home();
    await page.route('https://api.next.plyr.fm/v1/search?**', route => route.fulfill({ json: {
      object: 'list', data: [{ type: 'track', id: track.id, title: track.metadata.title, owner: { did: track.artist.did, handle: 'fixture.test', display_name: 'jack' }, image_url: track.media.artwork.url }], has_more: false
    } }));
    await page.getByRole('link', { name: 'Search', exact: true }).click();
    await page.waitForURL('**/search');
    const search = page.getByRole('textbox', { name: 'Search tracks, artists, albums and playlists' });
    await search.fill('quiet');
    await page.getByRole('link').filter({ hasText: track.metadata.title }).first().click();
    await page.waitForURL('**/track/' + track.id); await continuity();
    await open();
    await page.getByRole('button', { name: 'Track details', exact: true }).click();
    await page.waitForURL('**/track/' + track.id);
    await page.goBack(); await page.waitForURL('**/search');
    assert.equal(await search.inputValue(), 'quiet', 'Back preserves originating Search query');
    await continuity();
    assert.deepEqual(errors, []);
    console.log(`${width}: modal Back/Forward, close/Escape cleanup, origin/detail/link/queue history and continuous media passed`);
  } catch (error) { await screenshot(page, `history-${width}-failure`); throw error; }
  finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}

async function coldRoute(browser) {
  const { context, page, errors } = await setup(browser, 390, 'dark');
  try {
    await page.goto(new URL('/now-playing', page.url()).href);
    await page.waitForURL(url => url.pathname === '/');
    assert.equal(await page.getByTestId('now-playing-dismiss-region').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Open now playing', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log('Direct player route without playback returns Home');
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}

withPlayerHarness(async browser => {
  for (const width of [390, 1280]) await run(browser, width);
  await coldRoute(browser);
})
  .catch(error => { console.error(error); process.exitCode = 1; });
