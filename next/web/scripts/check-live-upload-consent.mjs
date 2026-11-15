import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const app = 'https://next.plyr.fm';
const coordinator = 'https://jams.next.plyr.fm';
const authorizer = coordinator + '/v1/uploads/authorize';
const { ZAT_TEST_HANDLE: handle, ZAT_TEST_PASSWORD: password, ZAT_TEST_PDS: pdsUrl } = process.env;
assert.ok(handle && password && pdsUrl, 'missing dedicated account credentials');
const pds = new URL(pdsUrl);
assert.ok(pds.protocol === 'https:' && !pds.username && !pds.password, 'invalid dedicated account host');

function wave(name) {
  const bytes = Buffer.alloc(8044);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return { name, mimeType: 'audio/wav', buffer: bytes };
}

async function signIn(page) {
  await page.locator('main').getByRole('link', { name: 'sign in', exact: true }).click();
  await page.getByLabel('atmosphere account').fill(handle);
  await page.locator('main form button[type=submit]').click();
  await page.waitForURL(url => url.origin === pds.origin && url.pathname === '/oauth/authorize');
  const passwordInput = page.locator('input[name=password]:visible');
  const passwordMode = page.getByText(/^(use password(?: instead)?)$/i);
  await passwordInput.or(passwordMode).first().waitFor();
  if (await passwordMode.first().isVisible()) await passwordMode.first().click();
  const identifier = page.locator('input[name=username]:visible');
  if (await identifier.count()) await identifier.fill(handle);
  await passwordInput.fill(password);
  const providerSignIn = page.getByRole('button', { name: 'Sign in', exact: true });
  if (await providerSignIn.isVisible()) await providerSignIn.click();
  await page.getByRole('button', { name: 'authorize', exact: true }).click();
}

async function verify(browser, width, album) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  let stage = 'guarding publication';
  const forbidden = [];
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
    const destination = album ? '/upload?mode=album' : '/upload';
    await page.goto(app + destination, { waitUntil: 'domcontentloaded' });
    stage = 'authorizing through the dedicated PDS';
    await signIn(page);
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
    await page.getByRole('checkbox', { name: 'use plyr storage' }).check();

    stage = 'checking upload authority from the browser';
    const [admission] = await Promise.all([
      page.waitForResponse(response => response.url() === authorizer && response.request().method() === 'POST'),
      page.waitForEvent('requestfailed', { predicate: request => request.method() === 'POST' && /^\/v1\/uploads\/[a-f0-9]{64}\/[a-f0-9-]+$/.test(new URL(request.url()).pathname) }),
      page.getByRole('button', { name: album ? 'upload songs' : 'upload', exact: true }).click()
    ]);
    if (!admission.ok()) throw new Error(`upload admission returned HTTP ${admission.status()}`);
    assert.deepEqual(forbidden, [], 'no repository or Space mutation was attempted');

    stage = 'signing out';
    await page.goto(app + '/settings', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'sign out', exact: true }).click();
    await page.waitForURL(app + '/');
    await page.goto(app + destination, { waitUntil: 'domcontentloaded' });
    await page.locator('main').getByRole('link', { name: 'sign in', exact: true }).waitFor();
    console.log(`${width}px ${album ? 'album' : 'track'}: OAuth return, upload admission, and sign-out passed`);
  } catch (error) {
    const detail = stage === 'checking upload authority from the browser' && error.message.startsWith('upload admission returned HTTP') ? `: ${error.message}` : '';
    throw new Error(`${width}px failed at ${stage} (${error.name})${detail}`);
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch();
try {
  await verify(browser, 390, false);
  await verify(browser, 1280, true);
} finally {
  await browser.close();
}
