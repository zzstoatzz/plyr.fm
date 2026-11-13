import { applyRoomCommand, initialRoom } from './room.mts';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const load = createRequire(new URL('../../app/package.json', import.meta.url));
const { P256Keypair } = load('@atproto/crypto');
const {
  createSpaceSigHeaders, encapsulate, formatMacRequest, verifyRecord, RECORD_MAC_PROFILE,
} = load('@atproto/space');

const hostPds = 'http://localhost:5297';
const guestPds = 'http://localhost:5298';
const plc = 'http://localhost:5296';
const type = 'fm.plyr.next.jam';
const commandCollection = 'fm.plyr.next.jamCommand';
const stateCollection = 'fm.plyr.next.jamState';

async function xrpc(pds, method, { body, query, token, headers } = {}) {
  const url = new URL(`/xrpc/${method}`, pds);
  url.search = new URLSearchParams(query ?? {}).toString();
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: response.ok, status: response.status, headers: response.headers, data: await response.json().catch(() => ({})) };
}

function ok(result, operation) {
  assert(result.ok, `${operation}: HTTP ${result.status} ${result.data.error ?? ''} ${result.data.message ?? ''}`);
  return result.data;
}

async function account(pds, handle) {
  const password = 'fixture-only-password';
  const created = await xrpc(pds, 'com.atproto.server.createAccount', {
    body: { handle, password, email: `${handle}@example.test` },
  });
  const session = created.ok ? created.data : ok(await xrpc(pds, 'com.atproto.server.createSession', {
    body: { identifier: handle, password },
  }), 'fixture login');
  return { pds, did: session.did, token: session.accessJwt };
}

async function credential(account, space) {
  const { token } = ok(await xrpc(account.pds, 'com.atproto.space.getDelegationToken', {
    token: account.token, query: { space },
  }), 'get delegation');
  const key = await P256Keypair.create();
  const issued = await xrpc(hostPds, 'com.atproto.space.getSpaceCredential', {
    body: { space, credentialKey: key.did(), delegationToken: token },
  });
  return { issued, key };
}

async function signed(key, issued, audience) {
  return (await createSpaceSigHeaders({
    keypair: key,
    authorization: `Atproto-Space-Credential ${issued}`, audience,
  })).headers;
}

async function readVerified(credentials, space, writer, collection, rkey) {
  const response = await fetch(`${plc}/${writer.did}`, { signal: AbortSignal.timeout(5_000) });
  assert(response.ok, 'resolve writer fixture DID');
  const doc = await response.json();
  const kem = doc.verificationMethod.find((method) => method.id.endsWith('#atproto_kem'))?.publicKeyMultibase;
  assert(kem, 'writer advertises its KEM key');
  const { keyShare, sharedSecret } = await encapsulate(`did:key:${kem}`);
  const headers = await signed(credentials.key, ok(credentials.issued, 'credential').credential, writer.did);
  const read = await xrpc(writer.pds, 'com.atproto.space.getRecord', {
    query: { space, repo: writer.did, collection, rkey },
    headers: { ...headers, 'accept-signature': formatMacRequest(RECORD_MAC_PROFILE, keyShare) },
  });
  const record = ok(read, 'read remote record');
  const uri = `${space}/${writer.did}/${collection}/${rkey}`;
  const proof = { uri, keyShare, sharedSecret, headers: read.headers };
  await verifyRecord(record, proof);
  await assert.rejects(verifyRecord({ ...record, value: { ...record.value, injected: true } }, proof));
  return record.value;
}

async function put(account, space, collection, rkey, fields, repo = account.did) {
  return xrpc(account.pds, 'com.atproto.space.putRecord', {
    token: account.token, body: { space, repo, collection, rkey, record: { $type: collection, ...fields } },
  });
}

