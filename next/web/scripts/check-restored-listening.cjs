const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { tracks, setup, serve, close } = require('./fixture-catalog.cjs');
const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-restored-listening';

async function verify(browser, origin, width, scheme) {
  const phone = width === 390;
  const { context, page, errors } = await setup(browser, width, phone ? 844 : 900, { phone, scheme });
  try {
    const accountReads = [];
    page.on('request', request => { if (/getFollows|com.atproto.repo.listRecords/.test(request.url())) accountReads.push(request.url()); });
    await page.route('https://api.next.plyr.fm/xrpc/fm.plyr.unspecced.getTrackLikes?**', route => route.fulfill({ json: { object: 'list', data: [{ record: { uri: 'at://did:plc:listener/fm.plyr.like/1' }, actor: { did: 'did:plc:listener', profile: { display_name: 'a listener', handle: 'listener.test' } } }], has_more: false } }));
    await page.goto(origin);
    const row = page.getByTestId('home-track-row').first();
    const likeCount = row.getByRole('button', { name: `${tracks[0].metrics.like_count} likes on ${tracks[0].metadata.title}` });
    await likeCount.click();
    const people = page.getByRole('group', { name: 'People who liked this track' });
    await people.getByRole('link', { name: 'a listener' }).waitFor();
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-likers.png`) });
    await page.keyboard.press('Escape');
    await people.waitFor({ state: 'hidden' });
    await row.getByRole('button', { name: 'More actions for ' + tracks[0].metadata.title }).click();
    const menu = page.locator('.menu:popover-open');
    await menu.getByRole('button', { name: 'share track', exact: true }).waitFor();
    assert.ok((await menu.boundingBox()).x >= 0);
    await page.keyboard.press('Escape');
    await row.getByRole('button', { name: 'Play ' + tracks[0].metadata.title }).click();
    await page.getByTestId('player-dock').getByRole('button', { name: 'Open now playing' }).click();
    const now = page.getByRole('dialog', { name: 'Now playing' });
    const marker = now.getByRole('button', { name: 'Comment at 0:14', exact: true });
    await marker.click();
    const card = page.locator('.comment-card:popover-open');
    await card.getByText('I love this moment.', { exact: true }).waitFor();
    if (phone) {
      const text = await card.locator('p').boundingBox();
      const cdp = await context.newCDPSession(page);
      const point = { x: text.x + text.width / 2, y: text.y + text.height / 2 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, y: point.y + 150 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.ok(await now.isVisible(), 'dragging comment text cannot dismiss Now Playing');
    }
    await page.keyboard.press('Escape');
    await card.waitFor({ state: 'hidden' });
    assert.ok(await now.isVisible(), 'Escape closes the comment card first');
    await now.getByTestId('now-playing-facts').waitFor();
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-now-playing.png`) });
    await page.keyboard.press('Escape');
    await now.waitFor({ state: 'hidden' });
    assert.deepEqual(accountReads, [], 'anonymous browsing starts neither follow traversal nor PDS likes reads');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}
(async () => {
  await mkdir(output, { recursive: true });
  const origin = process.env.NEXT_WEB_URL || await serve();
  const browser = await chromium.launch();
  try { for (const width of [390, 1280, 1440]) for (const scheme of ['light', 'dark']) await verify(browser, origin, width, scheme); }
  finally { await browser.close(); close(); }
  console.log('restored row actions, timed comments, nested dismissal and anonymous request bounds passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
