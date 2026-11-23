// Holds the mouse wheel down on the desktop home so latest keeps loading pages, and records where the rail
// is on every frame, with a video. RAIL_SITE=live drives https://next.plyr.fm as it is; otherwise it drives
// this build, fed by the live catalog (api.next.plyr.fm fetched from here, so the origin does not matter).
// With RAIL_STRICT=1 it fails when the rail moves at all once it has pinned.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const live = process.env.RAIL_SITE === 'live';
const label = live ? 'live' : 'build';
const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-home-rail-scroll';
const pages = Number(process.env.RAIL_PAGES || 4);
await mkdir(output, { recursive: true });

let origin = 'https://next.plyr.fm';
let close = () => {};
if (!live) {
  const fixture = require('./fixture-catalog.cjs');
  origin = await fixture.serve();
  close = fixture.close;
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', recordVideo: { dir: output, size: { width: 1440, height: 900 } } });
  if (!live) await context.route('https://api.next.plyr.fm/**', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
  });
  const page = await context.newPage();
  await page.goto(origin + '/');
  const rows = page.getByTestId('home-track-row');
  await rows.first().waitFor({ timeout: 20_000 });
  await page.getByRole('complementary', { name: 'explore' }).waitFor();
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const rail = document.querySelector('aside.rail');
    const frames = window.__railFrames = [];
    const sample = () => {
      const box = rail.getBoundingClientRect();
      frames.push({ t: Math.round(performance.now()), top: box.top, bottom: box.bottom, scrollY: window.scrollY, height: document.documentElement.scrollHeight, rows: document.querySelectorAll('[data-testid="home-track-row"]').length });
      window.__railFrame = requestAnimationFrame(sample);
    };
    sample();
  });
  await page.mouse.move(480, 450);
  const startRows = await rows.count();
  for (let step = 0; step < 400 && await rows.count() < startRows + pages * 24; step++) {
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(2000);
  const frames = await page.evaluate(() => { cancelAnimationFrame(window.__railFrame); return window.__railFrames; });
  await context.close();
  await rename(await page.video().path(), path.join(output, `home-rail-scroll-${label}.webm`));
  await writeFile(path.join(output, `home-rail-scroll-${label}.json`), JSON.stringify(frames));

  // pinned = the rail's bottom has come up onto the screen; from then on it should not move
  const pinnedAt = frames.findIndex(frame => frame.bottom <= 900);
  assert.ok(pinnedAt >= 0, 'the rail pinned while scrolling');
  const pinned = frames.slice(pinnedAt);
  const moves = [];
  for (let i = 1; i < pinned.length; i++) {
    const delta = pinned[i].bottom - pinned[i - 1].bottom;
    if (Math.abs(delta) > 0.5) moves.push({ t: pinned[i].t, delta: Math.round(delta * 10) / 10, scrollY: Math.round(pinned[i].scrollY), height: pinned[i].height, rows: pinned[i].rows });
  }
  const loads = pinned.filter((frame, i) => i && frame.rows > pinned[i - 1].rows).length;
  const bottoms = pinned.map(frame => frame.bottom);
  const drift = Math.max(...bottoms) - Math.min(...bottoms);
  console.log(`${label}: ${frames.length} frames, ${loads} page loads after the rail pinned, rail bottom ${Math.round(Math.min(...bottoms))}..${Math.round(Math.max(...bottoms))}px (moved ${drift.toFixed(1)}px, ${moves.length} times)`);
  for (const move of moves.slice(0, 40)) console.log(`  t=${move.t}ms rail ${move.delta > 0 ? 'down' : 'up'} ${Math.abs(move.delta)}px at scrollY ${move.scrollY}, page ${move.height}px, ${move.rows} rows`);
  assert.ok(loads >= 2, `latest loaded at least two pages while the rail was pinned (${loads})`);
  if (process.env.RAIL_STRICT === '1') assert.ok(drift <= 0.5, `the pinned rail holds still across ${loads} page loads (moved ${drift.toFixed(1)}px)`);
} finally {
  await browser.close();
  close();
}
