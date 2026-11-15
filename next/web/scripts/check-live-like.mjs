import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { app, browserAccount } from './live-browser-account.mjs';

const api = 'https://api.next.plyr.fm';
const production = 'https://api.plyr.fm';
const uri = 'at://did:plc:siv7zbedip4vcet4v67piibr/fm.plyr.track/3mrttu6zg4k22';
const id = 'trk_' + Buffer.from(uri).toString('base64url');
const path = '/track/' + id;
const collection = 'fm.plyr.like';
const { ZAT_TEST_HANDLE: handle, ZAT_TEST_PASSWORD: password, ZAT_TEST_PDS: origin } = process.env;

const request = (url, init) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) });
async function json(url, init) {
  const response = await request(url, init);
  assert.ok(response.ok, `${new URL(url).pathname} returned HTTP ${response.status}`);
  return response.json();
}

async function checkProduction() {
  const response = await request(production + '/tracks/by-uri?' + new URLSearchParams({ uri }));
  assert.equal(response.status, 404, 'the fixture must be absent from the legacy catalog');
  assert.equal((await response.json()).detail, 'track not found');
}

await checkProduction();
const track = await json(api + '/v1/tracks/' + id);
assert.ok(track.legacy_id == null && track.access.visibility === 'public' && track.record.uri === uri && track.record.cid,
  'expected the preflighted Next-only track');
const account = await browserAccount(handle, password, origin);
const xrpc = method => new URL('/xrpc/com.atproto.' + method, account.pds).href;
const post = (value, token) => ({ method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
  ...(value ? { body: JSON.stringify(value) } : {})
});
const browser = await chromium.launch();
let session, context, page, consented = false, wrote = false, accepted;
let stage = 'reading the test account baseline';
const errors = [];

async function exactLikes() {
  let cursor;
  const matches = [];
  for (let count = 0; count < 10; count++) {
    const query = new URLSearchParams({ repo: session.did, collection, limit: '100', ...(cursor ? { cursor } : {}) });
    const data = await json(xrpc('repo.listRecords') + '?' + query);
    matches.push(...data.records.filter(row => row.value?.subject?.uri === uri));
    cursor = data.cursor;
    if (!cursor) return matches;
  }
  throw new Error('could not verify the dedicated account before writing a like');
}

async function indexed(record, deleting = false) {
  const query = new URLSearchParams({ uri: record.uri, timeout_ms: '8000', ...(deleting ? {} : { cid: record.cid }) });
  return (await json(api + '/v1/records/await?' + query)).status;
}

try {
  session = await json(xrpc('server.createSession'), post({ identifier: handle, password }));
  assert.ok(session.did?.startsWith('did:plc:') && session.did !== track.artist.did && session.accessJwt && session.refreshJwt, 'invalid fixture account');
  assert.deepEqual(await exactLikes(), [], 'the fixture must start without this reaction');
  const own = await json(xrpc('repo.listRecords') + '?' + new URLSearchParams({ repo: session.did, collection: 'fm.plyr.track', limit: '1' }));
  if (own.records.length === 0 && !own.cursor) console.log('the dedicated account has no track records to edit on live Next');
  context = await browser.newContext({ viewport: { width: 390, height: 850 }, hasTouch: true, serviceWorkers: 'block' });
  await context.route('https://jams.next.plyr.fm/v1/playback/join', route => route.abort());
  await context.route('**/xrpc/**', route => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() !== 'POST' || !/^\/xrpc\/com\.atproto\.(repo|space|memberspace)\./.test(url.pathname)) return route.continue();
    if (url.origin !== account.pds.origin) return route.abort();
    const body = req.postDataJSON();
    if (body?.repo !== session.did || body.collection !== collection) return route.abort();
    if (url.href === xrpc('repo.createRecord') && !accepted && body.record?.$type === collection
      && body.record.subject?.uri === uri && body.record.subject.cid === track.record.cid) {
      wrote = true;
      return route.continue();
    }
    if (url.href === xrpc('repo.deleteRecord') && accepted && body.swapRecord === accepted.cid
      && `at://${session.did}/${collection}/${body.rkey}` === accepted.uri) return route.continue();
    return route.abort();
  });

  page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(app + path);
  await account.signIn(page, label => { stage = label; }, 'Sign in to like');
  consented = true;
  await page.waitForURL(app + path);
  stage = 'liking the track at 390px';
  await checkProduction();
  await page.getByRole('button', { name: 'Like track', exact: true }).click();
  await page.getByRole('button', { name: 'Unlike track', exact: true, pressed: true }).waitFor();
  const matches = await exactLikes();
  assert.equal(matches.length, 1, 'the PDS must contain one exact reaction');
  accepted = matches[0];
  assert.equal(accepted.value.subject.cid, track.record.cid);
  assert.equal(await indexed(accepted), 'indexed');

  stage = 'unliking the same track at 1280px after reload';
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await page.getByRole('button', { name: 'Unlike track', exact: true, pressed: true }).click();
  await page.getByRole('button', { name: 'Like track', exact: true, pressed: false }).waitFor();
  assert.deepEqual(await exactLikes(), []);
  assert.ok(['deleted', 'absent'].includes(await indexed(accepted, true)), 'reaction is still projected');
  await checkProduction();
  console.log('390px Like and 1280px Unlike passed, including browser reload, PDS record, and Next projection cleanup');
} catch (error) { errors.push(new Error(`live reaction failed at ${stage} (${error.name})`)); }
finally {
  try { if (consented) await account.signOut(page, '/settings'); }
  catch (error) { errors.push(new Error(`reaction browser sign-out failed (${error.name})`)); }
  try { await browser.close(); }
  catch (error) { errors.push(new Error(`reaction browser cleanup failed (${error.name})`)); }
  try {
    if (wrote && errors.length) {
      const prefix = `at://${session.did}/${collection}/`;
      const remaining = await exactLikes();
      const cleanupRecords = new Map((accepted ? [accepted, ...remaining] : remaining).map(record => [record.uri, record]));
      for (const record of remaining) {
        assert.ok(record.uri.startsWith(prefix) && record.value.subject.cid === track.record.cid);
        const rkey = record.uri.slice(prefix.length);
        assert.match(rkey, /^[a-z0-9]{13}$/);
        await json(xrpc('repo.deleteRecord'), post({ repo: session.did, collection, rkey, swapRecord: record.cid }, session.accessJwt));
      }
      assert.deepEqual(await exactLikes(), []);
      for (const record of cleanupRecords.values()) {
        assert.ok(['deleted', 'absent'].includes(await indexed(record, true)), 'reaction is still projected after cleanup');
      }
    }
  } catch (error) { errors.push(new Error(`exact reaction cleanup failed (${error.name})`)); }
  try {
    if (session?.refreshJwt) assert.ok((await request(xrpc('server.deleteSession'), post(undefined, session.refreshJwt))).ok,
      'cleanup session revocation failed');
  } catch (error) { errors.push(new Error(`cleanup session revocation failed (${error.name})`)); }
}
if (errors.length) throw new AggregateError(errors, 'live reaction check failed');
