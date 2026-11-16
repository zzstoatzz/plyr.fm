const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { fixtureAccounts, fixturePage, authorizeFixture } = require('./pds-browser-fixture.cjs');
const { tracks } = require('./fixture-catalog.cjs');

const origin = 'http://127.0.0.1:5534';
const handle = 'svelteteal.test';
const audioUrl = 'https://panel-fixture.invalid/scrobble.wav';
const collection = 'fm.teal.feed.play';
const audio = Buffer.alloc(44 + 8000 * 4);
audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
const track = { ...tracks[0], metadata: { ...tracks[0].metadata, duration_seconds: 2 } };

(async () => {
  const accounts = await fixtureAccounts(['svelteteal']);
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const { page, context } = await fixturePage(browser, accounts, {
      origin,
      dist: path.resolve(__dirname, '../build'),
      context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    });
    const scrobbles = [];
    page.on('request', request => {
      if (!new URL(request.url()).pathname.endsWith('/com.atproto.repo.createRecord')) return;
      const body = request.postDataJSON();
      if (body.collection === collection) scrobbles.push(body);
    });
    await page.route('https://api.next.plyr.fm/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/v1/tracks/' + track.id + '/playback') return route.fulfill({ json: {
        availability: { status: 'available', delivery: { url: audioUrl } }
      } });
      if (pathname === '/v1/tracks/' + track.id) return route.fulfill({ json: track });
      if (route.request().method() !== 'GET') return route.abort();
      return route.fulfill({ json: { data: [], has_more: false } });
    });
    await context.route(audioUrl, route => route.fulfill({ contentType: 'audio/wav', body: audio }));

    await page.goto(origin + '/login?deviceOnly=true&return_to=%2Fsettings');
    await authorizeFixture(page, accounts, handle);
    await page.waitForURL(origin + '/settings');
    const toggle = page.getByRole('switch', { name: 'teal.fm scrobbling' });
    await toggle.waitFor();
    assert.equal(await toggle.isChecked(), false);
    const consent = page.waitForRequest(request => new URL(request.url()).pathname === '/oauth/par');
    await toggle.click();
    const fields = new URLSearchParams((await consent).postData());
    assert.match(fields.get('scope'), /(?:^| )repo:fm\.teal\.feed\.play\?action=create(?: |$)/);
    await page.waitForURL('https://pds.fixture.test/**');
    const password = page.locator('input[name=password]');
    const usePassword = page.getByRole('link', { name: 'Use password' });
    if (await usePassword.isVisible()) await usePassword.click();
    if (await password.isVisible()) {
      await password.fill(accounts[handle].pass);
      const signIn = page.getByRole('button', { name: /^sign in$/i });
      if (await signIn.isVisible()) await signIn.click();
    }
    await page.getByRole('button', { name: /^authorize$/i }).click({ timeout: 9000 }).catch(async error => {
      console.log(await page.locator('body').innerText());
      throw error;
    });
    await page.waitForURL(origin + '/settings');
    await page.locator('input[aria-label="teal.fm scrobbling"]:checked').waitFor();
    if (process.env.SCREENS_OUTPUT) await page.screenshot({ path: path.join(process.env.SCREENS_OUTPUT, 'teal-settings-phone.png') });

    async function listen() {
      await page.goto(origin + '/track/' + track.id);
      await page.locator('main').getByRole('button', { name: 'Play', exact: true }).click();
      await page.waitForFunction(() => window.jamAudio.some(audio => audio.ended));
    }
    const write = page.waitForResponse(response => response.url().endsWith('/com.atproto.repo.createRecord') && response.ok());
    await listen();
    await write;
    assert.equal(scrobbles.length, 1);
    assert.equal(scrobbles[0].repo, accounts[handle].did);
    assert.equal(scrobbles[0].record.trackName, track.metadata.title);

    await page.goto(origin + '/settings');
    await toggle.uncheck();
    await listen();
    assert.equal(scrobbles.length, 1, 'opt-out prevents further writes even with a retained grant');
    console.log('Teal consent, one qualified PDS write, and opt-out passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
