import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { app, browserAccount } from './live-browser-account.mjs';

// signed in on live next: the upload page opens on the drop zone, one file opens the track form and
// several open the album form. nothing is submitted; every write and upload is refused.
const output = process.env.SCREENS_OUTPUT || '/tmp/plyr-live-upload-page';
const { ZAT_TEST_HANDLE: handle, ZAT_TEST_PASSWORD: password, ZAT_TEST_PDS: pdsUrl } = process.env;
const { signIn } = await browserAccount(handle, password, pdsUrl);

// sign out from settings and wait for the stored session to go; the revoke runs after the page has gone home,
// so leaving too early would cut it off and keep the session
async function signOut(page) {
  await page.goto(app + '/settings', { waitUntil: 'domcontentloaded' });
  const button = page.getByRole('button', { name: 'sign out', exact: true });
  const signedOut = page.locator('main').getByRole('link', { name: 'sign in', exact: true });
  await button.or(signedOut).first().waitFor();
  if (!await button.isVisible()) return;
  const revoke = page.context().waitForEvent('response', { predicate: response => /\/oauth\/revoke$/.test(new URL(response.url()).pathname), timeout: 30_000 })
    .then(response => response.status(), () => 'not seen');
  await button.click();
  await page.waitForURL(app + '/');
  await page.waitForFunction(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('@atproto-oauth-client');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const count = db.transaction('session').objectStore('session').count();
      db.close();
      count.onerror = () => reject(count.error);
      count.onsuccess = () => resolve(count.result === 0);
    };
  }), null, { timeout: 30_000 });
  console.log(`revoke: ${await revoke}`);
  await page.goto(app + '/upload', { waitUntil: 'domcontentloaded' });
  await signedOut.waitFor();
}

function wave(name) {
  const bytes = Buffer.alloc(8044);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return { name, mimeType: 'audio/wav', buffer: bytes };
}

async function verify(browser, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  // a leave-page prompt must not hold the sign-out navigation
  page.on('dialog', dialog => dialog.accept());
  const writes = [];
  let stage = 'guarding writes';
  let failure;
  let consented = false;
  try {
    await context.route('**/xrpc/**', route => {
      const request = route.request();
      if (request.method() === 'POST' && /^\/xrpc\/com\.atproto\.(repo|space|memberspace)\./.test(new URL(request.url()).pathname)) {
        writes.push(new URL(request.url()).pathname);
        return route.abort();
      }
      return route.continue();
    });
    await context.route('**/v1/uploads/**', route => route.abort());
    const shot = name => page.screenshot({ path: path.join(output, `${width}-${name}.png`), fullPage: true });

    stage = 'signing in from the upload page';
    await page.goto(app + '/upload', { waitUntil: 'domcontentloaded' });
    await signIn(page, next => { stage = next; });
    consented = true;
    await page.waitForURL(app + '/upload');

    stage = 'opening the drop zone';
    await page.getByText('one file makes a track. several make an album.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'choose audio', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab').count(), 0, 'the upload page has no track and album tabs');
    await page.waitForTimeout(1500);
    await shot('door');

    stage = 'choosing several files';
    await page.getByLabel('audio file', { exact: true }).setInputFiles([wave('first.wav'), wave('second.wav')]);
    await page.waitForURL(app + '/upload?mode=album');
    assert.equal(await page.getByRole('textbox', { name: 'title for track 2' }).inputValue(), 'second');
    await page.getByRole('textbox', { name: 'album name' }).fill('live check');
    await page.getByRole('button', { name: 'upload album' }).waitFor();
    await shot('album');

    stage = 'starting over';
    await page.getByRole('button', { name: 'start over', exact: true }).click();
    await page.waitForURL(app + '/upload');

    stage = 'choosing one file';
    await page.getByLabel('audio file', { exact: true }).setInputFiles(wave('single.wav'));
    // the title fills from the file name once the audio is read
    const title = page.getByRole('textbox', { name: 'title', exact: true });
    await title.waitFor();
    await page.waitForFunction(() => document.querySelector('input[aria-label="title"]')?.value === 'single');
    await page.getByRole('group', { name: 'album' }).waitFor();
    await shot('track');
    await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.includes('upload')) localStorage.removeItem(key); });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(scrollWidth <= width, `the page scrolls sideways at ${width}px`);
    assert.deepEqual(writes, [], 'nothing was written');
  } catch (error) {
    await page.screenshot({ path: path.join(output, `${width}-failed.png`), fullPage: true }).catch(() => {});
    failure = new Error(`${width}px failed at ${stage}: ${error.message}`);
  } finally {
    try {
      if (consented) await signOut(page);
    } catch (error) {
      // the test account's tokens expire on their own; a stuck sign-out is reported, not a failed upload page
      await page.screenshot({ path: path.join(output, `${width}-sign-out.png`), fullPage: true }).catch(() => {});
      console.warn(`::warning::${width}px sign-out did not finish at ${page.url()}: ${error.message.split('\n')[0]}`);
    } finally { await context.close(); }
  }
  if (failure) throw failure;
  console.log(`${width}px: drop zone, album form and track form open on live next`);
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  await verify(browser, 390);
  await verify(browser, 1280);
} finally {
  await browser.close();
}
