import assert from 'node:assert/strict';
import test from 'node:test';
import { P256Keypair } from '@atproto/crypto';
import { cidForCbor, cidForRawBytes } from '@atproto/lex-data';
import { encode } from '@atproto/lex-cbor';
import { lexStringify } from '@atproto/lex-json';
import { computeRecordMac, createSpaceToken, decapsulate, formatMacHeader, parseWantMacHeader, RECORD_MAC_TYPE, WANT_MAC_HEADER } from '@atproto/space';
import { openGatedAudio, resolveGatedAudio } from '../src/gated-audio-shared.ts';
import type { Auth, Did } from '../src/auth-state.ts';

async function fixture(context: test.TestContext, failure?: 'mac' | 'value') {
  const did: Did = `did:plc:${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
  const space = `at://${did}/space/fm.plyr.privateMedia/self`;
  const uri = `${space}/${did}/fm.plyr.track/song`;
  const kem = await P256Keypair.create();
  const signer = await P256Keypair.create();
  const blob = await cidForRawBytes(new Uint8Array([1, 2, 3, 4]));
  const value = { $type: 'fm.plyr.track', audioBlob: { $type: 'blob', ref: blob, mimeType: 'audio/wav', size: 4 } };
  const cid = await cidForCbor(encode(value));
  let mints = 0, blobReads = 0;
  const auth: Auth = { did, ready: true, handle: null, rpc: null, jamSpace: true, accountSync: true, error: null, scopeRejected: false,
    agent: { async handle() { return Response.json({ token: 'fixture-delegation' }); } } };
  context.mock.method(globalThis, 'fetch', async () => Response.json({ verificationMethod: [{ id: `${did}#atproto_kem`, publicKeyMultibase: kem.did().slice('did:key:'.length) }], service: [{ id: `${did}#atproto_pds`, serviceEndpoint: 'https://audio-pds.fixture.test' }] }));
  const transport = {
    keypair: () => P256Keypair.create(),
    async fetch(url: string, init: RequestInit) {
      if (url.includes('getSpaceCredential')) {
        mints++;
        const input: { credentialKey: string } = JSON.parse(String(init.body));
        return Response.json({ credential: await createSpaceToken('credential', { iss: did, sub: space, keyId: input.credentialKey, expiresInSec: 60 }, signer) });
      }
      if (url.includes('getRecord')) {
        const headers = new Headers(init.headers);
        const share = parseWantMacHeader(headers.get(WANT_MAC_HEADER) ?? undefined, RECORD_MAC_TYPE);
        const mac = failure === 'mac' ? new Uint8Array(32) : computeRecordMac(decapsulate(kem, share), uri, cid);
        const returned = failure === 'value' ? { ...value, audioBlob: { ...value.audioBlob, size: 3 } } : value;
        return new Response(lexStringify({ uri, cid: cid.toString(), value: returned }), { headers: { 'atproto-space-mac': formatMacHeader(RECORD_MAC_TYPE, mac) } });
      }
      if (url.includes('getBlob')) { blobReads++; return new Response(new Uint8Array([1, 2, 3, 4])); }
      throw new Error('Unexpected transport request');
    }
  };
  return { auth, uri, transport, mints: () => mints, blobReads: () => blobReads };
}

test('resolving protected audio verifies the record and does not download the body', async context => {
  const f = await fixture(context);
  const source = await resolveGatedAudio(f.uri, f.auth, f.transport);
  assert.equal(source.size, 4);
  assert.equal(source.mimeType, 'audio/wav');
  assert.match(source.url, /\/xrpc\/com.atproto.space.getBlob\?/);
  assert.equal(f.blobReads(), 0);
  const first = await source.headers();
  assert.ok(first.authorization || first.Authorization);
  assert.equal(f.mints(), 1);
  const now = Date.now();
  context.mock.method(Date, 'now', () => now + 35_000);
  const renewed = await source.headers();
  assert.equal(f.mints(), 2);
  assert.notEqual(renewed.authorization ?? renewed.Authorization, first.authorization ?? first.Authorization);
});

for (const failure of ['mac', 'value'] as const) test(`protected playback rejects a mismatched ${failure} before reading audio`, async context => {
  const f = await fixture(context, failure);
  await assert.rejects(openGatedAudio(f.uri, f.auth, f.transport), /verify/);
  assert.equal(f.blobReads(), 0);
});
