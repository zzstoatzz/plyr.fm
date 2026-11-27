// A closed track a listener can't hear says exactly why, and when signing in is the fix, the words "sign in" are the way
// there and back to the track: in the dock, on the track, and in now playing, on a phone and a desktop.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { tracks, setup, serve, close } = require('./fixture-catalog.cjs');
const { method, names } = require('./xrpc-fixture.cjs');

const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-listen-blocked';
const closed = tracks[0];
const space = `at://${closed.artist.did}/space/fm.plyr.next.audio/supporters/${closed.artist.did}/fm.plyr.track/${closed.record.rkey}`;
const unsupported = 'your account’s hosting provider doesn’t support private tracks yet, so this track can’t play for you.';

(async () => {
  const base = await serve();
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const failures = [];
  try {
    for (const [width, height, phone] of [[390, 844, true], [1280, 860, false]]) {
      for (const scheme of ['light', 'dark']) {
        const label = `${width} ${scheme}`;
        const { context, page, errors } = await setup(browser, width, height, { phone, scheme });
        try {
          await page.route('https://api.next.plyr.fm/**', async route => {
            const url = new URL(route.request().url());
            if (method(url) !== 'getPlayback' || !names(url, closed.id)) return route.fallback();
            await route.fulfill({ json: { object: 'playback', track_id: closed.id, record: closed.record, availability: { status: 'gated', space: { record: space } } } });
          });
          await page.goto(`${base}/track/${closed.id}`);
          await page.locator('article').getByRole('button', { name: 'Play', exact: true }).click();
          const dock = page.getByTestId('player-dock');
          const link = dock.getByRole('link', { name: 'sign in', exact: true });
          await link.waitFor();
          assert.equal(await dock.getByRole('status').innerText(), 'sign in to play this track', `${label}: the dock says why`);
          const target = new URL(await link.getAttribute('href'), base);
          assert.equal(target.pathname, '/login', `${label}: the dock links to sign in`);
          assert.equal(target.searchParams.get('return_to'), `/track/${closed.id}`, `${label}: signing in comes back to the track`);
          const onTrack = page.locator('main').getByRole('link', { name: 'sign in', exact: true });
          assert.equal(await onTrack.count(), 1, `${label}: the track itself offers sign in`);
          await onTrack.evaluate(node => node.scrollIntoView({ block: 'center' }));
          await page.screenshot({ path: path.join(output, `sign-in-track-${width}-${scheme}.png`) });
          if (!phone) {
            await link.click();
            await page.waitForURL(url => url.pathname === '/login');
            assert.equal(new URL(page.url()).searchParams.get('return_to'), `/track/${closed.id}`, `${label}: pressing it opens sign in`);
            await page.goBack();
            await page.locator('article').waitFor();
          }
          // the host-can't-hold-access copy renders in the same places with no link: swap it in to see it laid out
          await page.locator('[role=status]').evaluateAll((nodes, text) => nodes.forEach(node => { if (/sign in to play/.test(node.textContent)) node.replaceChildren(text); }), unsupported);
          await page.screenshot({ path: path.join(output, `unsupported-host-track-${width}-${scheme}.png`) });
          if (phone) {
            await page.reload();
            await page.locator('article').getByRole('button', { name: 'Play', exact: true }).click();
            await link.waitFor();
            await page.getByRole('button', { name: 'Open now playing' }).click();
            const sheet = page.getByRole('dialog');
            await sheet.getByRole('link', { name: 'sign in', exact: true }).waitFor();
            await page.waitForTimeout(600);
            await page.screenshot({ path: path.join(output, `sign-in-now-playing-${width}-${scheme}.png`) });
          }
          assert.deepEqual(errors, [], `${label}: no page errors`);
          console.log(`${label}: a signed-out press says "sign in to play this track", linked to sign in and back`);
        } catch (error) {
          failures.push(error);
          await page.screenshot({ path: path.join(output, `failure-${width}-${scheme}.png`) }).catch(() => {});
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    close();
  }
  if (failures.length) { for (const failure of failures) console.error(failure.message); process.exit(1); }
})();
