const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');

(async () => {
  const search = await (await fetch('https://api.next.plyr.fm/v1/search?q=Sounds%20of%20the%20Drone%20Mix')).json();
  const hit = search.data.find(item => item.type === 'track' && item.title === 'Sounds of the Drone Mix');
  const delivery = await (await fetch(`https://api.next.plyr.fm/v1/tracks/${hit.id}/playback`)).json();
  const media = delivery.availability.delivery?.url;
  assert.ok(media, 'Public fixture has a delivery URL');
  const server = http.createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end('<button>play</button><audio preload="metadata"></audio><script>document.querySelector("button").onclick=()=>document.querySelector("audio").play()</script>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const safari = !!process.env.AUDIO_SEEK_WEBKIT;
  const browser = await (safari ? webkit.launch({ executablePath: process.env.WEBKIT_EXECUTABLE }) : chromium.launch({ channel: 'chrome' }));
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const requests = [], audioIds = new Set();
    let bytes = safari ? null : 0;
    page.on('request', request => { if (request.url() === media) requests.push({ range: request.headers().range || null }); });
    page.on('response', response => { if (response.url() === media) requests.push({ status: response.status(), range: response.headers()['content-range'] || null }); });
    if (!safari) {
      const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');
      cdp.on('Network.requestWillBeSent', event => { if (event.request.url === media) audioIds.add(event.requestId); });
      cdp.on('Network.dataReceived', event => { if (audioIds.has(event.requestId)) bytes += event.encodedDataLength; });
    }
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(media => { document.querySelector('audio').src = media; }, media);
    const start = Date.now(); await page.getByRole('button', { name: 'play', exact: true }).click();
    await page.waitForFunction(() => { const a = document.querySelector('audio'); return !a.paused && a.currentTime > .1; });
    const startupMs = Date.now() - start;
    const duration = await page.evaluate(() => document.querySelector('audio').duration);
    assert.ok(Number.isFinite(duration) && duration > 0);
    const seekMs = [];
    for (const fraction of [.7, .05, .9, .2]) {
      const target = Math.floor(duration * fraction), before = Date.now();
      await page.evaluate(target => { document.querySelector('audio').currentTime = target; }, target);
      await page.waitForFunction(target => { const a = document.querySelector('audio'); return !a.seeking && a.readyState >= 3 && a.currentTime >= target && a.currentTime < target + 3; }, target);
      seekMs.push(Date.now() - before);
    }
    const final = Math.floor(duration * .4), rapid = Date.now();
    await page.evaluate(async ({ duration, final }) => {
      for (const fraction of [.8, .1, .6, .3, .75, .15]) { document.querySelector('audio').currentTime = Math.floor(duration * fraction); await new Promise(resolve => setTimeout(resolve, 10)); }
      document.querySelector('audio').currentTime = final;
    }, { duration, final });
    await page.waitForFunction(final => { const a = document.querySelector('audio'); return !a.seeking && a.readyState >= 3 && a.currentTime >= final && a.currentTime < final + 3; }, final);
    const result = { browser: safari ? 'WebKit' : 'Chrome', sourceOrigin: new URL(media).origin, startupMs, seekMs, rapidSeekSettleMs: Date.now() - rapid, receivedBytes: bytes, duration, requests };
    const output = process.env.AUDIO_SEEK_OUTPUT || '/tmp/plyr-audio-seeking'; await fs.mkdir(output, { recursive: true });
    await fs.writeFile(`${output}/${safari ? 'webkit' : 'chrome'}.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result)); await context.close();
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
