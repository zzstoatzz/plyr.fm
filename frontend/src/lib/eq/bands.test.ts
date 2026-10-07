import { describe, expect, it } from 'vitest';
import {
	BANDS,
	FLAT_GAINS,
	PRESETS,
	clampGain,
	headroomDb,
	matchPreset,
	responseDb
} from './bands';

describe('responseDb', () => {
	it('is flat when every band is at 0 dB', () => {
		const db = responseDb(FLAT_GAINS, [20, 100, 1000, 10000, 20000]);
		for (const v of db) expect(Math.abs(v)).toBeLessThan(1e-9);
	});

	it('peaks at the boosted band with its full gain', () => {
		const gains = BANDS.map((b) => (b.frequency === 1000 ? 6 : 0));
		const [atCenter, farAway] = responseDb(gains, [1000, 20]);
		expect(atCenter).toBeCloseTo(6, 1);
		expect(Math.abs(farAway)).toBeLessThan(0.1);
	});

	it('shelves the lows: deep bass gets the full boost, the mids are left alone', () => {
		const gains = BANDS.map((b) => (b.kind === 'lowshelf' ? 9 : 0));
		const [sub, mid] = responseDb(gains, [10, 2000]);
		expect(sub).toBeCloseTo(9, 0);
		expect(Math.abs(mid)).toBeLessThan(0.1);
	});

	it('shelves the highs: air gets the full boost, the lows are left alone', () => {
		const gains = BANDS.map((b) => (b.kind === 'highshelf' ? -9 : 0));
		const [low, air] = responseDb(gains, [100, 23000]);
		expect(Math.abs(low)).toBeLessThan(0.1);
		expect(air).toBeCloseTo(-9, 0);
	});
});

describe('headroomDb', () => {
	it('needs no headroom for cuts', () => {
		expect(headroomDb(PRESETS.find((p) => p.id === 'late-night')!.gains)).toBe(0);
		expect(headroomDb(FLAT_GAINS)).toBe(0);
	});

	it('attenuates by the loudest point of the combined curve', () => {
		const gains = BANDS.map(() => 0);
		gains[5] = 6;
		gains[6] = 6;
		const headroom = headroomDb(gains);
		// adjacent boosts overlap, so the summed peak is louder than either band
		expect(headroom).toBeLessThan(-6);
		expect(headroom).toBeGreaterThan(-12);
	});
});

describe('presets', () => {
	it('have one gain per band, within limits', () => {
		for (const preset of PRESETS) {
			expect(preset.gains).toHaveLength(BANDS.length);
			for (const g of preset.gains) expect(clampGain(g)).toBe(g);
		}
	});

	it('are recognized from their gains', () => {
		expect(matchPreset([6, 5, 4, 2, 0, 0, 0, 0, 0, 0])?.id).toBe('bass');
		expect(matchPreset([6, 5, 4, 2, 0, 0, 0, 0, 0, 1])).toBeNull();
	});
});

describe('clampGain', () => {
	it('clamps to the range and snaps to half-dB steps', () => {
		expect(clampGain(40)).toBe(12);
		expect(clampGain(-40)).toBe(-12);
		expect(clampGain(3.3)).toBe(3.5);
		expect(clampGain(Number.NaN)).toBe(0);
	});
});
