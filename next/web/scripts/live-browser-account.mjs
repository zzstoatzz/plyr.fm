import assert from 'node:assert/strict';

export const app = 'https://next.plyr.fm';

export async function browserAccount(handle, password, pdsUrl) {
  assert.ok(handle && password && pdsUrl, 'missing dedicated account credentials');
  const pds = new URL(pdsUrl);
  assert.ok(pds.protocol === 'https:' && !pds.username && !pds.password, 'invalid dedicated account host');
  const discovery = await fetch(new URL('/.well-known/oauth-authorization-server', pds), { redirect: 'error', signal: AbortSignal.timeout(10000) });
  assert.ok(discovery.ok, 'could not discover the dedicated authorization server');
  const { issuer, authorization_endpoint: authorize, revocation_endpoint: revoke } = await discovery.json();
  assert.ok(issuer === pds.origin && new URL(authorize).origin === issuer && new URL(revoke).origin === issuer, 'unexpected authorization server metadata');

  async function signIn(page, step, link = 'sign in') {
    // pds.zat.dev paints its sign-in page with a WebGL scene (zds's garden skin,
    // 2026-11-24). Headless CI renders it in software, which at desktop widths
    // starves the page until clicks time out. Without a WebGL context the PDS
    // serves its plain paper page; this applies to the PDS origin only.
    await page.addInitScript((origin) => {
      if (location.origin !== origin) return;
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return /webgl/i.test(type) ? null : getContext.call(this, type, ...rest);
      };
    }, issuer);
    step('opening sign-in');
    await page.locator('main').getByRole('link', { name: link, exact: true }).click();
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
    // signed-out settings has no sign-in link in main, only the sidebar's
    await page.getByRole('link', { name: 'sign in', exact: true }).first().waitFor();
  }

  return { pds, signIn, signOut };
}
