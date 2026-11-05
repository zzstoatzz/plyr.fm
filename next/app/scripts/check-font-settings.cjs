const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const requireFrontend = createRequire(path.resolve(__dirname, '../../../frontend/package.json'));
const playwright = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : requireFrontend('playwright');
const origin = 'https://next.plyr.fm';
const output = process.env.FONT_OUTPUT || `/tmp/plyr-fonts-${Date.now()}`;
const browserName = process.env.FONT_BROWSER || 'chromium';

(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await playwright[browserName].launch(browserName === 'chromium' ? { channel: 'chrome' } : {
    ...(process.env.FONT_EXECUTABLE ? { executablePath: process.env.FONT_EXECUTABLE } : {})
  });
  try {
    for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
      const errors = [];
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      if (process.env.FONT_DIST) await context.route(origin + '/**', async route => {
        const root = path.resolve(process.env.FONT_DIST);
        const candidate = path.join(root, new URL(route.request().url()).pathname);
        const exists = await fs.stat(candidate).then(stat => stat.isFile(), () => false);
        await route.fulfill({ path: exists ? candidate : path.join(root, 'index.html') });
      });
      await context.route('**/*', async route => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.abort();
        return route.fallback();
      });
      await context.addInitScript(theme => { if (!localStorage.getItem('plyr-next:prefs')) localStorage.setItem('plyr-next:prefs', JSON.stringify({ theme })); }, theme);
      const family = locator => locator.evaluate(node => getComputedStyle(node).fontFamily);
      try {
        await page.goto(origin + '/settings');
        const heading = page.getByRole('heading', { name: 'Settings', exact: true });
        await heading.waitFor();
        assert.match(await family(heading), /PlyrComicBold/);
        assert.match(await family(page.getByText('Font', { exact: true })), /PlyrComic/);
        assert.match(await family(page.getByRole('link', { name: 'Home', exact: true }).getByText('Home', { exact: true })), /PlyrComic/);
        assert.match(await family(page.getByRole('textbox', { name: 'Custom accent', exact: true })), /PlyrComic/);
        assert.equal(await page.evaluate(() => document.fonts.check('16px PlyrComic') && document.fonts.check('16px PlyrComicBold')), true);
        await page.screenshot({ path: path.join(output, `${browserName}-${width}-${theme}-comic.png`) });
        for (const [label, pattern] of [['mono', /Menlo|monospace/], ['serif', /Georgia|serif/], ['system', /system-ui|apple-system|Roboto/], ['comic sans', /PlyrComicBold/]]) {
          await page.getByRole('button', { name: label, exact: true }).last().click();
          await page.waitForFunction(({ pattern }) => new RegExp(pattern).test(getComputedStyle(document.querySelector('[role="heading"]')).fontFamily), { pattern: pattern.source });
          assert.match(await family(heading), pattern);
        }
        await page.reload();
        await heading.waitFor();
        assert.match(await family(heading), /PlyrComicBold/);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('plyr-next:prefs')).font), 'comic-sans');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        console.log(`${browserName} ${width} ${theme}: default, navigation/input consistency, switching and reload passed`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
