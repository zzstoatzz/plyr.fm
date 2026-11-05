const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../../frontend/node_modules/playwright');
const { fixtureAccounts, fixturePage, authorizeFixture } = require('./pds-browser-fixture.cjs');
const origin = 'https://next.plyr.fm';
const output = process.env.JAM_ACCESS_OUTPUT || '/tmp/plyr-jam-access';
const trackId = 'trk_YXQ6Ly9kaWQ6cGxjOjZwbWJzbndlcm1haHYzcnBqaWxrcmd4by9mbS5wbHlyLnRyYWNrLzNtemNycWdoNDJxMjI';
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-features=LocalNetworkAccessChecks'] });
  try {
    for (const deviceOnly of [false, true]) {
      const name = 'jaccess' + (deviceOnly ? 'old' : 'new') + Date.now().toString(36);
      const accounts = await fixtureAccounts([name]);
      const handle = name + '.test';
      const { page, context } = await fixturePage(browser, accounts, { dist: process.env.JAM_ACCESS_DIST,
        context: { viewport: { width: deviceOnly ? 390 : 1280, height: 900 }, colorScheme: deviceOnly ? 'dark' : 'light' } });
      try {
        await page.goto(origin + '/login?' + new URLSearchParams({ return_to: '/track/' + trackId, ...(deviceOnly ? { deviceOnly: 'true' } : {}) }));
        await authorizeFixture(page, accounts, handle);
        await page.waitForURL('**/track/' + trackId);
        await page.getByRole('button', { name: 'Play', exact: true }).last().click();
        await page.getByRole('button', { name: 'Open now playing', exact: true }).click();
        await page.getByRole('button', { name: 'Queue', exact: true }).click();
        await page.getByRole('button', { name: 'Start a Jam', exact: true }).click();
        await page.waitForURL(url => url.pathname.startsWith('/jam/'));
        assert.equal(await page.getByRole('link', { name: 'Sign in to join', exact: true }).count(), 0, 'Signed-in account is never described as signed out');
        const room = new URL(page.url());
        assert.equal(room.searchParams.get('track'), trackId);
        if (deviceOnly) {
          await page.getByRole('button', { name: 'Enable Jams', exact: true }).waitFor();
          await page.screenshot({ path: output + '/enable.png' });
          await page.getByRole('button', { name: 'Enable Jams', exact: true }).click();
          await page.waitForURL('https://pds.fixture.test/**');
          const password = page.locator('input[name=password]');
          if (await password.count()) await password.fill(accounts[handle].pass);
          await page.getByRole('button', { name: /^authorize$/i }).click();
          await page.waitForURL(url => url.origin === origin && url.pathname === room.pathname);
          assert.equal(new URL(page.url()).searchParams.get('track'), trackId, 'Permission upgrade preserves room and chosen track');
        }
        await page.getByRole('button', { name: 'Create Jam with current track', exact: true }).click();
        await page.getByRole('button', { name: 'Play Jam', exact: true }).waitFor();
        await page.screenshot({ path: output + (deviceOnly ? '/upgraded-room.png' : '/normal-room.png') });
        console.log(deviceOnly ? 'Existing base session: permission upgrade preserves room/track and creates real Space' : 'Normal sign-in: queue creates real Jam Space without another sign-in');
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
