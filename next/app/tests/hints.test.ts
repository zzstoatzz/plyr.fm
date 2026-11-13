import assert from 'node:assert/strict';
import test from 'node:test';
import { nextHint, parseSeen, seenKey } from '../src/behaviors/hints.ts';

const specs = [{ id: 'player' }, { id: 'more-below' }, { id: 'queue-drag', after: ['player'] }] as const;

test('shows the first unseen hint whose target is ready, in registry order', () => {
  assert.equal(nextHint(specs, new Set(), new Set(['more-below', 'player'])), 'player');
  assert.equal(nextHint(specs, new Set(['player']), new Set(['more-below', 'player'])), 'more-below');
  assert.equal(nextHint(specs, new Set(), new Set()), undefined);
});

test('a hint waits for the ones it comes after', () => {
  assert.equal(nextHint(specs, new Set(), new Set(['queue-drag'])), undefined);
  assert.equal(nextHint(specs, new Set(['player']), new Set(['queue-drag'])), 'queue-drag');
});

test('the hint on screen stays until it is seen or its target goes away', () => {
  const ready = new Set(['player', 'more-below']);
  assert.equal(nextHint(specs, new Set(), ready, 'more-below'), 'more-below');
  assert.equal(nextHint(specs, new Set(['more-below']), ready, 'more-below'), 'player');
  assert.equal(nextHint(specs, new Set(), new Set(['player']), 'more-below'), 'player');
});

test('seen state is per account and survives bad storage', () => {
  assert.notEqual(seenKey('did:plc:a'), seenKey('did:plc:b'));
  assert.equal(seenKey(null), 'hints:seen:signed-out');
  assert.deepEqual([...parseSeen('["a","b",3]')], ['a', 'b']);
  assert.equal(parseSeen('{oops').size, 0);
  assert.equal(parseSeen(null).size, 0);
});
