import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { app, browserAccount } from './live-browser-account.mjs';

const coordinator = 'https://jams.next.plyr.fm';
const api = 'https://api.next.plyr.fm';
const jamType = 'fm.plyr.next.jam';
const track = 'Sounds of the Drone Mix';
const artistPath = '/u/did:plc:cqqtuv75m7e5s4uj6nw4czyu';
const { ZAT_TEST_HANDLE: hostHandle, ZAT_TEST_PASSWORD: hostPassword, ZAT_TEST_PDS: hostOrigin,
  ALPHA_TEST_HANDLE: guestHandle, ALPHA_TEST_PASSWORD: guestPassword } = process.env;
assert.ok(hostHandle && guestHandle && hostHandle !== guestHandle && guestPassword, 'two dedicated accounts are required');

async function fetchJson(url, label) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  assert.ok(response.ok, `${label} returned HTTP ${response.status}`);
  return response.json();
}

const identity = await fetchJson('https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?' + new URLSearchParams({ handle: guestHandle }), 'guest handle lookup');
assert.match(identity.did, /^did:plc:[a-z2-7]{24}$/);
const document = await fetchJson('https://plc.directory/' + identity.did, 'guest DID lookup');
assert.ok(document.id === identity.did && document.alsoKnownAs.includes('at://' + guestHandle), 'guest identity does not match');
const guestOrigin = document.service.find(service => service.id.endsWith('#atproto_pds'))?.serviceEndpoint;
const host = await browserAccount(hostHandle, hostPassword, hostOrigin);
const guest = await browserAccount(guestHandle, guestPassword, guestOrigin);

async function hostRpc(method, body, token) {
  return fetch(new URL('/xrpc/com.atproto.' + method, host.pds), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

async function openClient(browser, width, permitSpaceWrite) {
  const context = await browser.newContext({
    viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block'
  });
  await context.addInitScript(() => {
    const Base = window.Audio;
    window.testAudio = [];
    window.Audio = class extends Base {
      constructor(...args) { super(...args); window.testAudio.push(this); }
    };
  });
  await context.route(`${api}/v1/tracks/*/plays*`, route => route.abort());
  await context.route(`${coordinator}/v1/playback/join`, route => route.abort());
  const page = await context.newPage();
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === coordinator && url.pathname === '/v1/jams/join') {
      console.log(`browser ${width}px ${url.pathname}: HTTP ${response.status()}`);
    }
  });
  page.setDefaultTimeout(20_000);
  await context.route('**/xrpc/**', route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'POST' && /^\/xrpc\/com\.atproto\.(repo|space|memberspace)\./.test(url.pathname)
      && !permitSpaceWrite?.(url, request.postDataJSON(), page.url())) return route.abort();
    return route.continue();
  });
  return { context, page };
}

async function playing(page) {
  const sample = await page.waitForFunction(() => {
    const audio = window.testAudio.find(item => !item.paused && !item.seeking && item.readyState >= 2);
    return audio && { url: audio.currentSrc, time: audio.currentTime };
  });
  await page.waitForFunction(start => window.testAudio.some(audio => audio.currentSrc === start.url && !audio.paused
    && !audio.seeking && audio.readyState >= 2 && audio.currentTime > start.time + 0.25), await sample.jsonValue());
}

async function openQueue(page) {
  await page.getByTestId('player-dock').getByRole('button', { name: 'Queue', exact: true }).click();
  return page.getByRole('region', { name: 'Queue', exact: true });
}

const browser = await chromium.launch();
let session, space;
let hostClient, guestClient, hostConsented = false, guestConsented = false;
let stage = 'preparing test account cleanup';
const errors = [];

