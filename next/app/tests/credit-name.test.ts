import assert from 'node:assert/strict';
import test from 'node:test';
import { creditName } from '@plyr/next-core/publishing/credit-name';

test('a profile name made only of blank characters is no name, so the handle is used', () => {
  assert.equal(creditName('⠀⠀⠀'), undefined);
  assert.equal(creditName('ㅤ'), undefined);
  assert.equal(creditName('​ ‍﻿'), undefined);
  assert.equal(creditName('   '), undefined);
  assert.equal(creditName(null), undefined);
});

test('a readable name keeps its letters and emoji, with blank runs collapsed', () => {
  assert.equal(creditName('  nate⠀⠀⠀zzstoatzz '), 'nate zzstoatzz');
  assert.equal(creditName('👨‍👩‍👧 band'), '👨‍👩‍👧 band');
  assert.equal(creditName('ᴡᴀᴏᴡ'), 'ᴡᴀᴏᴡ');
});
