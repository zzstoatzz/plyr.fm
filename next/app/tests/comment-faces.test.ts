import assert from 'node:assert/strict';
import test from 'node:test';
import { FACE, clampLeft, passingComment, pileFaces, pileWidth, trackX } from '../src/comment-faces.ts';

const at = (ms: number) => ms;

test('a face sits on the time it names, inside the slider inset', () => {
  assert.equal(trackX(0, 1000, 420, 10), 10);
  assert.equal(trackX(1000, 1000, 420, 10), 410);
  assert.equal(trackX(500, 1000, 420, 10), 210);
  assert.equal(trackX(5000, 1000, 420, 10), 410);
  assert.equal(trackX(10, 0, 420, 10), 10);
});

test('faces closer than their own width share a pile; far ones stand alone', () => {
  const piles = pileFaces([0, 10_000, 11_000, 12_000, 13_000, 60_000], at, 100_000, 410, 5);
  assert.deepEqual(piles.map(pile => pile.items), [[0], [10_000, 11_000, 12_000, 13_000], [60_000]]);
  assert.equal(piles[1].width, pileWidth(4));
});

test('piles never start past either edge', () => {
  const [first, last] = pileFaces([0, 100_000], at, 100_000, 300, 10);
  assert.equal(first.left, 1);
  assert.equal(last.left + last.width, 299);
  const crowded = pileFaces([99_000, 99_500, 99_900, 100_000], at, 100_000, 300, 10);
  assert.equal(crowded.length, 1);
  assert.equal(crowded[0].left, 300 - crowded[0].width);
  assert.ok(crowded[0].left >= 0);
});

test('a single face is as wide as one face', () => {
  assert.equal(pileWidth(1), FACE);
  assert.ok(pileWidth(4) > pileWidth(3));
});

test('playback passes the latest comment at or behind it for a few seconds', () => {
  const items = [10_000, 12_000, 30_000];
  assert.equal(passingComment(items, at, 9_000), undefined);
  assert.equal(passingComment(items, at, 10_500), 10_000);
  assert.equal(passingComment(items, at, 13_000), 12_000);
  assert.equal(passingComment(items, at, 16_500), undefined);
  assert.equal(passingComment(items, at, 30_000), 30_000);
});

test('popovers stay inside the scrubber', () => {
  assert.equal(clampLeft(5, 200, 400), 0);
  assert.equal(clampLeft(390, 200, 400), 200);
  assert.equal(clampLeft(100, 200, 400), 80);
});
