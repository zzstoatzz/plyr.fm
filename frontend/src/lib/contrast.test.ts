// getContrastColor picks readable text for a solid fill of a user-chosen accent.
// locks the WCAG crossover so a future refactor can't silently return unreadable
// text (the reason ConfirmDialog's buttons failed the a11y gate).
import { describe, it, expect } from 'vitest';
import { getContrastColor } from '$lib/preferences.svelte';

const DARK = '#0a0a0a';
const WHITE = '#ffffff';

describe('getContrastColor', () => {
	it('uses dark text on the default (light-ish) accent', () => {
		expect(getContrastColor('#6a9fff')).toBe(DARK);
	});

	it('uses white text on dark accents', () => {
		expect(getContrastColor('#0a3d91')).toBe(WHITE); // deep blue
		expect(getContrastColor('#4a148c')).toBe(WHITE); // deep purple
	});

	it('uses dark text on light/bright accents', () => {
		expect(getContrastColor('#ffd54f')).toBe(DARK); // amber
		expect(getContrastColor('#4ade80')).toBe(DARK); // green
	});

	it('handles the extremes', () => {
		expect(getContrastColor('#ffffff')).toBe(DARK);
		expect(getContrastColor('#000000')).toBe(WHITE);
	});
});
