// Live: a track page opens at its short link, and the older long link moves there.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { idFromUri } from '../edge/link-preview.js';

const site = 'https://next.plyr.fm';
const api = 'https://api.next.plyr.fm';
const uri = 'at://did:plc:siv7zbedip4vcet4v67piibr/fm.plyr.track/3mrttu6zg4k22';
const short = '/track/' + idFromUri('trk_', uri);
const long = '/track/trk_' + Buffer.from(uri).toString('base64url');
assert.equal(short, '/track/trk_siv7zbedip4vcet4v67piibr.3mrttu6zg4k22');

const moved = await fetch(site + long + '?t=1', { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
assert.equal(moved.status, 301, `${long} should move to the short link`);
assert.equal(moved.headers.get('location'), site + short + '?t=1');
console.log(`${long} -> 301 ${short}`);

const track = await (await fetch(`${api}/xrpc/fm.plyr.unspecced.getTrack?${new URLSearchParams({ uri })}`, { signal: AbortSignal.timeout(15_000) })).json();
const browser = await chromium.launch();
try {
  for (const [width, height] of [[1280, 800], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(site + short);
    await page.getByRole('heading', { name: track.metadata.title, exact: true }).first().waitFor({ timeout: 15_000 });
    assert.equal(new URL(page.url()).pathname, short, 'the short link must stay put');
    console.log(`${width}px ${short}: ${track.metadata.title}`);
    await page.close();
  }
} finally { await browser.close(); }
