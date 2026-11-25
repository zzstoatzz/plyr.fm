import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromSpaceWire, fromSpaceWireDeep, spaceXrpcBody, spaceXrpcPath, toSpaceWire } from '../src/space-address.ts';

const stored = 'at://did:plc:artist/space/fm.plyr.next.audio/3n2x4sel33c2a';
const wire = 'at:space/did:plc:artist/fm.plyr.next.audio/3n2x4sel33c2a';

test('a space and a record in it go to the PDS in its form and come back in ours', () => {
  assert.equal(toSpaceWire(stored), wire);
  assert.equal(toSpaceWire(`${stored}/did:plc:artist/fm.plyr.track/3n2x4sel33c2a`), `${wire}/did:plc:artist/fm.plyr.track/3n2x4sel33c2a`);
  assert.equal(fromSpaceWire(wire), stored);
  assert.equal(fromSpaceWire(`${wire}/did:plc:artist/fm.plyr.track/k`), `${stored}/did:plc:artist/fm.plyr.track/k`);
});

test('either form converts, and nothing else changes', () => {
  assert.equal(toSpaceWire(wire), wire);
  assert.equal(fromSpaceWire(stored), stored);
  for (const other of ['at://did:plc:artist/fm.plyr.track/k', 'https://example.com/space/x', 'at://alice.test/space/a.b.c/k', '']) {
    assert.equal(toSpaceWire(other), other);
    assert.equal(fromSpaceWire(other), other);
  }
});

test('requests carry the PDS form and answers come back in ours', () => {
  assert.equal(spaceXrpcPath('com.atproto.space.getSpace', { space: stored }), `/xrpc/com.atproto.space.getSpace?space=${encodeURIComponent(wire)}`);
  assert.equal(spaceXrpcPath('com.atproto.space.getSpace'), '/xrpc/com.atproto.space.getSpace');
  assert.deepEqual(spaceXrpcBody({ space: stored, repo: 'did:plc:artist' }), { space: wire, repo: 'did:plc:artist' });
  assert.deepEqual(fromSpaceWireDeep({ space: wire, records: [{ uri: `${wire}/did:plc:a/c.d.e/k`, value: { n: 1 } }] }),
    { space: stored, records: [{ uri: `${stored}/did:plc:a/c.d.e/k`, value: { n: 1 } }] });
});
