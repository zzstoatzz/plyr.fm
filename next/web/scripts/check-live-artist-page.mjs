// Live: an artist page loads with the appview's links + background fields, and renders the links it gets.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const site = 'https://next.plyr.fm';
const did = 'did:plc:cqqtuv75m7e5s4uj6nw4czyu';
const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-live-home-rail';
await mkdir(output, { recursive: true });

const browser = await chromium.launch();
try {
  for (const [width, height, scheme] of [[1440, 900, 'dark'], [1440, 900, 'light'], [390, 844, 'dark']]) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme });
    const artist = page.waitForResponse(response => response.url().includes('/xrpc/fm.plyr.unspecced.getArtist'));
    await page.goto(site + '/u/' + did);
    const body = await (await artist).json();
    assert.ok(Array.isArray(body.links), 'getArtist answers with a links array');
    assert.ok('backdrop' in body, 'getArtist answers with a backdrop field');
    await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 20_000 });
    const chips = await page.locator('ul.links a').count();
    assert.equal(chips, body.links.length, 'every link the appview returns shows as a chip');
    await page.screenshot({ path: path.join(output, `artist-${width}-${scheme}.png`) });
    console.log(`${width}-${scheme}: artist page, ${chips} links, backdrop ${body.backdrop?.kind ?? 'photo (default)'}`);
    await page.close();
  }
} finally { await browser.close(); }
