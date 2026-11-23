import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessPlan, accessSummary, draftFrom, type AccessDraft } from '../src/access/edit.ts';
import type { Policy, Rule } from '../src/access/policy.ts';

const space = 'at://did:plc:a/space/fm.plyr.audio/t1';
let n = 0;
const policy = (rule: Rule, extra: Partial<Policy> = {}): Policy => ({ uri: `at://did:plc:a/fm.plyr.policy/${++n}`, cid: 'c', rkey: String(n), spaces: [space], rule, ...extra });
const none: AccessDraft = { everyone: false, members: [], supporter: false, signedIn: false };

test('a draft reads members across policies and leaves shared ones fixed', () => {
  const album = policy({ kind: 'purchase', amount: 800, currency: 'USD' }, { spaces: [space, 'at://did:plc:a/space/fm.plyr.audio/t2'] });
  const { draft, fixed } = draftFrom(false, [policy({ kind: 'members', members: ['did:plc:x'] }), policy({ kind: 'members', members: ['did:plc:y', 'did:plc:x'] }), policy({ kind: 'supporter' }), album]);
  assert.deepEqual(draft.members, ['did:plc:x', 'did:plc:y']);
  assert.equal(draft.supporter, true);
  assert.equal(draft.purchase, undefined);
  assert.deepEqual(fixed, [album]);
});

test('a legacy space counts its fallback rule only while it has no policies', () => {
  assert.equal(draftFrom(false, [], { kind: 'signedIn' }).draft.signedIn, true);
  assert.equal(draftFrom(false, [policy({ kind: 'supporter' })], { kind: 'signedIn' }).draft.signedIn, false);
});

test('saving keeps matching policies, merges people into one, and never touches fixed ones', () => {
  const a = policy({ kind: 'members', members: ['did:plc:x'] });
  const b = policy({ kind: 'members', members: ['did:plc:y'] });
  const s = policy({ kind: 'supporter' });
  const titled = policy({ kind: 'signedIn' }, { title: 'the club' });
  const plan = accessPlan([a, b, s, titled], { ...none, members: ['did:plc:x', 'did:plc:y'], supporter: true });
  assert.deepEqual(plan.add, [{ kind: 'members', members: ['did:plc:x', 'did:plc:y'] }]);
  assert.deepEqual(plan.remove, [a, b]);
  assert.deepEqual(accessPlan([s], { ...none, supporter: true }), { add: [], remove: [] });
  const price = accessPlan([policy({ kind: 'purchase', amount: 500, currency: 'USD' })], { ...none, purchase: { amount: 700, currency: 'USD' } });
  assert.deepEqual(price.add, [{ kind: 'purchase', amount: 700, currency: 'USD' }]);
  assert.equal(price.remove.length, 1);
});

test('the summary names people, then the other ways in', () => {
  const name = (did: string) => did.slice(8);
  assert.equal(accessSummary({ ...none, everyone: true }, [], name), 'anyone with the link can listen.');
  assert.equal(accessSummary(none, [], name), 'only you can listen.');
  assert.match(accessSummary({ ...none, members: ['did:plc:ann', 'did:plc:bo'], supporter: true }, [], name), /^ann, bo and your supporters can listen\./);
  assert.match(accessSummary({ ...none, members: ['did:plc:a1', 'did:plc:a2', 'did:plc:a3', 'did:plc:a4', 'did:plc:a5'] }, [], name), /a3 and 2 other people can listen/);
});
