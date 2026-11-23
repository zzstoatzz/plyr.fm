// The desktop sidebar collapses to icons with ⌘B / Ctrl+B or its toggle, the page takes the freed width, and a
// reload comes back collapsed from the first frame (app.html), with no open-then-close flash.
const assert = require('node:assert/strict');
const { setup } = require('./fixture-catalog.cjs');

module.exports = async function sidebarCollapse(browser, origin) {
  const { context, page, errors } = await setup(browser, 1440, 900);
  try {
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const widths = () => page.evaluate(() => [document.querySelector('nav[aria-label="Main navigation"]').getBoundingClientRect().width, document.getElementById('main').getBoundingClientRect().width]);
    await page.goto(origin);
    await page.getByTestId('home-track-row').first().waitFor();
    const [open, mainOpen] = await widths();
    await page.keyboard.press('Control+b');
    await nav.getByRole('button', { name: 'Expand sidebar' }).waitFor();
    await page.waitForTimeout(400);
    const [collapsed, mainCollapsed] = await widths();
    assert.ok(collapsed < 80 && open > 200, `the sidebar collapses to icons: ${open} → ${collapsed}`);
    assert.equal(Math.round(mainCollapsed - mainOpen), Math.round(open - collapsed), 'the page takes the width the sidebar gave up');
    assert.equal(await nav.getByRole('link', { name: 'library' }).count(), 1, 'collapsed items keep their names');
    await page.addInitScript(() => {
      const seen = window.__navFrames = [];
      (function frame() {
        const nav = document.querySelector('nav[aria-label="Main navigation"]');
        if (nav) { const width = Math.round(nav.getBoundingClientRect().width); if (seen.at(-1) !== width) seen.push(width); }
        requestAnimationFrame(frame);
      })();
    });
    await page.reload();
    await page.getByTestId('home-track-row').first().waitFor();
    assert.deepEqual(await page.evaluate(() => window.__navFrames), [Math.round(collapsed)], 'a reload paints the sidebar collapsed from its first frame');
    await nav.getByRole('button', { name: 'Expand sidebar' }).click();
    await page.waitForTimeout(400);
    assert.equal(Math.round((await widths())[0]), Math.round(open), 'the toggle opens it again');
    assert.equal(await page.evaluate(() => localStorage.getItem('plyr-next:nav')), null);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
};
