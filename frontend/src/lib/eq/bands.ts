/** the equalizer's shape with no audio graph attached: bands, presets, and the chain's response. */

export type BandKind = 'lowshelf' | 'peaking' | 'highshelf';

export interface Band {
	frequency: number;
	kind: BandKind;
	/** short axis label, e.g. "1k" */
	label: string;
}

export const BAND_Q = 1.41;
export const GAIN_LIMIT_DB = 12;
export const DEFAULT_SAMPLE_RATE = 48000;

export const BANDS: readonly Band[] = [
	{ frequency: 32, kind: 'lowshelf', label: '32' },
	{ frequency: 64, kind: 'peaking', label: '64' },
	{ frequency: 125, kind: 'peaking', label: '125' },
	{ frequency: 250, kind: 'peaking', label: '250' },
	{ frequency: 500, kind: 'peaking', label: '500' },
	{ frequency: 1000, kind: 'peaking', label: '1k' },
	{ frequency: 2000, kind: 'peaking', label: '2k' },
	{ frequency: 4000, kind: 'peaking', label: '4k' },
	{ frequency: 8000, kind: 'peaking', label: '8k' },
	{ frequency: 16000, kind: 'highshelf', label: '16k' }
];

export interface Preset {
	id: string;
	name: string;
	gains: readonly number[];
}

export const PRESETS: readonly Preset[] = [
	{ id: 'flat', name: 'flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
	{ id: 'bass', name: 'bass', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
	{ id: 'treble', name: 'treble', gains: [0, 0, 0, 0, 0, 0, 1, 3, 5, 6] },
	{ id: 'vocal', name: 'vocal', gains: [-2, -2, -1, 0, 2, 3, 3, 2, 0, -1] },
	{ id: 'smile', name: 'smile', gains: [5, 4, 2, 0, -1, -1, 0, 2, 4, 5] },
	{ id: 'late-night', name: 'late night', gains: [-3, -2, -1, 0, 0, 0, 0, -1, -2, -3] }
];

export const FLAT_GAINS: readonly number[] = PRESETS[0].gains;

export function clampGain(db: number): number {
	if (!Number.isFinite(db)) return 0;
	return Math.max(-GAIN_LIMIT_DB, Math.min(GAIN_LIMIT_DB, Math.round(db * 2) / 2));
}

/** the preset whose gains match exactly, if any. */
export function matchPreset(gains: readonly number[]): Preset | null {
	return PRESETS.find((p) => p.gains.every((g, i) => g === gains[i])) ?? null;
}

export function isFlat(gains: readonly number[]): boolean {
	return gains.every((g) => g === 0);
}

interface Biquad {
	b0: number;
	b1: number;
	b2: number;
	a0: number;
	a1: number;
	a2: number;
}

/** RBJ cookbook coefficients, matching what BiquadFilterNode computes (shelf slope 1). */
function coefficients(band: Band, gainDb: number, sampleRate: number): Biquad {
	const A = Math.pow(10, gainDb / 40);
	const w0 = (2 * Math.PI * band.frequency) / sampleRate;
	const cos = Math.cos(w0);
	const sin = Math.sin(w0);

	if (band.kind === 'peaking') {
		const alpha = sin / (2 * BAND_Q);
		return {
			b0: 1 + alpha * A,
			b1: -2 * cos,
			b2: 1 - alpha * A,
			a0: 1 + alpha / A,
			a1: -2 * cos,
			a2: 1 - alpha / A
		};
	}

	const shelf = 2 * Math.sqrt(A) * (sin / 2) * Math.SQRT2;
	if (band.kind === 'lowshelf') {
		return {
			b0: A * (A + 1 - (A - 1) * cos + shelf),
			b1: 2 * A * (A - 1 - (A + 1) * cos),
			b2: A * (A + 1 - (A - 1) * cos - shelf),
			a0: A + 1 + (A - 1) * cos + shelf,
			a1: -2 * (A - 1 + (A + 1) * cos),
			a2: A + 1 + (A - 1) * cos - shelf
		};
	}
	return {
		b0: A * (A + 1 + (A - 1) * cos + shelf),
		b1: -2 * A * (A - 1 + (A + 1) * cos),
		b2: A * (A + 1 + (A - 1) * cos - shelf),
		a0: A + 1 - (A - 1) * cos + shelf,
		a1: 2 * (A - 1 - (A + 1) * cos),
		a2: A + 1 - (A - 1) * cos - shelf
	};
}

function magnitudeDb(c: Biquad, frequency: number, sampleRate: number): number {
	const w = (2 * Math.PI * frequency) / sampleRate;
	const cos1 = Math.cos(w);
	const sin1 = Math.sin(w);
	const cos2 = Math.cos(2 * w);
	const sin2 = Math.sin(2 * w);
	const numRe = c.b0 + c.b1 * cos1 + c.b2 * cos2;
	const numIm = -(c.b1 * sin1 + c.b2 * sin2);
	const denRe = c.a0 + c.a1 * cos1 + c.a2 * cos2;
	const denIm = -(c.a1 * sin1 + c.a2 * sin2);
	const ratio = Math.hypot(numRe, numIm) / Math.hypot(denRe, denIm);
	return 20 * Math.log10(ratio);
}

/** combined response of every band, in dB, at each requested frequency. */
export function responseDb(
	gains: readonly number[],
	frequencies: readonly number[],
	sampleRate: number = DEFAULT_SAMPLE_RATE
): number[] {
	const filters = BANDS.map((band, i) => coefficients(band, gains[i] ?? 0, sampleRate));
	return frequencies.map((f) => filters.reduce((sum, c) => sum + magnitudeDb(c, f, sampleRate), 0));
}

/** log-spaced frequencies across the audible band, for drawing and peak-finding. */
export function logFrequencies(count: number, min = 20, max = 20000): number[] {
	const lo = Math.log10(min);
	const hi = Math.log10(max);
	return Array.from({ length: count }, (_, i) => Math.pow(10, lo + ((hi - lo) * i) / (count - 1)));
}

const PEAK_GRID = logFrequencies(256);

/** attenuation (dB, ≤ 0) that keeps the loudest boost from clipping full-scale audio. */
export function headroomDb(
	gains: readonly number[],
	sampleRate: number = DEFAULT_SAMPLE_RATE
): number {
	if (gains.every((g) => g <= 0)) return 0;
	const peak = Math.max(...responseDb(gains, PEAK_GRID, sampleRate));
	return peak > 0 ? -peak : 0;
}
