import assert from 'node:assert/strict';
import test from 'node:test';
import { audioDelivery, rawCidDigest } from '../src/publishing/audio-delivery.ts';

const cid = 'bafkreifbec5sqkptigb5akdpouwbpw3loe44blnlsquk3spgt6ezeefyuq';
const config = { UPLOAD_AUTHORIZE_METHOD: 'fm.plyr.upload.authorize', UPLOAD_COORDINATOR_URL: 'https://jams.example', UPLOAD_SERVICE_AUDIENCE: 'did:web:jams.example#jams' };
const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const uploadId = '12345678-1234-4123-8123-123456789abc';
const agent = { async handle() { return Response.json({ token: 'service-token' }); } };

function fixture(storeStatus = 201) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/v1/uploads/authorize')) return Response.json({ uploadUrl: `https://audio.example/v1/uploads/${'a'.repeat(64)}/${uploadId}`, capability: 'signed.capability', expiresAt: Date.now() + 300000 });
    return new Response(null, { status: storeStatus });
  }) as typeof fetch;
  return { calls, fetcher };
}

test('a raw sha2-256 CID names its digest and other CIDs name none', () => {
  assert.equal(rawCidDigest(cid), 'a120bb2829f34183d0286f752c17db6b7139c0adab9428adc9e69f899210b8a4');
  assert.equal(rawCidDigest('bafyreicxgkfwf6x2f5e5orkroebfs2sqvocrmuz6nqp3osb2matlgrodc4'), undefined);
  assert.equal(rawCidDigest('not-a-cid'), undefined);
});

test('the audio is admitted for its record, then stored under its CID with the capability', async () => {
  const { calls, fetcher } = fixture();
  const deliver = audioDelivery(config, () => ({ did: owner, agent, uploadStorage: true }), () => uploadId, fetcher);
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal(await deliver({ uri: `at://${owner}/fm.plyr.track/3t`, name: 'memo.m4a', type: 'audio/x-m4a', bytes, cid }), true);
  const admission = JSON.parse(String(calls[0].init?.body));
  assert.deepEqual({ ...admission, serviceToken: undefined }, { serviceToken: undefined, uploadId, recordUri: `at://${owner}/fm.plyr.track/3t`, sizeBytes: 3, contentType: 'audio/mp4', fileType: 'm4a', visibility: 'public', downloadPolicy: 'open' });
  const put = calls[1];
  assert.equal(put.url, `https://plyr-next-audio.n8-3e9.workers.dev/audio/${cid}`);
  assert.equal(put.init?.method, 'PUT');
  assert.deepEqual(put.init?.headers, { authorization: 'Bearer signed.capability', 'content-type': 'audio/mp4', 'x-content-sha256': rawCidDigest(cid) });
});

test('without upload permission, a foreign record or a refused write, publishing goes on without the copy', async () => {
  const bytes = new Uint8Array([1]);
  const input = { uri: `at://${owner}/fm.plyr.track/3t`, name: 'memo.m4a', type: 'audio/mp4', bytes, cid };
  assert.equal(await audioDelivery(config, () => ({ did: owner, agent, uploadStorage: false }), () => uploadId, fixture().fetcher)(input), false);
  assert.equal(await audioDelivery(config, () => ({ did: owner, agent, uploadStorage: true }), () => uploadId, fixture().fetcher)({ ...input, uri: 'at://did:plc:other/fm.plyr.track/3t' }), false);
  assert.equal(await audioDelivery(config, () => ({ did: owner, agent, uploadStorage: true }), () => uploadId, fixture(403).fetcher)(input), false);
});
