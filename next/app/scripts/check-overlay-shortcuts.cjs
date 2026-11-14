const assert = require('node:assert/strict');
const { withPlayerHarness, setup, track } = require('./check-player-presentation.cjs');

async function run(browser, width) {
  const { context, page, errors } = await setup(browser, width, 'dark');
  try {
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/');
    const options = page.getByRole('button', { name: 'More options for ' + track.metadata.title, exact: true }).filter({ visible: true }).first();
    await options.click();
    const sheet = page.getByRole('dialog', { name: 'track options' });
    await sheet.waitFor();
    if (width >= 800) {
      const button = await options.boundingBox();
      const item = await sheet.getByRole('button', { name: 'add to queue', exact: true }).boundingBox();
      assert.ok(Math.abs(item.y - button.y) < 160 && Math.abs(item.x + item.width - button.x) < 80, 'the wide menu opens beside the button that opened it');
    }
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('q');
    await page.waitForTimeout(300);
    assert.equal(new URL(page.url()).pathname, '/', 'q does nothing while a sheet is open');
    // a wide window opens the menu as a dropdown with no close button; Escape closes either form
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'hidden' });
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('q');
    await page.waitForURL(url => url.pathname === '/queue');
    assert.deepEqual(errors, []);
    console.log(`${width}: an open sheet holds global shortcuts and releases them when it closes`);
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close(); }
}

withPlayerHarness(async browser => {
  for (const width of [390, 1280]) await run(browser, width);
}).catch(error => { console.error(error); process.exitCode = 1; });
