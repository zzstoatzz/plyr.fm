import { describe, expect, it } from 'vitest';
import {
	EMISSION_BUBBLE_PX,
	EMISSION_GAP_PX,
	EMISSION_INNER_GAP_PX,
	EMISSION_SIDE_GAP_PX,
	EMISSION_SIDE_MIN_PX,
	EMISSION_STACK_MAX,
	emissionCapacity,
	emissionLayout,
	emissionShift,
	emissionStackHeight
} from './comment-emission';

describe('emissionCapacity', () => {
	it('counts whole bubbles that fit: the row gap first, the inner gap between', () => {
		const one = EMISSION_GAP_PX + EMISSION_BUBBLE_PX;
		const each = EMISSION_BUBBLE_PX + EMISSION_INNER_GAP_PX;
		expect(emissionCapacity(0)).toBe(0);
		expect(emissionCapacity(one - 1)).toBe(0);
		expect(emissionCapacity(one)).toBe(1);
		expect(emissionCapacity(47)).toBe(1);
		expect(emissionCapacity(one + each - 1)).toBe(1);
		expect(emissionCapacity(one + each)).toBe(2);
		expect(emissionCapacity(1000)).toBe(EMISSION_STACK_MAX);
	});
});

const bands = (b: Partial<{ above: number; below: number; right: number; left: number }>) => ({
	above: 0,
	below: 0,
	right: 0,
	left: 0,
	...b
});

describe('emissionLayout', () => {
	it('takes the vertical band with more room, below on a tie', () => {
		expect(emissionLayout(bands({ above: 300, below: 300 }))).toEqual({ placement: 'below', capacity: 3 });
		expect(emissionLayout(bands({ above: 300, below: 53 }))).toEqual({ placement: 'above', capacity: 3 });
		expect(emissionLayout(bands({ above: 10, below: 53 }))).toEqual({ placement: 'below', capacity: 1 });
	});

	it('goes beside the trigger when the vertical bands are full, on the roomier side', () => {
		expect(emissionLayout(bands({ above: 16, below: 20, right: 350, left: 60 }))).toEqual({
			placement: 'beside-right',
			capacity: 1,
			maxWidth: 350 - EMISSION_SIDE_GAP_PX
		});
		expect(emissionLayout(bands({ above: 16, below: 20, right: 40, left: 240 }))).toEqual({
			placement: 'beside-left',
			capacity: 1,
			maxWidth: 240 - EMISSION_SIDE_GAP_PX
		});
	});

	it('prefers a vertical band over a side, and needs a usable width beside', () => {
		expect(emissionLayout(bands({ above: 16, below: 53, right: 400 }))).toEqual({ placement: 'below', capacity: 1 });
		expect(emissionLayout(bands({ right: EMISSION_SIDE_MIN_PX + EMISSION_SIDE_GAP_PX - 1 }))).toEqual({
			placement: 'docked',
			capacity: 1
		});
	});

	it('docks one bubble when nothing fits anywhere', () => {
		expect(emissionLayout(bands({ above: 10, below: 41, right: 100, left: 100 }))).toEqual({ placement: 'docked', capacity: 1 });
	});
});

describe('emissionShift', () => {
	it('leaves a stack that fits where it is', () => {
		expect(emissionShift(95, 295, 390)).toBe(0);
	});

	it('pushes a stack in from the right edge', () => {
		expect(emissionShift(160, 440, 390)).toBe(390 - 16 - 440);
	});

	it('pushes a stack in from the left edge', () => {
		expect(emissionShift(-60, 220, 390)).toBe(16 + 60);
	});

	it('moves left of something fixed over its right end', () => {
		expect(emissionShift(180, 380, 390, [{ left: 330, right: 380 }])).toBe(330 - 16 - 380);
	});

	it('moves right of something fixed over its left end', () => {
		expect(emissionShift(20, 220, 390, [{ left: 0, right: 60 }])).toBe(60 + 16 - 20);
	});

	it('keeps the viewport edge when an obstacle would push it out', () => {
		expect(emissionShift(10, 290, 390, [{ left: 250, right: 300 }])).toBe(6);
	});
});

describe('emissionStackHeight', () => {
	it('is the bubbles plus the gaps between them', () => {
		expect(emissionStackHeight(1)).toBe(36);
		expect(emissionStackHeight(3)).toBe(36 * 3 + 4 * 2);
	});
});