try {
  const response = await hostRpc('server.createSession', { identifier: hostHandle, password: hostPassword });
  assert.ok(response.ok, `fixture cleanup authentication returned HTTP ${response.status}`);
  session = await response.json();
  assert.ok(session.did?.startsWith('did:plc:') && session.did !== identity.did && session.accessJwt && session.refreshJwt, 'invalid host session');

  hostClient = await openClient(browser, 1280, (url, body, currentPage) => {
    if (url.origin !== host.pds.origin) return false;
    if (url.pathname === '/xrpc/com.atproto.space.createSpace') {
      if (body.spaceType !== jamType || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(body.skey)) return false;
      const current = new URL(currentPage);
      if (current.origin !== app || decodeURIComponent(current.pathname) !== `/jam/${session.did}~${body.skey}`) return false;
      if (body.policy?.$type !== 'com.atproto.memberspace.policy' || ['publicRead', 'publicWrite', 'publishPolicy', 'publishMembers'].some(field => body.policy[field] !== false)) return false;
      const candidate = `at://${session.did}/space/${jamType}/${body.skey}`;
      if (space && space !== candidate) return false;
      space = candidate;
      return true;
    }
    if (!space || body.space !== space) return false;
    if (url.pathname === '/xrpc/com.atproto.space.putRecord') return body.repo === session.did && body.rkey === 'self'
      && body.collection === 'fm.plyr.next.jamState' && body.record?.$type === body.collection;
    return url.pathname === '/xrpc/com.atproto.memberspace.putMembers' && body.members?.length === 1
      && body.members[0].did === identity.did && body.members[0].read === true && body.members[0].write === false;
  });
  await hostClient.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app });
  guestClient = await openClient(browser, 390);
  const hostPage = hostClient.page, guestPage = guestClient.page;
  const step = label => { stage = label; };

  step('opening host settings');
  await hostPage.goto(app + '/settings');
  await host.signIn(hostPage, label => step('host ' + label));
  hostConsented = true;
  await hostPage.waitForURL(app + '/settings');
  await hostPage.getByRole('button', { name: 'sign out', exact: true }).waitFor();

  step('opening an existing public recording in the artist catalog');
  await hostPage.goto(app + artistPath);
  await hostPage.locator('main').getByRole('button', { name: 'Play ' + track, exact: true }).click();
  step('decoding audio in the host browser');
  await playing(hostPage);
  step('reading the host queue and artist continuation');
  const hostQueue = await openQueue(hostPage);
  const queuedTracks = hostQueue.getByRole('link');
  await queuedTracks.nth(1).waitFor();
  const [current, ...titles] = await queuedTracks.allTextContents();
  assert.equal(current, track);

  step('starting a Jam and sharing its active queue');
  await hostQueue.getByRole('button', { name: 'Start a Jam', exact: true }).click();
  await hostPage.getByText('jam is live', { exact: true }).waitFor();
  await hostPage.getByRole('button', { name: 'pause jam', exact: true }).waitFor();
  assert.ok(space && !new URL(hostPage.url()).search, 'Jam start did not reach the permanent room URL');

  step('inviting the dedicated guest and copying the link');
  await hostPage.getByLabel('guest handle').fill(guestHandle);
  await hostPage.getByRole('button', { name: 'invite guest' }).click();
  await hostPage.getByText('guest invited. send them the jam link.', { exact: true }).waitFor();
  await hostPage.getByRole('button', { name: 'copy jam link' }).click();
  await hostPage.getByText('jam link copied.', { exact: true }).waitFor();
  const room = await hostPage.evaluate(() => navigator.clipboard.readText());
  assert.equal(room, hostPage.url());

  step('opening the invite signed out');
  await guestPage.goto(room);
  await guest.signIn(guestPage, label => step('guest ' + label), 'sign in to join');
  guestConsented = true;
  step('joining automatically after the guest signs in');
  await guestPage.waitForURL(room);
  await guestPage.getByText('jam is live', { exact: true }).waitFor();
  await guestPage.getByRole('button', { name: 'pause jam', exact: true }).waitFor();
  await guestPage.getByTestId('player-dock').getByText(track, { exact: true }).waitFor();
  const unlock = guestPage.getByRole('button', { name: 'play audio on this device' });
  await Promise.race([playing(guestPage), unlock.waitFor()]);
  if (await unlock.isVisible()) await unlock.click();
  await playing(guestPage);

  step('verifying the guest queue matches the host queue');
  const guestQueue = await openQueue(guestPage);
  const guestNext = guestQueue.getByRole('region', { name: 'up next' }).getByRole('link');
  await guestNext.first().waitFor();
  assert.deepEqual(await guestNext.allTextContents(), titles);

  step('verifying that host pause reaches the guest');
  await hostPage.getByRole('button', { name: 'pause jam', exact: true }).click();
  await guestPage.getByTestId('player-dock').getByRole('button', { name: 'Play', exact: true }).waitFor();
  await guestPage.waitForFunction(() => window.testAudio.every(audio => audio.paused));
  await guestPage.goBack();
  await guestPage.getByRole('button', { name: 'leave jam', exact: true }).click();
  await guestPage.getByRole('button', { name: 'join jam', exact: true }).waitFor();
  await guestPage.getByRole('button', { name: 'join jam', exact: true }).click();
  await guestPage.getByText('jam is live', { exact: true }).waitFor();
  await guestPage.getByRole('button', { name: 'play jam', exact: true }).waitFor();
  await guestPage.getByRole('button', { name: 'leave jam', exact: true }).click();
  await hostPage.getByRole('button', { name: 'leave jam', exact: true }).click();
} catch (error) {
  if (stage === 'decoding audio in the host browser') {
    const media = await hostClient.page.evaluate(() => window.testAudio.map(audio => ({
      ready: audio.readyState, network: audio.networkState, error: audio.error?.code ?? null, paused: audio.paused, time: Math.floor(audio.currentTime)
    }))).catch(() => []);
    console.error('host media state', JSON.stringify(media));
  }
  errors.push(new Error(`live Jam failed at ${stage} (${error.name})`));
} finally {
  for (const [client, account, consented, role] of [[guestClient, guest, guestConsented, 'guest'], [hostClient, host, hostConsented, 'host']]) {
    try {
      if (consented) await account.signOut(client.page, '/settings');
    } catch (error) {
      errors.push(new Error(`${role} browser sign-out failed (${error.name})`));
    }
    try { await client?.context.close(); } catch (error) { errors.push(new Error(`${role} browser cleanup failed (${error.name})`)); }
  }
  try { await browser.close(); } catch (error) { errors.push(new Error(`browser cleanup failed (${error.name})`)); }
  try {
    if (space) {
      const removed = await hostRpc('space.deleteSpace', { space }, session.accessJwt);
      assert.ok(removed.ok || removed.status === 404, `fixture Space deletion returned HTTP ${removed.status}`);
      console.log(removed.ok ? 'deleted the exact private fixture Space' : 'fixture Space was already absent');
    }
  } catch (error) { errors.push(error); }
  try {
    if (session?.refreshJwt) {
      const ended = await hostRpc('server.deleteSession', undefined, session.refreshJwt);
      assert.ok(ended.ok, `fixture cleanup session deletion returned HTTP ${ended.status}`);
    }
  } catch (error) { errors.push(error); }
}
if (errors.length) throw new AggregateError(errors, 'live Jam verification failed');
console.log('1280px host and 390px guest passed queue handoff, copied invite, signed-out join, playback, pause, and signed-in rejoin');
