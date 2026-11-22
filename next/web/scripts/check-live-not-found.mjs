// Live: a missing artist, album, playlist or track on next.plyr.fm shows the 404 page, not a crash.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const site = 'https://next.plyr.fm';
const encode = kind => kind + '_' + Buffer.from('at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/fm.plyr.list/3zzzzzzzzzzzz').toString('base64url');
const pages = [['/u/plyr-missing-artist.invalid', 'artist'], ['/album/' + encode('alb'), 'album'], ['/playlist/' + encode('pls'), 'playlist'], ['/track/missing-track', 'track']];

const browser = await chromium.launch();
try {
  for (const [width, height] of [[1280, 800], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    for (const [path, thing] of pages) {
      await page.goto(site + path);
      await page.getByRole('heading', { name: '404', exact: true }).waitFor({ timeout: 15_000 });
      await page.getByText(`we couldn't find that ${thing}`, { exact: true }).waitFor();
      await page.getByRole('link', { name: 'search plyr.fm', exact: true }).waitFor();
      assert.equal(await page.getByText('Internal Error').count(), 0, `${path} still crashes`);
      console.log(`${width}px ${path}: 404 page`);
    }
    await page.close();
  }
} finally { await browser.close(); }
