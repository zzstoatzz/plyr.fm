// Live: a station link opens its station and unfurls as that station, and the firehose keeps airing for a stretch.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const site = 'https://next.plyr.fm';
const api = 'https://api.next.plyr.fm';
const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-live-home-rail';
await mkdir(output, { recursive: true });

const card = await (await fetch(site + '/radio/deep-cuts', { headers: { 'user-agent': 'Twitterbot/1.0' } })).text();
assert.match(card, /<meta property="og:title" content="deep cuts radio on plyr\.fm"/, 'a station link unfurls as that station');
assert.match(card, /<meta property="og:url" content="[^"]*\/radio\/deep-cuts"/);
console.log('unfurl: ' + /<meta property="og:description" content="([^"]*)"/.exec(card)?.[1]);

const browser = await chromium.launch();
try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: 'dark' });
    await page.goto(site + '/radio/deep-cuts');
    await page.waitForFunction(() => document.title === 'deep cuts radio · plyr.fm', null, { timeout: 20_000 });
    const now = page.getByRole('dialog', { name: 'Now playing' });
    await now.getByText('live · deep cuts radio', { exact: true }).waitFor();
    await now.getByRole('button', { name: 'Listen live', exact: true }).first().waitFor();
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(output, `radio-link-${width}.png`) });
    console.log(`${width}: /radio/deep-cuts opens deep cuts in now playing and waits for a tap`);
    await page.close();
  }

  const state = await (await fetch(`${api}/xrpc/fm.plyr.unspecced.getRadioState?station=firehose&catalogOnly=false`)).json();
  if (!state.live?.stream_url) {
    console.log('firehose is off air right now; skipped the stay-on-air check');
  } else {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() => {
      window.media = [];
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { if (!window.media.includes(this)) window.media.push(this); return play.call(this); };
    });
    await page.goto(site + '/radio/firehose');
    await page.getByRole('dialog', { name: 'Now playing' }).getByRole('button', { name: 'Listen live', exact: true }).first().click();
    await page.waitForFunction(() => window.media.some(media => !media.paused && media.currentTime > 1), null, { timeout: 30_000 });
    // a station read every 30s: two minutes spans several, which is where next used to drop the stream
    let last = 0, stalled = 0, longest = 0;
    for (let second = 0; second < 120; second += 2) {
      await page.waitForTimeout(2000);
      const now = await page.evaluate(() => Math.max(0, ...window.media.filter(media => !media.paused).map(media => media.currentTime)));
      stalled = now > last ? 0 : stalled + 2;
      longest = Math.max(longest, stalled);
      last = now;
    }
    await page.screenshot({ path: path.join(output, 'radio-firehose.png') });
    assert.ok(longest < 12, `the firehose kept airing (longest silence ${longest}s)`);
    console.log(`firehose aired for two minutes, longest stall ${longest}s`);
    await page.close();
  }
} finally { await browser.close(); }
