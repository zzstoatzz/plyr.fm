import { describe, expect, it } from 'vitest';
import { SKIP_STEP_MAX, skipStepSeconds } from './skip-step';

describe('skipStepSeconds', () => {
	it('steps down with track length', () => {
		expect(skipStepSeconds(12)).toBe(5);
		expect(skipStepSeconds(59.9)).toBe(5);
		expect(skipStepSeconds(60)).toBe(10);
		expect(skipStepSeconds(179)).toBe(10);
		expect(skipStepSeconds(180)).toBe(15);
		expect(skipStepSeconds(3600)).toBe(15);
	});

	it('uses the largest step before the duration is known', () => {
		expect(skipStepSeconds(0)).toBe(SKIP_STEP_MAX);
		expect(skipStepSeconds(Number.NaN)).toBe(SKIP_STEP_MAX);
		expect(skipStepSeconds(Number.POSITIVE_INFINITY)).toBe(SKIP_STEP_MAX);
	});
});
