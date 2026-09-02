import { describe, expect, it } from 'vitest';
import { EMISSION_SPACE_PX, emissionPlacement } from './comment-emission';

describe('emissionPlacement', () => {
	it('hangs below the trigger when the bubble fits above the player', () => {
		expect(emissionPlacement(300, 844, 110)).toBe('anchored');
		expect(emissionPlacement(844 - 110 - EMISSION_SPACE_PX, 844, 110)).toBe('anchored');
	});

	it('docks above the player when the trigger sits just above it', () => {
		expect(emissionPlacement(844 - 110 - EMISSION_SPACE_PX + 1, 844, 110)).toBe('docked');
		expect(emissionPlacement(700, 844, 110)).toBe('docked');
	});

	it('docks when the trigger has scrolled off the top', () => {
		expect(emissionPlacement(-20, 844, 110)).toBe('docked');
	});

	it('treats no player as full-height room', () => {
		expect(emissionPlacement(780, 844, 0)).toBe('anchored');
	});
});
