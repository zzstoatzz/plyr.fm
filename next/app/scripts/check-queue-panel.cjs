// The desktop queue panel: docks beside the page on wide windows, floats over it on narrower ones, stays open across pages
// and reloads, and leaves phones on the queue screen. Also looks at the artist of the week on the desktop home. Run after `npm run build:web`.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const requireFrontend = createRequire(path.resolve(__dirname, '../../../frontend/package.json'));
const { chromium } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : requireFrontend('playwright');
const output = process.env.QUEUE_PANEL_OUTPUT || '/tmp/plyr-queue-panel';
require('node:fs').mkdirSync(output, { recursive: true });

const { tracks, setup, serve, close } = require('./fixture-catalog.cjs');
let origin;

const shot = (page, name) => page.screenshot({ path: path.join(output, `${name}.png`) });

async function startPlaying(page) {
  await page.goto(origin + '/track/' + tracks[0].id);
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await page.getByTestId('player-dock').getByRole('button', { name: 'Open now playing', exact: true }).waitFor();
}

async function wide(browser) {
  const { context, page, errors } = await setup(browser, 1440);
  try {
    await page.goto(origin + '/');
    const featured = page.getByTestId('home-featured');
    await featured.getByRole('button', { name: /^Play all 9 by replyomatic/ }).waitFor();
    await page.waitForTimeout(800);
    await shot(page, '1440-home');
    await startPlaying(page);
    const frame = await page.getByTestId('app-frame').boundingBox();
    await page.getByTestId('player-dock').getByRole('button', { name: 'Queue', exact: true }).click();
    const panel = page.getByTestId('queue-panel');
    await panel.waitFor();
    assert.match(new URL(page.url()).pathname, /^\/track\//, 'the queue opens beside the page instead of replacing it');
    const box = await panel.boundingBox();
    assert.ok(Math.abs(box.x + box.width - (frame.x + frame.width)) < 2 && box.width >= 359, 'the panel docks at the right edge');
    const content = await page.getByRole('header', { name: 'lo' }).or(page.locator('h1')).first().boundingBox().catch(() => undefined);
    if (content) assert.ok(content.x + content.width <= box.x + 1, 'the page narrows instead of sliding under the panel');
    await panel.getByText(tracks[0].metadata.title).first().waitFor();
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await page.waitForURL(origin + '/');
    await panel.waitFor();
    await page.waitForTimeout(600);
    await shot(page, '1440-panel');
    await page.reload();
    await page.getByTestId('queue-panel').waitFor();
    await page.getByTestId('queue-panel').getByRole('button', { name: 'Close queue', exact: true }).click();
    await page.getByTestId('queue-panel').waitFor({ state: 'detached' });
    await page.reload();
    await page.getByTestId('home-featured').waitFor();
    assert.equal(await page.getByTestId('queue-panel').count(), 0, 'a closed panel stays closed after reload');
    await page.getByTestId('player-dock').getByRole('button', { name: 'Queue', exact: true }).click();
    await page.getByTestId('queue-panel').waitFor();
    await page.waitForTimeout(400);
    const covers = await page.getByTestId('home-featured').evaluate(card => {
      const box = card.getBoundingClientRect();
      const name = card.querySelector('[role="heading"]').getBoundingClientRect();
      return [...card.querySelectorAll('img')].filter(img => { const r = img.getBoundingClientRect(); return r.width > 100 && r.bottom > box.top + 10 && r.top < name.top && r.right > box.left && r.left < box.left + 200; }).length;
    });
    assert.ok(covers > 0, 'opening the queue beside home moves the covers above the name instead of hiding them');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function narrow(browser) {
  const { context, page, errors } = await setup(browser, 1100);
  try {
    await startPlaying(page);
    await page.getByTestId('player-dock').getByRole('button', { name: 'Queue', exact: true }).click();
    const panel = page.getByTestId('queue-panel');
    await panel.waitFor();
    const [box, frame] = await Promise.all([panel.boundingBox(), page.getByTestId('app-frame').boundingBox()]);
    assert.ok(box.x + box.width < frame.x + frame.width, 'on a narrower window the panel floats inside the edge');
    await page.waitForTimeout(400);
    await shot(page, '1100-floating');
    await page.mouse.click(300, 300);
    await panel.waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

async function phone(browser) {
  const { context, page, errors } = await setup(browser, 390, 844);
  try {
    await startPlaying(page);
    assert.equal(await page.getByTestId('queue-panel').count(), 0);
    await page.goto(origin + '/queue');
    await page.getByRole('heading', { name: 'queue', exact: true }).or(page.getByRole('header', { name: 'queue', exact: true })).first().waitFor();
    assert.equal(await page.getByTestId('queue-panel').count(), 0, 'phones keep the queue screen, never the panel');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

(async () => {
  origin = await serve();
  const browser = await chromium.launch();
  try {
    await wide(browser);
    await narrow(browser);
    await phone(browser);
    console.log('queue panel ok →', output);
  } finally { await browser.close(); close(); }
})().catch(error => { console.error(error); process.exit(1); });
