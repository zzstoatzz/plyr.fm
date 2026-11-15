import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const app = 'https://next.plyr.fm';
const coordinator = 'https://jams.next.plyr.fm';
const authorizer = coordinator + '/v1/uploads/authorize';
const { ZAT_TEST_HANDLE: handle, ZAT_TEST_PASSWORD: password, ZAT_TEST_PDS: pdsUrl } = process.env;
assert.ok(handle && password && pdsUrl, 'missing dedicated account credentials');
const pds = new URL(pdsUrl);
assert.ok(pds.protocol === 'https:' && !pds.username && !pds.password, 'invalid dedicated account host');
const discovery = await fetch(new URL('/.well-known/oauth-authorization-server', pds), { redirect: 'error', signal: AbortSignal.timeout(10000) });
assert.ok(discovery.ok, 'could not discover the dedicated authorization server');
const { issuer, authorization_endpoint: authorize, revocation_endpoint: revoke } = await discovery.json();
assert.ok(issuer === pds.origin && new URL(authorize).origin === issuer && new URL(revoke).origin === issuer, 'unexpected authorization server metadata');

function wave(name) {
  const bytes = Buffer.alloc(8044);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return { name, mimeType: 'audio/wav', buffer: bytes };
}

async function signIn(page, step) {
  step('opening sign-in');
  await page.locator('main').getByRole('link', { name: 'sign in', exact: true }).click();
  await page.getByLabel('atmosphere account').fill(handle);
  await page.locator('main form button[type=submit]').click();
  step('redirecting to the dedicated PDS');
  await page.waitForURL(url => url.origin + url.pathname === authorize);
  step('opening the PDS password prompt');
  const passwordInput = page.locator('input[name=password]:visible');
  const passwordMode = page.getByText(/^(use password(?: instead)?)$/i).filter({ visible: true });
  await passwordInput.or(passwordMode).first().waitFor();
  if (await passwordMode.first().isVisible()) await passwordMode.first().click();
  const identifier = page.locator('input[name=username]:visible');
  if (await identifier.count()) await identifier.fill(handle);
  step('entering the PDS password');
  await passwordInput.fill(password);
  const providerSignIn = page.getByRole('button', { name: 'Sign in', exact: true });
  if (await providerSignIn.isVisible()) await providerSignIn.click();
  step('approving the PDS consent');
  await page.getByRole('button', { name: /^(authorize|allow)$/i }).click();
}

async function signOut(page, destination) {
  await page.goto(app + '/settings', { waitUntil: 'domcontentloaded' });
  const signOutButton = page.getByRole('button', { name: 'sign out', exact: true });
  const signedOut = page.locator('main').getByRole('link', { name: 'sign in', exact: true });
  await signOutButton.or(signedOut).first().waitFor();
  if (!await signOutButton.isVisible()) return;
  await Promise.all([
    page.waitForResponse(response => response.url() === revoke && response.request().method() === 'POST' && response.ok()),
    signOutButton.click()
  ]);
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
  }));
  await page.goto(app + destination, { waitUntil: 'domcontentloaded' });
  await signedOut.waitFor();
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
    await page.getByRole('checkbox', { name: 'use plyr storage' }).check();

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
