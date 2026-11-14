import assert from 'node:assert/strict';
import test from 'node:test';
import { SCOPE_PARTS, hasJamGrant } from '../src/auth-config.ts';

// A space scope without a collection makes the PDS expand it from the space
// type's published lexicon; zds rejects the token exchange when that lookup fails.
test('every requested space scope names its collections', () => {
  for (const part of SCOPE_PARTS.filter(value => value.startsWith('space:'))) {
    assert.ok(new URLSearchParams(part.split('?')[1]).getAll('collection').length > 0, part);
  }
});

test('the requested scope still carries the jam grant', () => {
  assert.equal(hasJamGrant(SCOPE_PARTS.join(' ')), true);
});
