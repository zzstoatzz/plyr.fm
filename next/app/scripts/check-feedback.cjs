const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');
const origin = 'https://next.plyr.fm';
const dist = path.resolve(__dirname, '../dist');
const did = 'did:plc:feedbackfixtureaaaaaaaaa';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 393, height: 760 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await context.route(origin + '/**', async route => {
      let file = path.join(dist, new URL(route.request().url()).pathname);
      try { if (!(await fs.stat(file)).isFile()) throw Error(); } catch { file = path.join(dist, 'index.html'); }
      await route.fulfill({ body: await fs.readFile(file), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html' });
    });
    await context.route('https://api.next.plyr.fm/**', route => route.request().method() === 'GET' ? route.fallback() : route.abort());
    await context.addInitScript(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const feed = await (await fetch('https://api.next.plyr.fm/v1/tracks?limit=1')).json();
    const track = feed.data[0];
    await page.goto(`${origin}/track/${track.id}`);
    const toasts = page.getByTestId('toast');
    const shown = async text => {
      const card = toasts.filter({ hasText: text });
      await card.waitFor({ timeout: 5000 });
      return card;
    };

    await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
    const queued = await shown(`queued ${track.metadata.title}`);
    const box = await queued.boundingBox();
    const nav = await page.getByText(/^library$/i).last().boundingBox();
    if (process.env.FEEDBACK_SHOTS) await page.screenshot({ path: process.env.FEEDBACK_SHOTS + '-queued.png' });
    assert.ok(box.x >= 8 && box.x + box.width <= 393 - 8, 'the toast fits the phone width');
    assert.ok(box.y + box.height <= nav.y, 'the toast sits above the bottom navigation');
    await queued.waitFor({ state: 'detached', timeout: 4000 });

    await page.getByRole('button', { name: 'Share', exact: true }).first().click();
    await shown('link copied');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${origin}/track/${track.id}`);

    let authModule;
    for (const source of await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.src))) {
      for (const module of (await fs.readFile(path.join(dist, new URL(source).pathname), 'utf8')).split('__d(')) {
        if (!module.includes('.setAuth=') && !module.includes('"setAuth"')) continue;
        const match = module.match(/\},(\d+),\[/);
        if (match) authModule = Number(match[1]);
      }
    }
    assert.ok(authModule, 'find the auth state module in the web bundle');
    await page.evaluate(([id, owner]) => {
      window.__failLike = false;
      const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
      globalThis.__r(id).setAuth(owner, { handle: async url => {
        const text = String(url);
        if (text.includes('com.atproto.repo.listRecords')) return json({ records: [] });
        if (text.includes('com.atproto.repo.createRecord')) return window.__failLike ? json({ error: 'InternalServerError' }, 500) : json({ uri: `at://${owner}/fm.plyr.like/3lfeedback22a`, cid: 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5kpqcsgz7soitae' });
        if (text.includes('com.atproto.repo.deleteRecord')) return json({});
        return json({ error: 'MethodNotImplemented' }, 501);
      } }, 'atproto');
    }, [authModule, did]);

    const like = page.getByRole('button', { name: 'Like', exact: true }).first();
    await like.waitFor({ timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('[aria-label="Like"]')?.getAttribute('aria-disabled') !== 'true');
    const record = () => page.evaluate(() => new Promise(resolve => {
      const scales = [], rings = [];
      const start = performance.now();
      const tick = () => {
        const heart = document.querySelector('[data-testid="like-heart"]'), ring = document.querySelector('[data-testid="like-ring"]');
        if (heart) scales.push(new DOMMatrix(getComputedStyle(heart).transform).a);
        if (ring) rings.push(Number(getComputedStyle(ring).opacity));
        if (performance.now() - start < 900) requestAnimationFrame(tick); else resolve({ low: Math.min(...scales), high: Math.max(...scales), last: scales.at(-1), ring: Math.max(...rings), ringEnd: rings.at(-1) });
      };
      requestAnimationFrame(tick);
    }));
    let motion = record();
    await like.click();
    motion = await motion;
    assert.ok(motion.low < 0.8 && motion.high > 1.1 && Math.abs(motion.last - 1) < 0.01, `liking dips, overshoots and settles (${JSON.stringify(motion)})`);
    assert.ok(motion.ring > 0.3 && motion.ringEnd < 0.05, 'a ring bursts and fades');
    await shown(`liked ${track.metadata.title}`);
    if (process.env.FEEDBACK_SHOTS) await page.screenshot({ path: process.env.FEEDBACK_SHOTS + '-liked.png' });
    const unlike = page.getByRole('button', { name: 'Unlike', exact: true }).first();
    await unlike.waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="Unlike"]')?.getAttribute('aria-disabled') !== 'true');

    motion = record();
    await unlike.click();
    motion = await motion;
    assert.ok(motion.low > 0.99 && motion.high < 1.01 && motion.ring < 0.01, 'unliking does not animate');
    await shown(`unliked ${track.metadata.title}`);

    await page.evaluate(() => { window.__failLike = true; });
    await page.waitForFunction(() => document.querySelector('[aria-label="Like"]')?.getAttribute('aria-disabled') !== 'true');
    await page.getByRole('button', { name: 'Like', exact: true }).first().click();
    const failed = await shown('failed to update like');
    if (process.env.FEEDBACK_SHOTS) await page.screenshot({ path: process.env.FEEDBACK_SHOTS + '-failed.png' });
    assert.equal(await failed.getAttribute('role'), 'alert', 'a failure is announced as an alert');
    await page.getByRole('button', { name: 'Like', exact: true }).first().waitFor();
    assert.deepEqual(errors, []);

    const reduced = await browser.newContext({ viewport: { width: 393, height: 760 }, reducedMotion: 'reduce' });
    await reduced.route(origin + '/**', async route => {
      let file = path.join(dist, new URL(route.request().url()).pathname);
      try { if (!(await fs.stat(file)).isFile()) throw Error(); } catch { file = path.join(dist, 'index.html'); }
      await route.fulfill({ body: await fs.readFile(file), contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.ttf') ? 'font/ttf' : 'text/html' });
    });
    const still = await reduced.newPage();
    await still.goto(`${origin}/track/${track.id}`);
    await still.getByRole('button', { name: 'Add to queue', exact: true }).click();
    const instant = still.getByTestId('toast').filter({ hasText: 'queued' });
    await instant.waitFor();
    assert.equal(await instant.evaluate(node => getComputedStyle(node).opacity), '1', 'reduced motion shows the toast without a fade');
    console.log('feedback: queue and copy toasts sit above the navigation and leave on their own; liking dips, overshoots and throws a ring, unliking stays still; a failed like raises an alert toast and reverts');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
