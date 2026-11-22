// A reload must paint in the theme that was on screen, from the boot screen through the
// session restore. Here the system is light, the signed-out prefs are light and the last
// session left dark on screen; the sign-in library is held back so the restore is still
// running when the shell mounts. Every frame until it settles has to stay dark.
const assert = require('node:assert/strict');
const { setup } = require('./fixture-catalog.cjs');

const dark = 'rgb(10, 10, 10)';

module.exports = async function themeBoot(browser, origin) {
  const { context, page, errors } = await setup(browser, 1280, 900, { scheme: 'light' });
  try {
    await page.addInitScript(() => {
      localStorage.setItem('plyr-next:prefs:active', JSON.stringify({ theme: 'dark' }));
      indexedDB.open('@atproto-oauth-client').onsuccess = event => event.target.result.close();
      const seen = window.__themeFrames = [];
      (function frame() {
        if (document.body) {
          const value = (document.documentElement.dataset.theme || 'system') + ' ' + getComputedStyle(document.documentElement).backgroundColor;
          if (seen.at(-1) !== value) seen.push(value);
        }
        requestAnimationFrame(frame);
      })();
    });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route(origin + '/_app/immutable/chunks/*.js', async route => {
      const response = await route.fetch();
      const body = await response.text();
      // the oauth client: the only large chunk that restores a session
      if (body.length > 100_000 && body.includes('initRestore')) await held;
      await route.fulfill({ response, body });
    });
    await page.goto(origin);
    await page.getByTestId('home-track-row').first().waitFor();
    await page.waitForTimeout(400);
    const restoring = await page.evaluate(() => window.__themeFrames);
    assert.deepEqual(restoring, ['dark ' + dark], 'the theme on screen holds while the session restores: ' + restoring.join(' → '));
    release();
    // no session to restore: the signed-out prefs (light) take over once auth settles
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
};
