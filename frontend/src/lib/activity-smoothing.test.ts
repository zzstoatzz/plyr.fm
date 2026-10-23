import { expect, it } from 'vitest';
import { monotonePath, rollingMean } from './activity-smoothing';

it('averages a centered window that shrinks at the edges', () => {
	expect(rollingMean([0, 3, 0, 3, 0], 3)).toEqual([1.5, 1, 2, 1, 1.5]);
});

it('leaves the partial bucket out of every average', () => {
	expect(rollingMean([2, 2, 2, 50], 3, 3)).toEqual([2, 2, 2, null]);
});

it('returns raw counts for a window of one', () => {
	expect(rollingMean([4, 0, 7], 1, 2)).toEqual([4, 0, null]);
});

it('handles a range shorter than the window and an all-zero series', () => {
	expect(rollingMean([1, 2], 12)).toEqual([1.5, 1.5]);
	expect(rollingMean([0, 0, 0], 3)).toEqual([0, 0, 0]);
});

it('never draws the curve past the baseline around a single spike', () => {
	const points = [0, 0, 100, 0, 0].map((value, i) => ({ x: i * 250, y: 180 - value }));
	const path = monotonePath(points);
	const ys = [...path.matchAll(/-?\d+(?:\.\d+)?,(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
	expect(Math.max(...ys)).toBeLessThanOrEqual(180);
	expect(Math.min(...ys)).toBeGreaterThanOrEqual(80);
});

it('draws a single point as a move and nothing for no points', () => {
	expect(monotonePath([{ x: 500, y: 90 }])).toBe('M500,90');
	expect(monotonePath([])).toBe('');
});
