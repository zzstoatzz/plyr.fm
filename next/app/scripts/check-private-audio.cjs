const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const output = process.env.PRIVATE_AUDIO_OUTPUT || '/tmp/plyr-private-audio-check';
const audio = Buffer.alloc(44 + 8000 * 600 * 2);
audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
for (let offset = 44; offset < audio.length; offset += 2) audio.writeInt16LE(Math.round(Math.sin(offset / 10) * 400), offset);
const ranges = [];
let bytes = 0, origin;
const pds = http.createServer((request, response) => {
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('access-control-allow-methods', 'GET,OPTIONS');
  response.setHeader('access-control-allow-headers', 'authorization,range');
  if (request.method === 'OPTIONS') return response.end();
  if (request.headers.authorization !== 'fixture-private-audio') { response.writeHead(403); return response.end(); }
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '');
  const start = range?.[1] ? Number(range[1]) : range?.[2] ? Math.max(0, audio.length - Number(range[2])) : 0;
  const end = range?.[1] && range?.[2] ? Math.min(audio.length - 1, Number(range[2])) : audio.length - 1;
  ranges.push({ range: request.headers.range || null, start, end });
  if (start >= audio.length || start > end) { response.writeHead(416, { 'content-range': `bytes */${audio.length}` }); return response.end(); }
  response.writeHead(range ? 206 : 200, { 'content-type': 'audio/wav', 'content-length': end - start + 1, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${audio.length}`, 'cache-control': 'no-store' });
  let offset = start;
  const write = () => {
    if (response.destroyed) return;
    const next = Math.min(end + 1, offset + 32 * 1024);
    bytes += next - offset;
    response.write(audio.subarray(offset, next)); offset = next;
    if (offset > end) return response.end();
    setTimeout(write, 20);
  };
  write();
});
const web = http.createServer(async (request, response) => {
  const filename = request.url === '/private-audio-worker.js' ? path.join(root, 'public/private-audio-worker.js') : request.url === '/bridge.js' ? path.join(output, 'bridge.js') : null;
  if (filename) { response.setHeader('content-type', 'text/javascript'); response.end(await fs.readFile(filename)); return; }
  response.setHeader('content-type', 'text/html');
  response.end('<button id="play">play</button><audio preload="metadata"></audio><script type="module">import {privateAudioUrl,releasePrivateAudio} from "/bridge.js";window.bridge={privateAudioUrl,releasePrivateAudio};document.querySelector("button").onclick=()=>document.querySelector("audio").play()</script>');
});
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));

(async () => {
  await fs.mkdir(output, { recursive: true });
  execFileSync('bun', ['build', path.join(root, 'src/private-audio.web.ts'), '--target', 'browser', '--outfile', path.join(output, 'bridge.js')], { stdio: 'pipe' });
  await listen(pds); await listen(web);
  origin = `http://127.0.0.1:${web.address().port}`;
  const endpoint = `http://127.0.0.1:${pds.address().port}/xrpc/com.atproto.space.getBlob?space=fixture&repo=fixture&cid=fixture`;
  const safari = !!process.env.PRIVATE_AUDIO_WEBKIT;
  const browser = await (safari ? webkit.launch({ executablePath: process.env.WEBKIT_EXECUTABLE }) : chromium.launch({ channel: 'chrome', args: ['--disable-features=LocalNetworkAccessChecks'] }));
  try {
    const context = await browser.newContext();
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.waitForFunction(() => window.bridge);
    const bufferedStart = Date.now();
    await page.evaluate(async endpoint => {
      const response = await fetch(endpoint, { headers: { authorization: 'fixture-private-audio' } });
      window.bufferedUrl = URL.createObjectURL(await response.blob());
      document.querySelector('audio').src = window.bufferedUrl;
    }, endpoint);
    await page.getByRole('button', { name: 'play', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('audio').currentTime > 0.1);
    const bufferedStartupMs = Date.now() - bufferedStart;
    await page.evaluate(() => { const a = document.querySelector('audio'); a.pause(); a.removeAttribute('src'); a.load(); URL.revokeObjectURL(window.bufferedUrl); });
    bytes = 0; ranges.length = 0;
    const playbackUrl = await page.evaluate(async ({ endpoint, size }) => {
      window.headerRequests = 0;
      const url = await window.bridge.privateAudioUrl({ url: endpoint, size, mimeType: 'audio/wav', async headers() { window.headerRequests++; return { authorization: 'fixture-private-audio' }; } });
      document.querySelector('audio').src = url;
      return url;
    }, { endpoint, size: audio.length });
    const start = Date.now();
    await page.getByRole('button', { name: 'play', exact: true }).click();
    await page.waitForFunction(() => { const a = document.querySelector('audio'); return !a.paused && a.currentTime > 0.1; });
    const startupMs = Date.now() - start, startupBytes = bytes;
    assert.ok(startupBytes < audio.length / 2, `Playback started after ${startupBytes}/${audio.length} bytes`);
    const latencies = [];
    for (const position of [480, 20, 550, 45]) {
      const before = Date.now();
      await page.evaluate(position => { document.querySelector('audio').currentTime = position; }, position);
      await page.waitForFunction(position => { const a = document.querySelector('audio'); return !a.seeking && a.readyState >= 3 && a.currentTime >= position && a.currentTime < position + 2; }, position);
      latencies.push(Date.now() - before);
    }
    const second = await context.newPage(); await second.goto(origin);
    assert.equal(await second.evaluate(async url => (await fetch(url)).status, playbackUrl), 410);
    const head = await page.evaluate(async url => { const r = await fetch(url, { method: 'HEAD' }); return { status: r.status, length: r.headers.get('content-length') }; }, playbackUrl);
    assert.deepEqual(head, { status: 200, length: String(audio.length) });
    assert.equal(await page.evaluate(async url => (await fetch(url, { headers: { range: 'bytes=999999999-' } })).status, playbackUrl), 416);
    const seekSequenceBytes = bytes, seekSequenceRanges = ranges.slice();
    await page.evaluate(() => { const frame = document.createElement('iframe'); frame.src = '/frame'; document.body.append(frame); });
    const frame = page.frames().find(frame => frame !== page.mainFrame());
    await frame.waitForFunction(() => window.bridge);
    assert.equal(await frame.evaluate(async url => (await fetch(url)).status, playbackUrl), 410);
    const frameUrl = await frame.evaluate(async ({ endpoint, size }) => {
      const url = await window.bridge.privateAudioUrl({ url: endpoint, size, mimeType: 'audio/wav', async headers() { return { authorization: 'fixture-private-audio' }; } });
      document.querySelector('audio').src = url; return url;
    }, { endpoint, size: audio.length });
    await frame.getByRole('button', { name: 'play', exact: true }).click();
    await frame.waitForFunction(() => document.querySelector('audio').currentTime > .1);
    await frame.evaluate(url => { const a = document.querySelector('audio'); a.pause(); a.removeAttribute('src'); a.load(); window.bridge.releasePrivateAudio(url); }, frameUrl);
    await page.evaluate(url => { const a = document.querySelector('audio'); a.pause(); a.removeAttribute('src'); a.load(); window.bridge.releasePrivateAudio(url); }, playbackUrl);
    assert.equal(await page.evaluate(async url => (await fetch(url)).status, playbackUrl), 410);
    assert.ok(ranges.some(range => range.start > audio.length / 2), 'Native seeks requested tail bytes');
    assert.deepEqual(errors, []);
    const result = { browser: safari ? 'WebKit' : 'Chrome', bufferedStartupMs, startupMs, startupBytes, fileBytes: audio.length, seekMs: latencies, requests: seekSequenceRanges.length, totalBytes: seekSequenceBytes, ranges: seekSequenceRanges };
    await fs.writeFile(path.join(output, safari ? 'webkit.json' : 'chrome.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    await context.close();
  } finally { await browser.close(); await Promise.all([close(web), close(pds)]); }
})().catch(error => { console.error(error); process.exitCode = 1; web.close(); pds.close(); });
