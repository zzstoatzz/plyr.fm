import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waysIn } from '../src/access/ways-in.ts';

const offer = { provider: 'link' as const, subject: 'at://did:plc:a/fm.plyr.list/1', url: 'https://dawn.bandcamp.com/album/tide', amount: 800, currency: 'USD' };

test('a closed track lists every way in, buy first', () => {
  const { ways, note } = waysIn({ artist: 'dawn', rules: [{ rule: { kind: 'members', members: ['did:plc:x'] } }], offer, support: 'https://ko-fi.com/dawn', signedIn: true });
  assert.deepEqual(ways.map(way => way.kind), ['buy', 'support', 'members']);
  assert.equal(ways[1].detail, 'on ko-fi');
  assert.match(note ?? '', /doesn't unlock/);
});

test('signed-out listeners get a sign-in action; verified rules drop the link caveat', () => {
  const { ways, note } = waysIn({ artist: 'dawn', rules: [{ rule: { kind: 'signedIn' } }, { rule: { kind: 'purchase', amount: 500, currency: 'USD' } }], offer, signedIn: false });
  assert.equal(ways.find(way => way.kind === 'sign-in')?.action, 'sign in');
  assert.equal(note, undefined);
  assert.equal(waysIn({ artist: 'dawn', rules: [], signedIn: true }).ways.length, 0);
});
