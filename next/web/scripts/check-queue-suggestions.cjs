const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
process.env.PLAYER_DIST ??= path.resolve(__dirname, '../build');
const { tracks, setup, serve, close } = require('./fixture-catalog.cjs');

let origin = process.env.NEXT_WEB_URL;
const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-svelte-shell';

async function queueSuggestions(browser, phone, scheme) {
  const width = phone ? 390 : 1280;
  const { context, page, errors } = await setup(browser, width, phone ? 844 : 960, { phone, scheme });
  try {
    const seen = [];
    let artistReads = 0;
    page.on('request', request => { if (request.url().includes('fm.plyr.unspecced.listTracks') && request.url().includes('artist')) artistReads++; });
    await page.route('https://api.next.plyr.fm/xrpc/fm.plyr.unspecced.getTrackSuggestions?**', route => {
      const url = new URL(route.request().url());
      seen.push({ seeds: url.searchParams.getAll('seed'), exclude: url.searchParams.getAll('exclude') });
      return route.fulfill({ json: { object: 'track_suggestions', data: tracks.slice(4, 8) } });
    });
    await page.goto(origin);
    const navigation = page.getByRole('navigation', { name: 'Main navigation' });
    const dock = page.getByTestId('player-dock');
    const openQueue = async () => {
      if (phone) {
        await navigation.getByRole('link', { name: 'library', exact: true }).click();
        await page.getByRole('link', { name: 'open queue', exact: true }).click();
      } else {
        await navigation.waitFor();
        await page.keyboard.press('q');
      }
    };
    const queue = page.getByRole('region', { name: 'Queue', exact: true });

    // nothing playing: the empty queue offers stacks, and one tap starts one
    await openQueue();
    await queue.getByRole('heading', { name: 'nothing up next' }).waitFor({ timeout: 5000 });
    const top = queue.getByRole('button', { name: 'Play top tracks this week' }).last();
    await page.waitForFunction(node => !node.disabled, await top.elementHandle());
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-queue-starters.png`) });
    await top.click();
    await dock.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await queue.getByRole('region', { name: 'now playing', exact: true }).getByRole('link', { name: tracks[0].metadata.title, exact: true }).waitFor();

    // with a queue: suggestions go with it, and + adds without reshuffling the row
    const suggested = queue.getByRole('region', { name: 'add to your queue', exact: true });
    const add = suggested.getByRole('button', { name: `Add ${tracks[5].metadata.title} to queue`, exact: true });
    await add.waitFor({ timeout: 5000 });
    assert.ok(seen.at(-1).seeds.includes(tracks[0].record.uri), 'suggestions are seeded by the playing track');
    await add.click();
    // the added card leaves the strip instead of staying as a checkmark, and the rest of the row closes up
    await add.waitFor({ state: 'detached', timeout: 2000 });
    assert.equal(await suggested.getByRole('listitem').count(), 3, 'only the added card leaves');
    assert.equal(await suggested.getByRole('button', { name: /added to queue$/ }).count(), 0, 'no checkmark is left behind');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'suggestions fit the window');
    await page.screenshot({ path: path.join(output, `${width}-${scheme}-queue-suggestions.png`) });

    // closing and reopening the queue on the same track shows the strips at once and asks for nothing
    const asked = { suggestions: seen.length, artist: artistReads };
    for (let round = 0; round < 3; round++) {
      if (phone) await page.goBack(); else await page.keyboard.press('q');
      await queue.waitFor({ state: 'detached', timeout: 3000 });
      await openQueue();
      await queue.waitFor();
      assert.ok(await suggested.isVisible(), 'suggestions are there the moment the queue opens');
      assert.equal(await suggested.getByRole('listitem').count(), 3, 'the added card stays gone');
    }
    await page.waitForTimeout(600);
    assert.deepEqual({ suggestions: seen.length, artist: artistReads }, asked, 'reopening the queue refetches nothing');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

(async () => {
  await mkdir(output, { recursive: true });
  const staticBuild = !origin;
  if (staticBuild) origin = await serve();
  const browser = await chromium.launch();
  try {
    for (const phone of [true, false]) for (const scheme of ['light', 'dark']) await queueSuggestions(browser, phone, scheme);
    console.log(`queue stacks and suggestions passed at phone and desktop widths → ${output}`);
  } finally { await browser.close(); if (staticBuild) close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