const host = await account(hostPds, 'plyrjamhost.test');
const guest = await account(guestPds, 'plyrjamguest.test');
assert.notEqual(host.did, guest.did);
const { space } = ok(await xrpc(host.pds, 'com.atproto.space.createSpace', {
  token: host.token,
  body: {
    spaceType: type, skey: `fixture-${Date.now()}`,
    policy: { $type: 'com.atproto.memberspace.policy', publicRead: false, publicWrite: false, publishPolicy: false, publishMembers: false },
  },
}), 'create room');

try {
  assert.equal((await credential(guest, space)).issued.ok, false, 'outsider cannot mint a credential');
  ok(await xrpc(host.pds, 'com.atproto.memberspace.putMembers', {
    token: host.token, body: { space, members: [{ did: guest.did, read: true, write: true }] },
  }), 'add guest');

  const guestCredential = await credential(guest, space);
  const hostCredential = await credential(host, space);
  ok(guestCredential.issued, 'guest credential');
  ok(hostCredential.issued, 'host credential');
  const actor = { hostDid: host.did, writerDid: host.did, canWrite: (did) => did === guest.did, trackCollection: 'fm.plyr.track', nowMs: Date.now() };
  const loaded = applyRoomCommand(initialRoom(actor.nowMs), { ...actor, value: {
    action: 'replaceQueue', baseRevision: 0, index: 0,
    queue: [{ uri: `at://${host.did}/fm.plyr.track/fixture`, cid: 'bafyreigljuhgh5mrstq3xxokme2mxkuhw3nzo4yzfyvhdb6ejrzeoc76wu' }],
  } });
  assert.equal(loaded.outcome, 'applied');
  const started = applyRoomCommand(loaded.state, { ...actor, value: { action: 'play', baseRevision: loaded.state.revision } });
  assert.equal(started.outcome, 'applied');
  const state = started.state;
  ok(await put(host, space, stateCollection, 'self', state), 'host room state');
  assert.equal((await put(guest, space, stateCollection, 'self', { revision: 99 }, host.did)).ok, false, 'guest cannot impersonate host');
  ok(await put(guest, space, commandCollection, 'pause', { action: 'pause', baseRevision: state.revision }), 'guest command');

  const headers = await signed(hostCredential.key, hostCredential.issued.data.credential, host.did);
  const began = performance.now();
  let repos;
  while (performance.now() - began < 15_000) {
    repos = ok(await xrpc(host.pds, 'com.atproto.space.listWriters', { query: { space }, headers }), 'discover writers').repos;
    if (repos.some((repo) => repo.repo === guest.did)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(repos?.some((repo) => repo.repo === guest.did), 'guest PDS write reached the host writer set');
  const discoveryMs = Math.round(performance.now() - began);
  assert.deepEqual(await readVerified(guestCredential, space, host, stateCollection, 'self'), { $type: stateCollection, ...state });
  const command = await readVerified(hostCredential, space, guest, commandCollection, 'pause');
  assert.equal(command.action, 'pause');
  assert.equal(command.baseRevision, state.revision);
  const input = { ...actor, writerDid: guest.did, nowMs: actor.nowMs + 1000, value: command };
  const paused = applyRoomCommand(state, input);
  assert.equal(paused.outcome, 'applied');
  assert.equal(paused.state.revision, state.revision + 1);
  assert.equal(applyRoomCommand(paused.state, input).outcome, 'conflict');
  ok(await put(host, space, stateCollection, 'self', paused.state), 'commit room response');
  assert.equal((await readVerified(guestCredential, space, host, stateCollection, 'self')).playing, false);
  ok(await xrpc(host.pds, 'com.atproto.memberspace.removeMembers', {
    token: host.token, body: { space, dids: [guest.did] },
  }), 'remove guest');
  assert.equal((await credential(guest, space)).issued.ok, false, 'removed member cannot renew credential');
  console.log(`Cross-PDS room: writer discovered within ${discoveryMs} ms after putRecord, MACs and value CIDs verified, host state updated, outsider and removed member denied new credentials.`);
} finally {
  ok(await xrpc(host.pds, 'com.atproto.space.deleteSpace', {
    token: host.token, body: { space },
  }), 'delete fixture room');
}
