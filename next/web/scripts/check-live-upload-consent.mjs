import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { app, browserAccount } from './live-browser-account.mjs';
const coordinator = 'https://jams.next.plyr.fm';
const authorizer = coordinator + '/v1/uploads/authorize';
const { ZAT_TEST_HANDLE: handle, ZAT_TEST_PASSWORD: password, ZAT_TEST_PDS: pdsUrl } = process.env;
const { pds, signIn, signOut } = await browserAccount(handle, password, pdsUrl);

function wave(name) {
  const bytes = Buffer.alloc(8044);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return { name, mimeType: 'audio/wav', buffer: bytes };
}

async function verify(browser, width, album) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  let stage = 'guarding publication';
  let failure;
  let consented = false;
  const destination = album ? '/upload?mode=album' : '/upload';
  const forbidden = [];
  const pdsResponses = [];
  const pdsStages = new Set(['/.well-known/oauth-authorization-server', '/oauth/par', '/oauth/authorize', '/oauth/token', '/oauth/revoke']);
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === pds.origin && pdsStages.has(url.pathname)) pdsResponses.push(url.pathname + ' ' + response.status());
    else if (url.origin === 'https://public.api.bsky.app' && url.pathname === '/xrpc/com.atproto.identity.resolveHandle') pdsResponses.push('handle lookup ' + response.status());
  });
  try {
    await context.route('**/xrpc/**', route => {
      const { pathname } = new URL(route.request().url());
      if (route.request().method() === 'POST' && /^\/xrpc\/com\.atproto\.(repo|space|memberspace)\./.test(pathname)) {
        forbidden.push(pathname);
        return route.abort();
      }
      return route.continue();
    });
    await context.route('**/v1/uploads/**', route => route.request().url() === authorizer ? route.continue() : route.abort());

    stage = 'opening signed-out upload';
    await page.goto(app + destination, { waitUntil: 'domcontentloaded' });
    await signIn(page, next => { stage = next; });
    consented = true;
    stage = 'returning to the original upload form';
    await page.waitForURL(app + destination);
    if (album) {
      await page.getByRole('textbox', { name: 'album name' }).fill('browser fixture');
      await page.getByLabel('audio files', { exact: true }).setInputFiles([wave('first.wav'), wave('second.wav')]);
      assert.equal(await page.getByRole('textbox', { name: 'title for song 2' }).inputValue(), 'second');
    } else {
      await page.getByLabel('audio file', { exact: true }).setInputFiles(wave('single.wav'));
      await page.getByText('selected: single.wav', { exact: true }).waitFor();
    }
    await page.getByRole('checkbox', { name: 'use plyr.fm storage' }).check();

    stage = 'checking upload authority from the browser';
    const blocked = page.waitForEvent('requestfailed', { predicate: request => request.method() === 'POST' && /^\/v1\/uploads\/[a-f0-9]{64}\/[a-f0-9-]+$/.test(new URL(request.url()).pathname) }).catch(() => undefined);
    const [admission] = await Promise.all([
      page.waitForResponse(response => response.url() === authorizer && response.request().method() === 'POST'),
      page.getByRole('button', { name: album ? 'upload songs' : 'upload', exact: true }).click()
    ]);
    if (!admission.ok()) throw new Error(`upload admission returned HTTP ${admission.status()}`);
    assert.ok(await blocked, 'transfer start did not reach the browser guard');
    assert.deepEqual(forbidden, [], 'no repository or Space mutation was attempted');
  } catch (error) {
    const detail = stage === 'checking upload authority from the browser' && error.message.startsWith('upload admission returned HTTP') ? `: ${error.message}` : '';
    if (pdsResponses.length) console.error(pdsResponses.join(', '));
    failure = new Error(`${width}px failed at ${stage} (${error.name})${detail}`);
  } finally {
    try {
      if (consented) await signOut(page, destination);
    } catch (error) {
      const cleanup = new Error(`${width}px failed to revoke the browser session (${error.name})`);
      failure = failure ? new AggregateError([failure, cleanup], 'browser check and cleanup failed') : cleanup;
    } finally { await context.close(); }
  }
  if (failure) throw failure;
  console.log(`${width}px ${album ? 'album' : 'track'}: OAuth return, upload admission, and sign-out passed`);
}

const browser = await chromium.launch();
try {
  await verify(browser, 390, false);
  await verify(browser, 1280, true);
} finally {
  await browser.close();
}
