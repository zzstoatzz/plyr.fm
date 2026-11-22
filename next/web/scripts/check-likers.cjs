// The likes count in a track's action row opens "liked by" only for the count itself: resting the pointer beside it does nothing,
// it never sits under the heart's tile, and a tap leaves no browser highlight behind.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { setup, serve, close } = require('./fixture-catalog.cjs');
const { method } = require('./xrpc-fixture.cjs');

const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-svelte-likers';

async function verify(browser, origin, width) {
  const phone = width < 500;
  const { page, errors } = await setup(browser, width, phone ? 760 : 900, { phone });
  try {
    await page.route(url => url.hostname === 'api.next.plyr.fm' && method(url) === 'getTrackLikes', route => route.fulfill({ json: {
      object: 'list', has_more: false, data: [{ record: { uri: 'at://did:plc:fan/fm.plyr.like/1' }, actor: { did: 'did:plc:fan', profile: { handle: 'fan.test', display_name: 'A Fan' } } }]
    } }));
    await page.goto(origin);
    await page.getByTestId('home-track-row').first().getByRole('button', { name: /^Play / }).click();
    await page.getByTestId('player-dock').getByRole('button', { name: 'Open now playing' }).click();
    const dialog = page.getByRole('dialog', { name: 'Now playing' });
    await dialog.waitFor();
    await page.mouse.move(1, 1);
    const count = dialog.getByRole('button', { name: /^3 likes on / });
    const people = page.getByRole('group', { name: 'People who liked this track' });
    await count.scrollIntoViewIfNeeded();
    const glyph = await count.locator('.glyph').boundingBox();
    const button = await count.boundingBox();
    assert.ok(glyph && button, 'the likes count shows on now playing');
    const heart = await dialog.getByRole('link', { name: 'Sign in to like' }).boundingBox();
    assert.ok(heart.x + heart.width <= button.x + 0.5, 'the count must not sit under the heart, or its tile takes the count and the count takes the space beside it');
    assert.ok(await count.evaluate(node => { const box = node.querySelector('.glyph').getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return hit?.closest('.likers') === node; }), 'the count is on top where it shows');
    if (phone) {
      assert.equal(await count.evaluate(node => getComputedStyle(node).webkitTapHighlightColor), 'rgba(0, 0, 0, 0)', 'no browser tap flash over the controls');
      await count.tap();
      await people.getByText('A Fan').waitFor();
      await page.screenshot({ path: path.join(output, `${width}-now-playing-likers.png`) });
      assert.deepEqual(errors, []);
      console.log(`liked by opens from a tap on the count at ${width}px`);
      return;
    }
    // beside the count, still inside its tap target
    await page.mouse.move(Math.min(glyph.x + glyph.width + 4, button.x + button.width - 1), glyph.y + glyph.height / 2);
    await page.waitForTimeout(500);
    assert.equal(await people.isVisible(), false, 'pointing beside the count must not open liked by');
    // passing over the count on the way somewhere else
    await page.mouse.move(glyph.x + glyph.width / 2, glyph.y + glyph.height / 2);
    await page.mouse.move(1, 1);
    await page.waitForTimeout(500);
    assert.equal(await people.isVisible(), false, 'passing over the count must not open liked by');
    await page.mouse.move(glyph.x + glyph.width / 2, glyph.y + glyph.height / 2);
    await people.getByText('A Fan').waitFor();
    await page.screenshot({ path: path.join(output, `${width}-now-playing-likers.png`) });
    assert.deepEqual(errors, []);
    console.log(`liked by opens only from the count at ${width}px`);
  } finally { await page.context().close(); }
}

(async () => {
  await require('node:fs/promises').mkdir(output, { recursive: true });
  const origin = await serve();
  const browser = await chromium.launch();
  try { for (const width of [390, 1280, 1440]) await verify(browser, origin, width); }
  finally { await browser.close(); close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
