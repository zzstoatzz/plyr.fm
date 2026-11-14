// The screens people see most — home, a track, now playing and the queue — on a phone and a desktop, light and dark,
// against the fixture catalog (no network). Fails on layout that has gone wrong: a page wider than the window, now playing
// squeezed into a column narrower than the phone, or two covers showing at once. Saves a screenshot of each screen.
// Run after `npm run build:web`. CI runs it before deploying next.plyr.fm.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const frontend = createRequire(path.resolve(__dirname, '../../../frontend/package.json'));
const { chromium } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : frontend('playwright');
const { tracks, setup, serve, close } = require('./fixture-catalog.cjs');
const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-screens';
fs.mkdirSync(output, { recursive: true });
let origin;

async function fitsWindow(page, screen) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  assert.ok(scroll <= width, `${screen}: the page is ${scroll}px wide in a ${width}px window`);
}

// Covers big enough to be the now playing artwork that a person can actually see (any opacity left after every ancestor).
const visibleCovers = (page, min) => page.evaluate(min => {
  const dialog = document.querySelector('[aria-label="Now playing"]') || document.body;
  return [...dialog.querySelectorAll('div')].filter(node => {
    const box = node.getBoundingClientRect();
    if (box.width < min || box.bottom < 0 || box.top > window.innerHeight || !getComputedStyle(node).backgroundImage.startsWith('url')) return false;
    let opacity = 1;
    for (let at = node; at; at = at.parentElement) {
      const style = getComputedStyle(at);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      opacity *= Number(style.opacity);
    }
    return opacity > 0.05;
  }).map(node => { const box = node.getBoundingClientRect(); return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width) }; });
}, min);

async function screens(browser, { width, height, phone, scheme }) {
  const label = `${width}-${scheme}`;
  const { context, page, errors } = await setup(browser, width, height, { phone, scheme });
  const shot = name => page.screenshot({ path: path.join(output, `${label}-${name}.png`) });
  try {
    await page.goto(origin + '/');
    await page.getByRole('link', { name: tracks[0].metadata.title }).first().waitFor();
    await page.waitForTimeout(500);
    await fitsWindow(page, `${label} home`);
    await shot('home');

    await page.goto(origin + '/track/' + tracks[0].id);
    const play = page.getByRole('button', { name: 'Play', exact: true }).first();
    await play.waitFor();
    await page.waitForTimeout(300);
    await fitsWindow(page, `${label} track`);
    await shot('track');

    await play.click();
    await page.getByTestId('player-dock').getByRole('button', { name: /^Open now playing/ }).first().click();
    const art = page.getByTestId('now-playing-artwork');
    await art.waitFor();
    await page.waitForTimeout(1500);
    const cover = await art.boundingBox();
    if (phone) {
      assert.ok(cover.width >= width - 41, `${label} now playing: the cover is ${Math.round(cover.width)}px wide on a ${width}px phone`);
      const title = await page.getByTestId('now-playing-title').boundingBox();
      assert.ok(title.x - cover.x < 1 && title.x + title.width > cover.x + cover.width * 0.5, `${label} now playing: the title sits in the cover's column`);
    } else assert.ok(cover.width >= 300, `${label} now playing: the cover is ${Math.round(cover.width)}px wide`);
    const covers = await visibleCovers(page, cover.width * 0.8);
    assert.equal(covers.length, 1, `${label} now playing: exactly one cover shows, saw ${JSON.stringify(covers)}`);
    await fitsWindow(page, `${label} now playing`);
    await shot('now-playing');

    if (phone) {
      await page.goto(origin + '/queue');
      await page.getByText(tracks[0].metadata.title).first().waitFor();
    } else {
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByTestId('player-dock').getByRole('button', { name: 'Queue', exact: true }).click();
      await page.getByTestId('queue-panel').getByText(tracks[0].metadata.title).first().waitFor();
    }
    await page.waitForTimeout(300);
    await fitsWindow(page, `${label} queue`);
    await shot('queue');
    assert.deepEqual(errors, [], `${label}: no page errors`);
  } finally { await context.close(); }
}

(async () => {
  origin = await serve();
  const browser = await chromium.launch();
  try {
    for (const scheme of ['light', 'dark']) {
      await screens(browser, { width: 390, height: 664, phone: true, scheme });
      await screens(browser, { width: 1440, height: 900, phone: false, scheme });
    }
    console.log('key screens ok →', output);
  } finally { await browser.close(); close(); }
})().catch(error => { console.error(error); process.exit(1); });
