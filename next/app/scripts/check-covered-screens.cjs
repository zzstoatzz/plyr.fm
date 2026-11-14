// Clicking around the sidebar while music plays must not get slower: the stack keeps
// every screen it has shown, and only the one on view may follow playback.
const assert = require('node:assert/strict');
const { withPlayerHarness, setup, track } = require('./check-player-presentation.cjs');

const nav = ['Search', 'Library', 'Radio', 'Atlas', 'Stats', 'Settings', 'Home'];

async function blockedMs(page, ms) {
  const before = await page.evaluate(() => window.__blocked);
  await page.waitForTimeout(ms);
  return Math.round(await page.evaluate(() => window.__blocked) - before);
}

withPlayerHarness(async browser => {
  const { context, page, errors } = await setup(browser, 1280, 'dark');
  try {
    await page.route('https://api.next.plyr.fm/v1/stats', route => route.fulfill({ json: { object: 'platform_stats', tracks: 1, artists: 1, duration_seconds: 236, plays: 12, updated_at_ms: Date.now() } }));
    await page.route('https://api.plyr.fm/**', route => route.abort());
    await page.evaluate(() => {
      window.__blocked = 0;
      new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__blocked += entry.duration; }).observe({ type: 'longtask' });
    });
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/');
    await page.getByRole('button', { name: 'Play ' + track.metadata.title, exact: true }).first().click({ position: { x: 8, y: 8 } });
    await page.waitForFunction(() => window.__playerPresentationMedia?.currentTime > 0);
    // a fresh stack's cost while playing, then the same after many screens have piled up
    for (const label of nav) await page.getByRole('link', { name: label, exact: true }).click();
    const early = await blockedMs(page, 3000);
    for (let round = 0; round < 6; round++) for (const label of nav) {
      await page.getByRole('link', { name: label, exact: true }).click();
      await page.waitForTimeout(80);
    }
    await page.waitForURL(url => url.pathname === '/');
    const late = await blockedMs(page, 3000);
    console.log(`blocked while playing: ${early}ms per 3s after 8 screens, ${late}ms after 50`);
    assert.ok(late < early + 150, `playback ticks re-render covered screens (${early}ms → ${late}ms per 3s)`);

    // covered screens come back current: back to settings, then home shows what is playing
    await page.goBack();
    await page.waitForURL('**/settings');
    await page.getByRole('heading').first().waitFor();
    await page.goForward();
    await page.waitForURL(url => url.pathname === '/');
    await page.getByRole('button', { name: 'Play ' + track.metadata.title, exact: true }).first().waitFor();
    // opening and closing Now Playing leaves the page under it current
    await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
    await page.waitForURL('**/now-playing');
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForURL(url => url.pathname === '/');
    await page.getByRole('button', { name: 'Play ' + track.metadata.title, exact: true }).first().waitFor();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}).catch(error => { console.error(error); process.exitCode = 1; });
