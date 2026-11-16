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
    await page.route('https://api.next.plyr.fm/v1/tags**', route => route.fulfill({ json: {
      object: 'list', data: ['ambient', 'electronic', 'jazz'].map(name => ({ name, track_count: 9 })), has_more: false
    } }));
    await page.goto(origin);
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const home = nav.getByRole('link', { name: 'home', exact: true });
    const radio = nav.getByRole('link', { name: 'radio', exact: true });
    await home.waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => getComputedStyle(document.documentElement).fontFamily.includes('Plyr Comic')
      && [...document.fonts].some(face => face.family.includes('Plyr Comic') && face.status === 'loaded')), 'the reference desktop typeface loads');
    assert.equal(await home.getAttribute('aria-current'), 'page');
    assert.equal(await nav.getByRole('link', { name: 'upload', exact: true }).count(), 0, 'signed-out navigation matches the reference');
    const [homeBox, radioBox] = await Promise.all([home.boundingBox(), radio.boundingBox()]);
    assert.ok(radioBox.y - homeBox.y > height / 2, 'secondary navigation sits below the primary group');
    const tags = page.getByRole('navigation', { name: 'Browse by tag' }).getByRole('link');
    await tags.first().waitFor();
    const colors = await tags.evaluateAll(nodes => nodes.map(node => {
      const style = getComputedStyle(node);
      return { color: style.color, fill: style.backgroundColor, border: style.borderColor };
    }));
    assert.equal(new Set(colors.map(color => color.color)).size, 3, 'tags have distinct deterministic colors');
    assert.ok(colors.every(color => color.fill !== 'rgba(0, 0, 0, 0)'), 'tags have tinted fills');
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
