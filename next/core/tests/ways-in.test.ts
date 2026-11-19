import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waysIn } from '../src/access/ways-in.ts';

const offer = { provider: 'link' as const, subject: 'at://did:plc:a/fm.plyr.list/1', url: 'https://dawn.bandcamp.com/album/tide', amount: 800, currency: 'USD' };

test('a closed track lists every way in, buy first', () => {
  const { ways, note, admitted } = waysIn({ artist: 'dawn', rules: [{ rule: { kind: 'members', members: ['did:plc:x'] } }], offer, support: 'https://ko-fi.com/dawn', viewer: 'did:plc:y' });
  assert.equal(admitted, false);
  assert.deepEqual(ways.map(way => way.kind), ['buy', 'support', 'members']);
  assert.equal(ways[1].detail, 'on ko-fi');
  assert.match(note ?? '', /doesn't unlock/);
});

test('a link buy keeps its caveat even beside a verified purchase rule', () => {
  const { ways, note } = waysIn({ artist: 'dawn', rules: [{ rule: { kind: 'signedIn' } }, { rule: { kind: 'purchase', amount: 500, currency: 'USD' } }], offer });
  assert.equal(ways.find(way => way.kind === 'sign-in')?.action, 'sign in');
  assert.match(note ?? '', /doesn't unlock/);
  assert.equal(waysIn({ artist: 'dawn', rules: [], viewer: 'did:plc:y' }).ways.length, 0);
});

test('listeners the rules already let in see no panel', () => {
  assert.equal(waysIn({ artist: 'dawn', rules: [{ rule: { kind: 'signedIn' } }], offer, viewer: 'did:plc:y' }).admitted, true);
  assert.equal(waysIn({ artist: 'dawn', rules: [{ rule: { kind: 'members', members: ['did:plc:y'] } }], viewer: 'did:plc:y' }).admitted, true);
  assert.equal(waysIn({ artist: 'dawn', rules: [{ rule: { kind: 'supporter' } }], viewer: 'did:plc:y' }).admitted, false);
});
