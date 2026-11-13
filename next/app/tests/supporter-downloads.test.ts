import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeSupporterDownload, downloadDecision, DownloadGrantRequired } from '../src/downloads/supporter.ts';
import { DOWNLOAD_SCOPE, DOWNLOAD_AUTHORIZE_METHOD, JAM_SERVICE_AUDIENCE, JAM_COORDINATOR_URL, SCOPE_PARTS, SYNC_SCOPE_PARTS, SYNC_SCOPE, UPLOAD_SCOPE, hasDownloadGrant } from '../src/auth-config.ts';
import { protectedDownloadPolicy } from '../src/downloads/protected-policy.ts';

const record = { uri: 'at://did:plc:artist/fm.plyr.track/song', cid: 'current-cid' };
const viewer = 'did:plc:viewer' as const;
const reply = () => ({ viewer, recordUri: record.uri, recordCid: record.cid, downloadPolicy: 'supporters', expiresAt: Date.now() + 29_000 });

test('supporter download checks require their own advertised RPC grant', () => {
  assert.ok(hasDownloadGrant(DOWNLOAD_SCOPE)); assert.ok(SCOPE_PARTS.includes(DOWNLOAD_SCOPE)); assert.ok(SYNC_SCOPE_PARTS.includes(DOWNLOAD_SCOPE));
  for (const scope of [SYNC_SCOPE, UPLOAD_SCOPE, DOWNLOAD_SCOPE.replace(JAM_SERVICE_AUDIENCE, 'did:web:other.test'), DOWNLOAD_SCOPE + '&aud=did:web:other.test', 'atproto']) assert.equal(hasDownloadGrant(scope), false);
});

test('download decisions bind viewer, public revision, policy and admission lifetime', () => {
  assert.ok(downloadDecision(reply(), viewer, record));
  for (const value of [null, {}, { ...reply(), viewer: 'did:plc:other' }, { ...reply(), recordUri: record.uri + 'other' }, { ...reply(), recordCid: 'stale' }, { ...reply(), downloadPolicy: 'open' }, { ...reply(), expiresAt: Date.now() - 1 }, { ...reply(), expiresAt: Date.now() + 60_000 }, { ...reply(), expiresAt: 1.5 }]) assert.throws(() => downloadDecision(value, viewer, record));
});

test('authorization sends only the PDS token and exact record, then expires before new bytes', async context => {
  let calls = 0, current = true;
  const guard = () => { if (!current) throw new Error('session changed'); };
  const auth = { did: viewer, supporterDownloads: true, agent: { async handle(path: string) {
    const url = new URL(path, 'https://pds.test'); assert.equal(url.pathname, '/xrpc/com.atproto.server.getServiceAuth'); assert.equal(url.searchParams.get('aud'), JAM_SERVICE_AUDIENCE); assert.equal(url.searchParams.get('lxm'), DOWNLOAD_AUTHORIZE_METHOD);
    return Response.json({ token: 'fixture-service-jwt' });
  } } };
  const fetcher: typeof fetch = async (url, init) => { calls++; assert.equal(url, JAM_COORDINATOR_URL + '/v1/downloads/authorize'); assert.deepEqual(JSON.parse(String(init?.body)), { serviceToken: 'fixture-service-jwt', recordUri: record.uri, recordCid: record.cid }); return Response.json(reply()); };
  await assert.rejects(authorizeSupporterDownload({ ...auth, supporterDownloads: false }, record, guard, new AbortController().signal, fetcher), DownloadGrantRequired); assert.equal(calls, 0);
  const admission = await authorizeSupporterDownload(auth, record, guard, new AbortController().signal, fetcher); admission.begin();
  const now = Date.now(); context.mock.method(Date, 'now', () => now + 31_000); assert.throws(admission.begin, /expired/); admission.guard();
  current = false; assert.throws(admission.guard, /session/);
});

test('403 stays ambiguous and malformed or stale-session authorization cannot proceed', async () => {
  let current = true;
  const auth = { did: viewer, supporterDownloads: true, agent: { async handle() { return Response.json({ token: 'fixture' }); } } };
  const guard = () => { if (!current) throw new Error('session changed'); };
  await assert.rejects(authorizeSupporterDownload(auth, record, guard, new AbortController().signal, async () => Response.json({}, { status: 403 })), /^Error: could not authorize this download\.$/);
  await assert.rejects(authorizeSupporterDownload(auth, record, guard, new AbortController().signal, async () => Response.json({ ...reply(), viewer: 'wrong' })), /verify/);
  await assert.rejects(authorizeSupporterDownload(auth, record, guard, new AbortController().signal, async () => { current = false; return Response.json(reply()); }), /session/);
});

test('a busy coordinator is retried briefly with the same token before giving up', async () => {
  const auth = { did: viewer, supporterDownloads: true, agent: { async handle() { return Response.json({ token: 'fixture' }); } } };
  const guard = () => {};
  let calls = 0;
  const busyThenOk: typeof fetch = async (_url, init) => { calls++; assert.equal(JSON.parse(String(init?.body)).serviceToken, 'fixture'); return calls < 3 ? Response.json({}, { status: 503 }) : Response.json(reply()); };
  (await authorizeSupporterDownload(auth, record, guard, new AbortController().signal, busyThenOk)).begin();
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(authorizeSupporterDownload(auth, record, guard, new AbortController().signal, async () => { calls++; return Response.json({}, { status: 503 }); }), /unavailable/);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(authorizeSupporterDownload(auth, record, guard, new AbortController().signal, async () => { calls++; return Response.json({}, { status: 403 }); }), /could not authorize/);
  assert.equal(calls, 1);
});

test('supporter proof only admits known protected gates and never overrides off or private', () => {
  assert.equal(protectedDownloadPolicy({ downloadPolicy: 'supporters', supportGate: { type: 'any' } }, true), 'supporters');
  assert.equal(protectedDownloadPolicy({ downloadPolicy: 'ask' }, true), 'ask');
  for (const value of [{ downloadPolicy: 'off' }, {}, { downloadPolicy: 'supporters', visibility: 'private' }, { downloadPolicy: 'supporters', supportGate: { type: 'owner' } }, { downloadPolicy: 'supporters', supportGate: { type: 'future' } }]) assert.throws(() => protectedDownloadPolicy(value, true));
  assert.throws(() => protectedDownloadPolicy({ downloadPolicy: 'supporters' }, false));
});
