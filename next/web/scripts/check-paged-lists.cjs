// A paged list loads its next page as you scroll, with no "more" button, keeps every row where it was while
// a page starts and lands, and comes back from Back with its pages loaded and the scroll where you left it.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { artistDid, tracks, setup, serve, close } = require('./fixture-catalog.cjs');
const { method } = require('./xrpc-fixture.cjs');

const per = 30;
const pages = 3;
const playlist = index => ({
  object: 'playlist', id: `pls_fixture${index}`,
  record: { uri: `at://${artistDid}/fm.plyr.list/p${index}`, cid: 'bafyfixture', collection: 'fm.plyr.list', rkey: `p${index}` },
  metadata: { name: `paged playlist ${index}`, created_at: tracks[0].metadata.created_at, updated_at: null },
  owner: { did: artistDid, profile: tracks[0].artist.profile },
  metrics: { member_count: 1, available_count: 1, total_plays: 0 }
});

async function verify(browser, origin, width) {
  const { context, page, errors } = await setup(browser, width, 800, { phone: width < 700 });
  const reads = [];
  let hold;
  let slow = false;
  await page.route('https://api.next.plyr.fm/xrpc/fm.plyr.unspecced.listPlaylists*', async route => {
    const url = new URL(route.request().url());
    const index = Number(url.searchParams.get('cursor') || 0);
    reads.push(index);
    if (index === 1 && hold) await hold;
    if (slow) await new Promise(resolve => setTimeout(resolve, 600));
    const data = Array.from({ length: per }, (_, row) => playlist(index * per + row));
    const next = index + 1 < pages ? String(index + 1) : undefined;
    await route.fulfill({ json: { object: 'list', data, has_more: !!next, next_cursor: next ?? null } });
  });
  try {
    await page.goto(origin + '/playlists');
    const cards = page.locator('main a[href^="/playlist/"]');
    await cards.first().waitFor();
    assert.equal(await cards.count(), per);
    assert.equal(await page.getByRole('button', { name: /^(more|show more|load more)/ }).count(), 0, 'no button pages the list');

    // the next page starts as the end nears; nothing above it moves while it loads or when it lands
    let release;
    hold = new Promise(resolve => { release = resolve; });
    const marker = cards.nth(per - 1);
    const at = () => marker.evaluate(node => node.getBoundingClientRect().top + window.scrollY);
    const before = await at();
    await page.getByTestId('load-more').scrollIntoViewIfNeeded();
    await page.locator('[data-testid="load-more"] :is([role="status"], [aria-label^="loading more"])').first().waitFor();
    const during = await at();
    release();
    await cards.nth(per).waitFor();
    const after = await at();
    assert.equal(during, before, 'rows hold still while a page loads');
    assert.equal(after, before, 'rows hold still when a page lands');

    await page.getByTestId('load-more').scrollIntoViewIfNeeded();
    await cards.nth(per * pages - 1).waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-testid="load-more"]'));
    assert.deepEqual(reads.slice(0, pages), [0, 1, 2]);

    // Back from a playlist keeps all the pages and the place in them
    await cards.nth(per * 2 + 5).scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => window.scrollY);
    assert.deepEqual(errors, []);
    // a slow network on the way back: what was loaded has to be kept, not fetched again before it can show
    slow = true;
    // leave by a link inside the app, so the page is torn down and has to come back on its own
    await page.locator('a[href="/"]:visible').first().click();
    await page.waitForURL(origin + '/');
    await page.goBack();
    await page.waitForURL(/\/playlists$/);
    await cards.nth(per * pages - 1).waitFor();
    await page.waitForFunction(target => Math.abs(window.scrollY - target) < 2, y);
    console.log(`${width}px: playlists load as they scroll, hold still, and come back where they were`);
  } finally {
    await context.close();
  }
}

(async () => {
  const origin = await serve();
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1280]) await verify(browser, origin, width);
  } finally {
    await browser.close();
    close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
