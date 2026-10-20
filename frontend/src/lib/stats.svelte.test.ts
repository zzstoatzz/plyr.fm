import { describe, expect, it } from 'vitest';
import { formatDuration } from './stats.svelte';

describe('platform audio duration', () => {
	it.each([
		[0, '0m'],
		[45 * 60, '45m'],
		[3600, '1h'],
		[24 * 3600 - 1, '23h 59m'],
		[24 * 3600, '1 day'],
		[50 * 3600, '2 days 2 h'],
		[168 * 3600 - 1, '6 days 23 h'],
		[168 * 3600, '1 week'],
		[186 * 3600, '1 week 18 h'],
		[386 * 3600, '2 weeks 2 days 2 h']
	])('formats %s seconds as %s', (seconds, expected) => {
		expect(formatDuration(seconds)).toBe(expected);
	});
});
