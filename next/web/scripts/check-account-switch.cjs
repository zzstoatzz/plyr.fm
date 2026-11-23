// Signs into two accounts on one browser and switches back and forth with a track in the player,
// expiring the inactive account's access token before each switch so every switch refreshes.
// Needs the dev server (`npx vite dev --port 5174 --host 127.0.0.1`, a loopback OAuth client) and an
// atproto PDS on 5197 with PLC on 5296 that accepts account creation, e.g. @atproto/pds + @did-plc/server
// started in dev mode with hostname localhost and serviceHandleDomains ['.test'].
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { tracks } = require('./fixture-catalog.cjs');

const app = process.env.SWITCH_APP || 'http://127.0.0.1:5174';
const pds = process.env.SWITCH_PDS || 'http://localhost:5197';
const plc = process.env.SWITCH_PLC || 'http://localhost:5296';
const password = 'fixture-only-password';

async function createAccount(name) {
  const handle = `${name}${Date.now().toString(36)}.test`;
  const response = await fetch(pds + '/xrpc/com.atproto.server.createAccount', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle, email: `${handle}@example.test`, password }) });
  const body = await response.json();
  if (!response.ok) throw new Error(`createAccount ${handle}: ${body.message ?? response.status}`);
  return { handle, did: body.did };
}

(async () => {
  const [first, second] = [await createAccount('switchone'), await createAccount('switchtwo')];
  const dids = Object.fromEntries([first, second].map(account => [account.handle, account.did]));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('https://plc.directory/**', async route => {
      const response = await fetch(plc + new URL(route.request().url()).pathname);
      await route.fulfill({ status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
    });
    await context.route('https://public.api.bsky.app/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('resolveHandle')) return route.fulfill({ json: { did: dids[url.searchParams.get('handle')] }, headers: { 'access-control-allow-origin': '*' } });
      return route.fulfill({ status: 404, json: {}, headers: { 'access-control-allow-origin': '*' } });
    });
    await context.route(/^https:\/\/(api\.next\.plyr\.fm|api\.plyr\.fm|jams\.next\.plyr\.fm|typeahead\.waow\.tech|images\.plyr\.fm|cdn\.bsky\.app)\//,
      route => route.fulfill({ json: { data: [], has_more: false, actors: [] }, headers: { 'access-control-allow-origin': '*' } }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const menu = page.getByRole('dialog', { name: 'account', exact: true });
    const you = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^you\b/ });
    const current = () => page.evaluate(async () => (await import('/src/lib/auth.ts')).auth.getAuth().did);
    async function signIn(handle) {
      await page.getByLabel('atmosphere account').fill(handle);
      await page.getByRole('button', { name: /^(sign in|continue at .+)$/i }).last().click();
      await page.waitForURL(pds + '/**');
      await page.locator('input[type=password]').fill(password);
      await page.getByRole('button', { name: /sign in|next|continue/i }).last().click();
      await page.getByRole('button', { name: /authorize|accept|allow/i }).first().click();
      await page.waitForURL(app + '/**');
      await page.waitForFunction(async did => (await import('/src/lib/auth.ts')).auth.getAuth().did === did, dids[handle]);
    }
    // the SDK refreshes a session whose access token has run out, as an account left idle in the background has
    const expire = did => page.evaluate(did => new Promise((resolve, reject) => {
      const open = indexedDB.open('@atproto-oauth-client');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const store = open.result.transaction('session', 'readwrite').objectStore('session');
        const read = store.get(did);
        read.onsuccess = () => { read.result.value.tokenSet.expires_at = new Date(Date.now() - 60_000).toISOString(); store.put(read.result, did).onsuccess = () => { open.result.close(); resolve(); }; };
      };
    }), did);

    await page.goto(app + '/login?return_to=%2Fsettings');
    await signIn(first.handle);
    await you.click();
    await menu.getByRole('link', { name: 'add account' }).click();
    await signIn(second.handle);
    await page.evaluate(async track => { (await import('/src/lib/player.svelte.ts')).player.play(track, [track]); }, tracks[0]);

    for (const target of [first, second, first, second]) {
      await expire(target.did);
      await you.click();
      await menu.getByRole('button', { name: 'switch account' }).click();
      await menu.getByRole('button', { name: new RegExp(target.handle.replace(/\./g, '\\.')) }).first().click();
      await menu.waitFor({ state: 'hidden' }).catch(async () => { throw new Error(`switch to ${target.handle} left the menu open: ${await menu.innerText()}`); });
      assert.equal(await current(), target.did);
      await you.click();
      assert.doesNotMatch(await menu.innerText(), /did:plc:|signed out/, 'the menu names the account and lists no one as signed out');
      await page.keyboard.press('Escape');
    }
    assert.deepEqual(errors, []);
    console.log('Two accounts signed in, four switches with a track playing and expired tokens, no sign-outs');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
