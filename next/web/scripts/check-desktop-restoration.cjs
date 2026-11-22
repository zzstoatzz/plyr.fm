const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { setup, serve, close } = require('./fixture-catalog.cjs');

const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-desktop-restoration';

async function verify(browser, origin, width, scheme) {
  const height = 900;
  const { context, page, errors } = await setup(browser, width, height, { scheme });
  try {
    await page.route('https://api.next.plyr.fm/xrpc/fm.plyr.unspecced.getTags**', route => route.fulfill({ json: {
      object: 'list', data: ['ambient', 'electronic', 'jazz'].map(name => ({ name, track_count: 9 })), has_more: false
    } }));
    await page.goto(origin);
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const links = nav.getByRole('button', { name: 'Open links menu' });
    await links.waitFor();
    const menuBox = await links.boundingBox();
    const brandBox = await nav.getByRole('link', { name: 'plyr.fm home' }).boundingBox();
    assert.ok(menuBox.x + menuBox.width <= brandBox.x, 'links menu sits left of the brand');
    const featuredBox = await page.getByTestId('home-featured').boundingBox();
    assert.ok(featuredBox.y < 50, 'Home starts with content, without a reserved links row');
    const home = nav.getByRole('link', { name: 'home', exact: true });
    const radio = nav.getByRole('link', { name: 'radio', exact: true });
    await home.waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => getComputedStyle(document.documentElement).fontFamily.includes('Plyr Comic')
      && [...document.fonts].some(face => face.family.includes('Plyr Comic') && face.status === 'loaded')), 'the reference desktop typeface loads');
    assert.equal(await home.getAttribute('aria-current'), 'page');
    assert.equal(await nav.getByRole('link', { name: 'upload', exact: true }).count(), 0, 'signed-out navigation matches the reference');
    const search = nav.getByRole('link', { name: 'search', exact: true });
    const library = nav.getByRole('link', { name: 'library', exact: true });
    const [searchBox, homeBox, libraryBox, radioBox] = await Promise.all([search, home, library, radio].map(link => link.boundingBox()));
    assert.ok(searchBox.y < homeBox.y, 'search sits first, as a field');
    assert.ok(radioBox.y > libraryBox.y + libraryBox.height, 'explore sits below the primary group');
    assert.equal(await nav.getByRole('link', { name: 'settings', exact: true }).count(), 0, 'settings is not a nav item');
    assert.equal(await nav.getByRole('button', { name: /keyboard shortcuts/ }).count(), 0, 'keyboard shortcuts is not a nav item');
    const tags = page.getByRole('navigation', { name: 'Browse by tag' }).getByRole('link');
    await tags.first().waitFor();
    const dots = await tags.evaluateAll(nodes => nodes.map(node => getComputedStyle(node.querySelector('i')).backgroundColor));
    assert.equal(new Set(dots).size, 3, 'each tag keeps its own deterministic color as a dot');
    assert.ok(await tags.evaluateAll(nodes => nodes.every(node => getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)')), 'desktop tags are a quiet list, not filled pills');
    const [rail, latest] = await Promise.all([page.getByRole('complementary', { name: 'explore' }), page.getByRole('region', { name: 'latest' })].map(region => region.boundingBox()));
    assert.ok(rail.x > latest.x + latest.width, 'top tracks, atlas and tags sit in a rail beside latest');
    const firstRow = page.getByTestId('home-track-row').first();
    const [rowTitle, rowMetrics] = await Promise.all([firstRow.locator('.title'), firstRow.locator('.metrics')].map(part => part.boundingBox()));
    assert.ok(rowMetrics.x > rowTitle.x + rowTitle.width && rowMetrics.y < rowTitle.y + rowTitle.height, 'latest rows put plays, likes and when on the title line');
    const radioRail = page.getByTestId('home-radio');
    assert.equal(await radioRail.getByRole('button', { name: /^Listen to .+ radio$/ }).count(), 5, 'the rail ends with every radio station');
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    await page.waitForTimeout(100);
    const railEnd = await page.getByRole('complementary', { name: 'explore' }).evaluate(node => node.getBoundingClientRect().bottom);
    assert.ok(railEnd > 0 && railEnd <= height, 'the rail stays on screen when the page scrolls past it');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-home.png`) });
    await page.getByTestId('home-track-row').first().getByRole('button', { name: /^Play / }).click();
    const dock = page.getByTestId('player-dock');
    const opener = dock.getByRole('button', { name: 'Open now playing' });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Now playing' });
    await dialog.waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-testid="now-playing-dismiss-region"]').style.transform);
    const bounds = await dialog.boundingBox();
    assert.deepEqual(bounds, { x: 0, y: 0, width, height }, 'Now Playing fills the viewport');
    const art = await page.getByTestId('now-playing-artwork').boundingBox();
    const title = await page.getByTestId('now-playing-title').boundingBox();
    assert.ok(art.width >= width * 0.4, 'desktop artwork keeps the reference scale');
    assert.ok(title.x > art.x + art.width, 'controls and title sit beside the artwork');
    const details = await page.getByTestId('now-playing-details').boundingBox();
    assert.ok(Math.abs(details.x - title.x) < 1, 'details share the controls column');
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-now-playing.png`) });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.ok(await opener.evaluate(node => node === document.activeElement), 'closing returns focus to the dock');
    await radio.click();
    await page.waitForURL('**/radio');
    assert.ok(await radio.evaluate(node => node.classList.contains('active')), 'secondary navigation remains usable');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

(async () => {
  await mkdir(output, { recursive: true });
  const origin = process.env.NEXT_WEB_URL || await serve();
  const browser = await chromium.launch();
  try {
    for (const width of [1280, 1440]) for (const scheme of ['light', 'dark']) await verify(browser, origin, width, scheme);
    console.log(`desktop restoration passed → ${output}`);
  } finally { await browser.close(); close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
