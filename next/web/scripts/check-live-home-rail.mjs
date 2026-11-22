// Live: the desktop home rail ends with every radio station and stays on screen when the page scrolls past it; phones have no rail.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const site = 'https://next.plyr.fm';
const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-live-home-rail';
await mkdir(output, { recursive: true });

const browser = await chromium.launch();
try {
  for (const [width, height, scheme] of [[1440, 900, 'dark'], [1440, 900, 'light'], [1024, 768, 'dark'], [390, 844, 'dark']]) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: 2 });
    await page.goto(site + '/');
    await page.getByTestId('home-track-row').first().waitFor({ timeout: 20_000 });
    const radio = page.getByTestId('home-radio');
    const name = `${width}-${scheme}`;
    if (width < 901) {
      assert.equal(await radio.isVisible(), false, 'phones have no radio rail');
      await page.screenshot({ path: path.join(output, `${name}-top.png`) });
      console.log(`${name}: no rail`);
      await page.close();
      continue;
    }
    const stations = radio.getByRole('button', { name: /^Listen to .+ radio$/ });
    assert.equal(await stations.count(), 5, 'the rail lists every station');
    // each station says what it airs once its feed answers
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="home-radio"] small')].every(node => node.textContent && node.textContent !== 'tuning in…'), undefined, { timeout: 20_000 });
    await page.screenshot({ path: path.join(output, `${name}-top.png`) });
    await page.mouse.move(width / 3, height / 2);
    await page.mouse.wheel(0, 1500);
    await page.waitForFunction(() => window.scrollY > 600);
    await page.waitForTimeout(400);
    const rail = await page.getByRole('complementary', { name: 'explore' }).evaluate(node => { const box = node.getBoundingClientRect(); return { top: box.top, bottom: box.bottom }; });
    assert.ok(rail.bottom > height / 2 && rail.bottom <= height, `the rail stays on screen after scrolling (bottom at ${Math.round(rail.bottom)}px)`);
    assert.ok(await radio.isVisible(), 'radio is still in view');
    await page.screenshot({ path: path.join(output, `${name}-scrolled.png`) });
    console.log(`${name}: rail pinned, bottom at ${Math.round(rail.bottom)}px; ${(await radio.locator('small').allTextContents()).join(' | ')}`);
    await page.close();
  }
} finally { await browser.close(); }
