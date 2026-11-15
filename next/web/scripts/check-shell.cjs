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
    await page.goto(origin);
    await page.getByTestId('home-track-row').first().waitFor();
    await page.getByTestId('home-chart').waitFor();
    await capture('home');

    await page.getByRole('link', { name: tracks[0].metadata.title, exact: true }).first().click();
    await page.getByRole('heading', { name: tracks[0].metadata.title, exact: true }).waitFor();
    await capture('track');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const dock = page.getByTestId('player-dock');
    await dock.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
    await dock.getByRole('button', { name: 'Open now playing' }).click();
    const dialog = page.getByRole('dialog', { name: 'Now playing' });
    await dialog.getByRole('heading', { name: tracks[0].metadata.title }).waitFor();
    const cover = await dialog.getByTestId('now-playing-artwork').boundingBox();
    if (phone) assert.ok(cover.width >= width - 35, 'now playing cover fills the phone');
    await capture('now-playing');
    await dialog.getByRole('slider', { name: 'Playback position' }).fill('12');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    if (phone) await page.getByRole('navigation').getByRole('link', { name: 'queue', exact: true }).click();
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

(async () => {
  await mkdir(output, { recursive: true });
  const staticBuild = !origin;
  if (staticBuild) origin = await serve();
  const browser = await chromium.launch();
  try {
    for (const phone of [true, false]) {
      for (const scheme of ['light', 'dark']) await screen(browser, phone, scheme);
    }
    await loginScreen(browser);
    console.log(`Svelte shell, queue and sign-in passed at phone and desktop widths → ${output}`);
  } finally { await browser.close(); if (staticBuild) close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
