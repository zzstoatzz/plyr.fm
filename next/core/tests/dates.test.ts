import assert from 'node:assert/strict';
import test from 'node:test';
import { shortDate } from '../src/dates.ts';

const now = new Date(2026, 10, 22, 12).getTime();

test('a date this year has no year', () => {
  assert.equal(shortDate(new Date(2026, 1, 3, 9).toISOString(), now), 'feb 3');
});

test('a date from another year says which year', () => {
  assert.equal(shortDate(new Date(2025, 11, 5, 9).toISOString(), now), 'dec 5, 2025');
  assert.equal(shortDate(new Date(2025, 11, 5, 9).getTime(), now), 'dec 5, 2025');
});

test('an unreadable date is empty', () => {
  assert.equal(shortDate('not a date', now), '');
});
