import { describe, expect, it } from 'vitest';
import {
	EMISSION_SPACE_PX,
	EMISSION_STACK_PX,
	HEADER_CLEARANCE_PX,
	emissionPlacement,
	emissionShift
} from './comment-emission';

describe('emissionPlacement', () => {
	it('hangs below the trigger when a full stack fits above the player', () => {
		expect(emissionPlacement(270, 300, 844, 110)).toBe('below');
		expect(emissionPlacement(500, 844 - 110 - EMISSION_STACK_PX, 844, 110)).toBe('below');
	});

	it('rises above the row when the band below the trigger is taken by the player', () => {
		expect(emissionPlacement(600, 700, 844, 110)).toBe('above');
		expect(emissionPlacement(HEADER_CLEARANCE_PX + EMISSION_STACK_PX, 760, 844, 110)).toBe('above');
	});

	it('docks only when neither band exists', () => {
		expect(emissionPlacement(HEADER_CLEARANCE_PX + EMISSION_STACK_PX - 1, 760, 844, 110)).toBe('docked');
		expect(emissionPlacement(-40, -10, 844, 110)).toBe('docked');
	});

	it('takes the room one bubble needs when asked for one', () => {
		expect(emissionPlacement(640, 670, 844, 110, EMISSION_SPACE_PX)).toBe('below');
		expect(emissionPlacement(640, 670, 844, 110)).toBe('above');
	});

	it('treats no player as full-height room below', () => {
		expect(emissionPlacement(600, 620, 844, 0)).toBe('below');
	});
});

describe('emissionShift', () => {
	it('leaves a bubble that fits where it is', () => {
		expect(emissionShift(195, 200, 390)).toBe(0);
	});

	it('pushes a bubble in from the right edge', () => {
		expect(emissionShift(300, 280, 390)).toBe(390 - 16 - 440);
	});

	it('pushes a bubble in from the left edge', () => {
		expect(emissionShift(80, 280, 390)).toBe(16 + 60);
	});
});
