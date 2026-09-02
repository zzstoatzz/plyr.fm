import { describe, expect, it } from 'vitest';
import {
	EMISSION_BUBBLE_PX,
	EMISSION_GAP_PX,
	EMISSION_INNER_GAP_PX,
	EMISSION_STACK_MAX,
	emissionCapacity,
	emissionLayout,
	emissionShift
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

describe('emissionLayout', () => {
	it('takes the band with more room, below on a tie', () => {
		expect(emissionLayout({ above: 300, below: 300 })).toEqual({ placement: 'below', capacity: 3 });
		expect(emissionLayout({ above: 300, below: 53 })).toEqual({ placement: 'above', capacity: 3 });
		expect(emissionLayout({ above: 10, below: 53 })).toEqual({ placement: 'below', capacity: 1 });
	});

	it('docks one bubble when neither band holds one', () => {
		expect(emissionLayout({ above: 10, below: 41 })).toEqual({ placement: 'docked', capacity: 1 });
		expect(emissionLayout({ above: -40, below: -10 })).toEqual({ placement: 'docked', capacity: 1 });
	});
});

describe('emissionShift', () => {
	it('leaves a stack that fits where it is', () => {
		expect(emissionShift(195, 200, 390)).toBe(0);
	});

	it('pushes a stack in from the right edge', () => {
		expect(emissionShift(300, 280, 390)).toBe(390 - 16 - 440);
	});

	it('pushes a stack in from the left edge', () => {
		expect(emissionShift(80, 280, 390)).toBe(16 + 60);
	});
});
