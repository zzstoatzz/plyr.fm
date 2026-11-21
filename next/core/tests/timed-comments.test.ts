import assert from 'node:assert/strict';
import test from 'node:test';
import { commentTimeline, emojiOnly, reachedComments } from '../src/timed-comments.ts';

const at = (ms: number) => ms;

test('a comment shows over the cover from its time for the show window', () => {
  const items = [30_000, 10_000, 12_000];
  assert.deepEqual(reachedComments(items, at, 9_999), []);
  assert.deepEqual(reachedComments(items, at, 10_000), [10_000]);
  assert.deepEqual(reachedComments(items, at, 13_000), [10_000, 12_000]);
  assert.deepEqual(reachedComments(items, at, 15_500), [12_000]);
  assert.deepEqual(reachedComments(items, at, 17_000), []);
  assert.deepEqual(reachedComments(items, at, 31_000), [30_000]);
});

test('only the newest few show at once', () => {
  assert.deepEqual(reachedComments([1_000, 1_100, 1_200, 1_300], at, 2_000), [1_200, 1_300]);
  assert.deepEqual(reachedComments([1_000, 1_100, 1_200], at, 2_000, 5_000, 1), [1_200]);
});

test('a comment at 0:00 shows as the track starts', () => {
  assert.deepEqual(reachedComments([0], at, 0), [0]);
});

test('the timeline marks each comment and keeps the right one in sight', () => {
  const items = [303_000, 217_000, 357_000];
  const moments = (position: number) => commentTimeline(items, at, position).rows.map(row => `${row.item}:${row.moment}`);
  assert.deepEqual(moments(358_000), ['217000:heard', '303000:heard', '357000:now']);
  assert.equal(commentTimeline(items, at, 358_000).focus, 2);
  assert.deepEqual(moments(318_000), ['217000:heard', '303000:heard', '357000:ahead']);
  assert.equal(commentTimeline(items, at, 318_000).focus, 2);
  assert.equal(commentTimeline(items, at, 0).focus, 0);
  assert.equal(commentTimeline(items, at, 400_000).focus, 2);
  assert.deepEqual(commentTimeline([], at, 1_000), { rows: [], focus: -1 });
});

test('emoji-only comments are told apart from words', () => {
  for (const text of ['🫣', '😰', ' 🔥 ', '💃🏽', '👍🏻👍🏻', '❤️', '👨‍👩‍👧', '🇺🇸']) assert.equal(emojiOnly(text), true, text);
  for (const text of ['lmao', 'so crazy 🔥', '', '123', '#1', '🔥'.repeat(13)]) assert.equal(emojiOnly(text), false, text);
});
