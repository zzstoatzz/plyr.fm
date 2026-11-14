const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, firefox } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');
const origin = 'https://next.plyr.fm';
const dist = path.resolve(__dirname, '../dist');

(async () => {
  const browser = await (process.env.HOME_ARTISTS_FIREFOX
    ? firefox.launch({ executablePath: process.env.HOME_ARTISTS_FIREFOX }) : chromium.launch({ channel: 'chrome' }));
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (!process.env.HOME_ARTISTS_LIVE) await page.route(origin + '/**', async route => {
      let file = path.join(dist, new URL(route.request().url()).pathname);
      try { if (!(await fs.stat(file)).isFile()) throw Error(); }
      catch { file = path.join(dist, 'index.html'); }
      await route.fulfill({ body: await fs.readFile(file), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html' });
    });
    await page.route('https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?*', route => route.fulfill({ json: { follows: [{ did: 'did:plc:fixture' }] } }));
    await page.route('https://api.next.plyr.fm/**', route => {
      if (new URL(route.request().url()).pathname === '/v1/artists/resolve') return route.fulfill({ json: { data: [{ did: 'did:plc:fixture', handle: 'fixture.test', display_name: 'Fixture artist', avatar_url: null, track_count: 1 }] } });
      return route.request().method() === 'GET' ? route.fallback() : route.abort();
    });
    await page.route('https://plc.directory/did:plc:fixture', route => route.fulfill({ status: 404, json: {} }));
    await page.goto(origin);
    await page.getByTestId('home-track-row').first().waitFor();
    const sources = await page.locator('script[src]').evaluateAll(elements => elements.map(element => element.src));
    let authModule;
    for (const source of sources) {
      const body = process.env.HOME_ARTISTS_LIVE ? await (await page.request.get(source)).text()
        : await fs.readFile(path.join(dist, new URL(source).pathname), 'utf8');
      for (const module of body.split('__d(')) {
        if (!module.includes('.setAuth=') && !module.includes('"setAuth"')) continue;
        const match = module.match(/\},(\d+),\[/);
        if (match) authModule = Number(match[1]);
      }
    }
    assert.ok(authModule, 'Find the exported auth state boundary in the web bundle');
    await page.evaluate(id => globalThis.__r(id).setAuth('did:plc:fixture', { handle: async () => new Response('{}') }, 'atproto'), authModule);
    const artist = page.getByRole('link', { name: 'Fixture artist', exact: true });
    await artist.waitFor();
    await artist.click();
    await page.waitForURL('**/u/fixture.test');
    await page.goBack();
    const atlas = page.getByTestId('home-atlas');
    await atlas.waitFor();
    assert.equal(await atlas.getAttribute('role'), 'link', 'The home atlas is one link');
    assert.equal(await atlas.locator('a, button, [tabindex]').count(), 0, 'Nothing inside the home atlas takes focus or clicks');
    const box = await atlas.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
    await page.waitForURL('**/atlas');
    assert.deepEqual(errors, []);
    console.log('Authenticated homepage artist rendering and navigation passed without page errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
