// Publishes a fresh public track to live Next as the dedicated test account and proves it is
// playable the moment it is published: the audio reaches the streaming origin before the record
// is written, the first playback lookup after awaitRecord is `available`, and a browser plays it
// on the first try. The track is deleted afterwards, whatever happened.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { app, browserAccount } from './live-browser-account.mjs';

const api = 'https://api.next.plyr.fm';
const audioOrigin = 'https://plyr-next-audio.n8-3e9.workers.dev';
const collection = 'fm.plyr.track';
const { ZAT_TEST_HANDLE: handle, ZAT_TEST_PASSWORD: password, ZAT_TEST_PDS: origin } = process.env;
// AAC with its moov after mdat, the shape of an iPhone voice memo
const audio = readFileSync(new URL('./fixtures/voice-memo-shape.m4a', import.meta.url));
const title = `live publish check ${new Date().toISOString()}`;

const request = (url, init) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) });
async function json(url, init) {
  const response = await request(url, init);
  assert.ok(response.ok, `${new URL(url).pathname} returned HTTP ${response.status}`);
  return response.json();
}

const account = await browserAccount(handle, password, origin);
const xrpc = method => new URL('/xrpc/com.atproto.' + method, account.pds).href;
const post = (value, token) => ({ method: 'POST', body: JSON.stringify(value),
  headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) } });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const errors = [];
let session, page, consented = false, created, stage = 'signing in to the test account';
const events = { stored: undefined, storedStatus: undefined, written: undefined };

try {
  session = await json(xrpc('server.createSession'), post({ identifier: handle, password }));
  assert.ok(session.did?.startsWith('did:plc:') && session.accessJwt, 'invalid fixture account');
  const context = await browser.newContext({ viewport: { width: 390, height: 850 }, hasTouch: true, serviceWorkers: 'block' });
  await context.route('https://jams.next.plyr.fm/v1/playback/join', route => route.abort());
  page = await context.newPage();
  page.setDefaultTimeout(20_000);
  // leaving /upload asks before discarding a draft; the check always leaves deliberately
  page.on('dialog', dialog => dialog.accept());
  page.on('request', req => {
    const url = new URL(req.url());
    if (req.method() === 'PUT' && url.origin === audioOrigin && url.pathname.startsWith('/audio/')) events.stored ??= Date.now();
    if (req.method() === 'POST' && url.href === xrpc('repo.createRecord') && req.postDataJSON()?.collection === collection) events.written ??= Date.now();
  });
  page.on('response', async response => {
    const url = new URL(response.url());
    if (response.request().method() === 'PUT' && url.origin === audioOrigin && url.pathname.startsWith('/audio/')) events.storedStatus = response.status();
    if (url.href === xrpc('repo.createRecord') && response.ok() && response.request().postDataJSON()?.collection === collection) created = await response.json();
  });

  await page.goto(app + '/upload');
  await page.locator('main').getByRole('link', { name: 'sign in', exact: true }).click();
  await account.signIn(page, label => { stage = label; });
  consented = true;
  await page.waitForURL(app + '/upload');

  stage = 'publishing the track';
  await page.locator('input[type=file][accept^="audio"]').setInputFiles({ name: 'voice memo.m4a', mimeType: 'audio/x-m4a', buffer: audio });
  await page.getByRole('textbox', { name: 'title', exact: true }).fill(title);
  await page.getByRole('button', { name: 'upload', exact: true }).click();
  await page.getByText(`"${title}" uploaded`).waitFor({ timeout: 90_000 });
  assert.ok(created?.uri?.startsWith(`at://${session.did}/${collection}/`) && created.cid, 'the record was not created');

  stage = 'checking the audio reached the streaming origin first';
  assert.ok(events.stored && events.written && events.stored < events.written, 'the audio must be stored before the record is written');
  assert.ok([200, 201].includes(events.storedStatus), `the streaming origin answered ${events.storedStatus}`);

  stage = 'checking the first playback lookup';
  const status = (await json(api + '/xrpc/fm.plyr.unspecced.awaitRecord?' + new URLSearchParams({ uri: created.uri, cid: created.cid, timeoutMs: '8000' }))).status;
  assert.equal(status, 'indexed', 'the record was not projected');
  const playback = await json(api + '/xrpc/fm.plyr.unspecced.getPlayback?' + new URLSearchParams({ uri: created.uri }));
  assert.equal(playback.availability.status, 'available', 'the first lookup after publishing must be playable');
  assert.ok(playback.availability.delivery?.url.startsWith(audioOrigin + '/audio/'), 'expected the streaming origin');

  stage = 'playing it in the browser';
  const id = 'trk_' + Buffer.from(created.uri).toString('base64url');
  await page.goto(app + '/track/' + id);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // the player's audio element is never attached to the document; its Pause state is the signal
  await page.getByRole('button', { name: 'Pause', exact: true }).waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  console.log(`published "${title}": audio stored ${events.written - events.stored} ms before the record, first lookup available, played on the first try`);
} catch (error) { errors.push(new Error(`live publish failed at ${stage}: ${error.message}`)); }
finally {
  try { if (consented) { await page.setViewportSize({ width: 1280, height: 900 }); await account.signOut(page, '/settings'); } }
  catch (error) { errors.push(new Error(`browser sign-out failed (${error.name})`)); }
  try { await browser.close(); }
  catch (error) { errors.push(new Error(`browser cleanup failed (${error.name})`)); }
  try {
    if (created) {
      const rkey = created.uri.split('/').pop();
      await json(xrpc('repo.deleteRecord'), post({ repo: session.did, collection, rkey, swapRecord: created.cid }, session.accessJwt));
      console.log('deleted the test track');
    }
  } catch (error) { errors.push(new Error(`deleting the test track failed (${error.message})`)); }
}
if (errors.length) throw new AggregateError(errors, errors.map(error => error.message).join('; '));
