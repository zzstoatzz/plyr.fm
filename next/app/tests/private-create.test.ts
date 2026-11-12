import assert from 'node:assert/strict';
import test from 'node:test';
import { privateCreate, requirePrivatePolicy } from '../src/publishing/private-create.ts';
import { privateSpace } from '../src/publishing/private-track.ts';
import { hasPrivatePublishGrant, PRIVATE_PUBLISH_SCOPE, SCOPE_PARTS } from '../src/auth-config.ts';

const owner = 'did:plc:fixture', space = privateSpace(owner);
const policy = { $type: 'com.atproto.memberspace.policy', publicRead: false, publicWrite: false, publishPolicy: false, publishMembers: false };
test('private publishing uses the existing self space and rejects any public or unsupported policy', () => {
  requirePrivatePolicy({ space, policy }, owner);
  for (const key of ['publicRead', 'publicWrite', 'publishPolicy', 'publishMembers']) assert.throws(() => requirePrivatePolicy({ space, policy: { ...policy, [key]: true } }, owner), /not private/);
  assert.throws(() => requirePrivatePolicy({ space, policy: { ...policy, allowedApps: [] } }, owner), /restricts/);
  assert.throws(() => requirePrivatePolicy({ space, policy: { $type: 'com.atproto.managedspace.policy' } }, owner), /unsupported/);
  assert.throws(() => requirePrivatePolicy({ space: privateSpace('did:plc:other'), policy }, owner));
});
test('private recovery cannot be routed to a public repo, another owner, or a public audio source', () => {
  const rkey = '3jzfcijpj2z2a', operation = { owner, rkey, uri: `${space}/${owner}/fm.plyr.track/${rkey}`, record: { $type: 'fm.plyr.track', audioBlob: { fixture: true } } };
  assert.equal(privateCreate(operation, owner).uri, operation.uri);
  assert.throws(() => privateCreate(operation, 'did:plc:other'));
  assert.throws(() => privateCreate({ ...operation, uri: `at://${owner}/fm.plyr.track/${rkey}` }, owner));
  for (const key of ['audioUrl', 'audioSpace', 'supportGate']) assert.throws(() => privateCreate({ ...operation, record: { ...operation.record, [key]: null } }, owner));
});
test('private publication permission is explicit and scoped to the existing collection and self space', () => {
  assert.ok(SCOPE_PARTS.includes(PRIVATE_PUBLISH_SCOPE));
  assert.ok(hasPrivatePublishGrant(PRIVATE_PUBLISH_SCOPE));
  for (const part of ['&action=create', '&manage=create', '&skey=self', '&collection=fm.plyr.track']) assert.ok(!hasPrivatePublishGrant(PRIVATE_PUBLISH_SCOPE.replace(part, '')));
});
