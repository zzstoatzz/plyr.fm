import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track } from '../src/api.ts';
import { AUDIO_SPACE_TYPE, NSID } from '../src/auth-config.ts';
import { describePolicy, implicitRule, isOpen, parsePolicy, parsePrice, policyRecord, trackSpace } from '../src/access/policy.ts';

const artist = 'did:plc:artist';
const space = `at://${artist}/space/${AUDIO_SPACE_TYPE}/3album`;
const item = (rule: object, overrides: Record<string, unknown> = {}) => ({
  uri: `at://${artist}/${NSID.policy}/3p`, cid: 'bafy',
  value: { $type: NSID.policy, space, rule, createdAt: '2026-11-13T00:00:00Z', ...overrides },
});
const track = (access: Track['access']): Track => ({ object: 'track', id: 't', record: { uri: `at://${artist}/${NSID.track}/t`, cid: 'c', revision: null, collection: NSID.track, rkey: 't' },
  metadata: { title: 't', artist_name: 'a', description: null, album: null, duration_seconds: 1, created_at: '2026-11-13T00:00:00Z' },
  artist: { did: artist, profile: { handle: 'a.test', display_name: 'a', avatar_url: null } }, media: {}, access, metrics: { play_count: 0, like_count: 0 } });

test('policies parse the four rules and round-trip what the app writes', () => {
  for (const rule of [{ kind: 'signedIn' }, { kind: 'members', members: ['did:plc:friend'] }, { kind: 'supporter' }, { kind: 'purchase', amount: 500, currency: 'USD' }] as const) {
    const written = policyRecord([space], rule);
    assert.deepEqual(parsePolicy({ uri: `at://${artist}/${NSID.policy}/3p`, cid: 'bafy', value: written }, artist)?.rule, rule);
  }
  assert.equal(parsePolicy(item({ $type: `${NSID.policy}#purchase`, amount: 500, currency: 'USD' }, { title: ' buy the album ' }), artist)?.title, 'buy the album');
});

test('one policy can open several spaces and name the release it sells', () => {
  const single = `at://${artist}/space/${AUDIO_SPACE_TYPE}/3single`;
  const subject = { uri: `at://${artist}/${NSID.release}/3album`, cid: 'bafyrelease' };
  const written = policyRecord([space, single], { kind: 'purchase', amount: 800, currency: 'USD' }, 'buy the album', subject);
  assert.equal('space' in written, false, 'new records write spaces only');
  const parsed = parsePolicy({ uri: `at://${artist}/${NSID.policy}/3p`, cid: 'bafy', value: written }, artist);
  assert.deepEqual(parsed?.spaces, [space, single]);
  assert.deepEqual(parsed?.subject, subject);
  assert.deepEqual(parsePolicy(item({ $type: `${NSID.policy}#signedIn` }), artist)?.spaces, [space], 'older single-space records still read');
  const signedIn = { $type: `${NSID.policy}#signedIn` };
  assert.equal(parsePolicy(item(signedIn, { spaces: [space] }), artist), undefined, 'space and spaces together');
  assert.equal(parsePolicy(item(signedIn, { space: undefined, spaces: [] }), artist), undefined, 'empty spaces');
  assert.equal(parsePolicy(item(signedIn, { space: undefined, spaces: [space, `at://did:plc:other/space/${AUDIO_SPACE_TYPE}/x`] }), artist), undefined, "one space is another artist's");
});

test('policies that would open the wrong thing open nothing', () => {
  const signedIn = { $type: `${NSID.policy}#signedIn` };
  assert.equal(parsePolicy(item(signedIn), 'did:plc:other'), undefined, 'record from another repo');
  assert.equal(parsePolicy(item(signedIn, { space: `at://did:plc:other/space/${AUDIO_SPACE_TYPE}/3album` }), artist), undefined, "another artist's space");
  assert.equal(parsePolicy(item(signedIn, { space: `at://${artist}/space/com.example.space/3album` }), artist), undefined, 'foreign space type');
  assert.equal(parsePolicy(item({ $type: `${NSID.policy}#future` }), artist), undefined, 'unknown rule');
  assert.equal(parsePolicy(item({ $type: `${NSID.policy}#purchase`, amount: 0, currency: 'USD' }), artist), undefined, 'free purchase');
  assert.equal(parsePolicy(item({ $type: `${NSID.policy}#supporter`, brokers: [] }), artist), undefined, 'empty brokers');
  assert.equal(parsePolicy(item({ $type: `${NSID.policy}#members`, members: ['bob'] }), artist), undefined, 'non-DID member');
});

test('tracks are open, closed in a space, or legacy-gated', () => {
  assert.ok(isOpen(track({ visibility: 'public' })));
  assert.equal(isOpen(track({ visibility: 'public', space_uri: space })), false);
  assert.equal(trackSpace(track({ visibility: 'public', space_uri: space })), space);
  assert.equal(trackSpace(track({ visibility: 'public', space_uri: `at://did:plc:other/space/${AUDIO_SPACE_TYPE}/x` })), undefined);
  assert.deepEqual(implicitRule(`at://${artist}/space/${AUDIO_SPACE_TYPE}/supporters`), { kind: 'supporter' });
  assert.deepEqual(implicitRule(`at://${artist}/space/${AUDIO_SPACE_TYPE}/signed-in`), { kind: 'signedIn' });
  assert.equal(implicitRule(space), undefined);
});

test('prices are entered in major units and stored in minor units', () => {
  assert.equal(parsePrice('5', 'USD'), 500);
  assert.equal(parsePrice('4.99', 'USD'), 499);
  assert.equal(parsePrice('4,5', 'USD'), 450);
  assert.equal(parsePrice('500', 'JPY'), 500);
  for (const bad of ['', '0', '1.999', 'five', '-1']) assert.equal(parsePrice(bad, 'USD'), undefined, bad);
  assert.match(describePolicy({ rule: { kind: 'purchase', amount: 499, currency: 'USD' } }), /4\.99/);
  assert.equal(describePolicy({ rule: { kind: 'members', members: ['did:plc:a', 'did:plc:b'] } }), '2 listed people');
});
