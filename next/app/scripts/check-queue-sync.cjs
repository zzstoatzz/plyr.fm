const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');
const { identity, serviceToken, startQueueFixture } = require('./queue-fixture.cjs');
const origin = 'https://next.plyr.fm';
const dist = path.resolve(__dirname, '../dist');
const base = 'atproto repo:fm.plyr.track repo:fm.plyr.list repo:fm.plyr.like repo:fm.plyr.actor.profile blob:*/*';
const queue = 'rpc:fm.plyr.stg.jam.join?aud=did:web:plyr-jams-next.fly.dev#jams';

(async () => {
  const account = identity('k256');
  const fixture = await startQueueFixture([account], { count: 1 });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required', '--disable-features=LocalNetworkAccessChecks', '--allow-running-insecure-content'] });
  try {
    let authModule;
    async function device(scope) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.route(origin + '/**', async route => {
        let file = path.join(dist, new URL(route.request().url()).pathname);
        try { if (!(await fs.stat(file)).isFile()) throw Error(); } catch { file = path.join(dist, 'index.html'); }
        await route.fulfill({ body: await fs.readFile(file), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html' });
      });
      await context.route('https://plyr-jams-next.fly.dev/v1/playback/join', async route => {
        const response = await fetch(fixture.bases[0] + '/v1/playback/join', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: route.request().postData() });
        await route.fulfill({ status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: { 'content-type': 'application/json', 'access-control-allow-origin': origin } });
      });
      await context.route('https://plyr-jams-next.fly.dev/v1/preferences', async route => {
        const response = await fetch(fixture.bases[0] + '/v1/preferences', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: route.request().postData() });
        await route.fulfill({ status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: { 'content-type': 'application/json', 'access-control-allow-origin': origin } });
      });
      await context.route('https://api.next.plyr.fm/**', route => route.request().method() === 'GET' || new URL(route.request().url()).pathname === '/v1/tracks/resolve' ? route.fallback() : route.abort());
      await context.exposeFunction('__mintServiceToken', () => serviceToken(account));
      await context.addInitScript(local => {
        const Native = window.Audio; window.__audio = [];
        window.Audio = class extends Native { constructor(...args) { super(...args); this.muted = true; window.__audio.push(this); } };
        const Socket = window.WebSocket; window.__joins = 0;
        window.WebSocket = class extends Socket { constructor(url, protocols) { const parsed = new URL(url); if (parsed.host === 'plyr-jams-next.fly.dev') { parsed.protocol = 'ws:'; parsed.host = new URL(local).host; window.__joins++; } super(parsed.toString(), protocols); } };
      }, fixture.bases[0]);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin);
      await page.getByTestId('home-track-row').first().waitFor();
      if (!authModule) for (const source of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))) {
        for (const module of (await fs.readFile(path.join(dist, new URL(source).pathname), 'utf8')).split('__d(')) {
          if (!module.includes('.setAuth=') && !module.includes('"setAuth"')) continue;
          const match = module.match(/\},(\d+),\[/);
          if (match) authModule = Number(match[1]);
        }
      }
      assert.ok(authModule, 'find the auth state module in the web bundle');
      await page.evaluate(([id, did, granted]) => globalThis.__r(id).setAuth(did, { handle: async url => String(url).includes('com.atproto.server.getServiceAuth')
        ? new Response(JSON.stringify({ token: await window.__mintServiceToken() }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }) }, granted), [authModule, account.did, scope]);
      return { page, errors };
    }

    const saved = await fetch(fixture.bases[0] + '/v1/preferences', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceToken: serviceToken(account), patch: { theme: 'dark', accent: '#d24b79' } }) });
    assert.equal(saved.status, 200);
    const first = await device(`${base} ${queue}`);
    await first.page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="app-frame"]').parentElement).backgroundColor === 'rgb(10, 10, 10)', undefined, { timeout: 15_000 });
    await first.page.waitForFunction(() => window.__joins > 0, undefined, { timeout: 15_000 });
    const title = await first.page.getByTestId('home-chart').getByTestId('track-play-control').first().getAttribute('aria-label');
    await first.page.getByTestId('home-chart').getByTestId('track-play-control').first().click();
    await first.page.waitForFunction(() => window.__audio.some(item => !item.paused && item.currentTime > 1), undefined, { timeout: 30_000 });
    const dock = first.page.getByTestId('player-dock');
    await dock.getByRole('button', { name: 'Queue', exact: true }).click();
    await first.page.waitForURL('**/queue');
    assert.equal(await first.page.getByText('keeps your queue on this device').count(), 0, 'a synced sign-in shows no device-only notice');

    const second = await device(`${base} ${queue}`);
    const other = second.page.getByTestId('player-dock');
    await other.waitFor({ timeout: 20_000 });
    await other.getByRole('button', { name: 'Open now playing', exact: true }).getByText(title.replace(/^Play /, ''), { exact: true }).waitFor({ timeout: 15_000 });
    await other.getByText('playing on another device').waitFor({ timeout: 10_000 });
    assert.equal(await second.page.evaluate(() => window.__audio.some(item => !item.paused)), false, 'the second device stays silent');
    const before = await first.page.evaluate(() => Math.max(...window.__audio.filter(item => !item.paused).map(item => item.currentTime)));
    await other.getByRole('button', { name: 'Play', exact: true }).click();
    await second.page.waitForFunction(() => window.__audio.some(item => !item.paused && item.currentTime > 0.5), undefined, { timeout: 30_000 });
    const resumed = await second.page.evaluate(() => Math.max(...window.__audio.filter(item => !item.paused).map(item => item.currentTime)));
    assert.ok(resumed >= before - 2, `the second device takes over from the server position (${resumed}s after ${before}s)`);
    await first.page.waitForFunction(() => window.__audio.every(item => item.paused), undefined, { timeout: 10_000 });

    let recorded;
    for (const until = Date.now() + 6000; Date.now() < until; await new Promise(resolve => setTimeout(resolve, 200))) { recorded = fixture.record(account); if (recorded?.state.queue.length) break; }
    assert.ok(recorded?.state.queue.length, 'the queue is recorded in PostgreSQL');
    await first.page.context().close(); await second.page.context().close();
    await new Promise(resolve => setTimeout(resolve, 1500));
    fixture.forget();
    const later = await device(`${base} ${queue}`);
    await later.page.getByTestId('player-dock').getByRole('button', { name: 'Open now playing', exact: true }).getByText(title.replace(/^Play /, ''), { exact: true }).waitFor({ timeout: 15_000 });
    assert.equal(await later.page.evaluate(() => window.__audio.some(item => !item.paused)), false, 'a restored queue waits for play');

    const local = await device(base);
    assert.equal(await local.page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="app-frame"]').parentElement).backgroundColor), 'rgb(250, 250, 250)', 'a sign-in without the permission keeps device settings');
    await local.page.getByTestId('home-chart').getByTestId('track-play-control').first().click();
    await local.page.getByTestId('player-dock').getByRole('button', { name: 'Queue', exact: true }).click();
    await local.page.getByText('keeps your queue on this device').waitFor({ timeout: 10_000 });
    assert.equal(await local.page.evaluate(() => window.__joins), 0, 'a sign-in without the queue permission never contacts the coordinator');
    assert.deepEqual([...first.errors, ...second.errors, ...later.errors, ...local.errors], []);
    console.log(`queue sync: an identity with only the sync permission takes its saved theme from the server, syncs its queue across two devices, hands playback over at ${Math.round(resumed)}s, a fresh browser gets the queue back from PostgreSQL after Redis loses it, and a sign-in without the permission stays on the device`);
  } finally { await browser.close(); await fixture.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
