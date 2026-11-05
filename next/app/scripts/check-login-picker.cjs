const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');
const origin = 'https://next.plyr.fm';
const output = process.env.LOGIN_PICKER_OUTPUT || '/tmp/plyr-login-picker';
(async () => {
  await fs.mkdir(output, { recursive: true });
  for (const kind of ['chromium', 'webkit']) {
    const browser = await (kind === 'webkit' ? webkit.launch({ executablePath: process.env.WEBKIT_EXECUTABLE }) : chromium.launch({ channel: 'chrome' }));
    try {
      for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, hasTouch: true });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        if (process.env.LOGIN_PICKER_DIST) await context.route(origin + '/**', async route => {
          let file = path.join(process.env.LOGIN_PICKER_DIST, decodeURIComponent(new URL(route.request().url()).pathname));
          try { if (!(await fs.stat(file)).isFile()) throw Error(); } catch { file = path.join(process.env.LOGIN_PICKER_DIST, 'index.html'); }
          await route.fulfill({ path: file, contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : undefined });
        });
        const actors = [
          { handle: 'nate.test', displayName: 'Nate', avatar: 'https://avatar.fixture.test/avatar.svg' },
          { handle: 'nathan-with-a-very-long-handle.example.test', displayName: 'Nathan with a very very long display name which must stay inside the picker' },
          { handle: 'nathan.test' }
        ];
        await context.route('https://avatar.fixture.test/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#6a9fff"/></svg>' }));
        await context.route('https://api.plyr.fm/auth/sign-in-preview?*', route => route.fulfill({ status: 404, json: {} }));
        await context.route('https://typeahead.waow.tech/**', async route => {
          assert.equal(route.request().headers()['x-client'], 'next.plyr.fm');
          const q = new URL(route.request().url()).searchParams.get('q');
          if (q === 'old') await page.waitForTimeout(800);
          await route.fulfill({ json: { actors: q === 'missing' ? [] : actors } });
        });
        try {
          await page.goto(origin + '/login');
          const input = page.getByRole('combobox', { name: 'atmosphere account' });
          await input.fill('na');
          const options = page.getByRole('option');
          await options.first().waitFor();
          assert.equal(await options.count(), 3);
          const avatar = options.first().locator('img');
          assert.equal(await avatar.count(), 1);
          for (const box of await options.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height, scroll: node.scrollWidth, width: node.clientWidth }; }))) {
            assert.ok(box.left >= 0 && box.right <= width && box.height >= 44 && box.scroll <= box.width + 1, 'Suggestion rows stay within viewport');
          }
          await page.screenshot({ path: `${output}/${kind}-${width}-${theme}.png` });
          await input.press('ArrowDown');
          await input.press('ArrowDown');
          await input.press('Enter');
          assert.equal(await input.inputValue(), actors[1].handle);
          assert.equal(new URL(page.url()).pathname, '/login', 'Choosing a result does not prematurely submit');
          assert.equal(await options.count(), 0);
          await input.fill('na');
          await input.focus();
          await options.first().waitFor();
          await options.first().tap();
          assert.equal(await input.inputValue(), actors[0].handle);
          await input.fill('old');
          await page.waitForTimeout(350);
          await input.fill('missing');
          await page.waitForTimeout(1000);
          assert.equal(await options.count(), 0, 'Stale results do not reappear');
          await input.fill('na');
          await options.first().waitFor();
          await input.press('Escape');
          assert.equal(await options.count(), 0);
          assert.deepEqual(errors, []);
          console.log(`${kind}/${width}/${theme}: avatar rows, clipping, keyboard, touch, stale results, Escape passed`);
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
