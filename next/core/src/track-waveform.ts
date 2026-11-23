/**
 * A track's playing bars, from the levels the appview measured from its audio
 * (`fm.plyr.unspecced.getTrackWaveform`): how loud its bass, low mids, high
 * mids and treble are over time. Clients read the levels at the play position
 * and ease toward them, rising fast and falling slower, the way a meter does.
 */

export interface TrackWaveform {
	uri: string;
	/** the record version the levels were measured from */
	cid: string;
	fps: number;
	bands: number;
	/** `bands` bytes per frame, 0 silent to 255 that band's loud passages */
	levels: Uint8Array;
}

export interface TrackWaveformBody {
	uri: string;
	cid: string;
	fps: number;
	bands: number;
	levels: string;
}

export const waveBars = 4;
/** the shortest a bar gets, so a quiet passage still shows four bars */
export const waveFloor = 0.18;

export function parseTrackWaveform(body: TrackWaveformBody): TrackWaveform | null {
	if (!Number.isInteger(body.fps) || body.fps < 1 || !Number.isInteger(body.bands) || body.bands < 1 || typeof body.levels !== 'string') return null;
	let binary: string;
	try { binary = atob(body.levels); } catch { return null; }
	if (binary.length === 0 || binary.length % body.bands !== 0) return null;
	const levels = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) levels[index] = binary.charCodeAt(index);
	return { uri: body.uri, cid: body.cid, fps: body.fps, bands: body.bands, levels };
}

/** Each bar's height from 0 to 1 at `seconds`, between the two nearest frames. */
export function levelsAt(waveform: TrackWaveform, seconds: number, out: number[] = new Array(waveBars).fill(0)): number[] {
	const frames = waveform.levels.length / waveform.bands;
	const position = Math.min(Math.max(0, seconds * waveform.fps), frames - 1);
	const first = Math.floor(position);
	const second = Math.min(frames - 1, first + 1);
	const blend = position - first;
	for (let bar = 0; bar < out.length; bar++) {
		const band = Math.min(waveform.bands - 1, bar);
		const a = waveform.levels[first * waveform.bands + band];
		const b = waveform.levels[second * waveform.bands + band];
		out[bar] = (a + (b - a) * blend) / 255;
	}
	return out;
}

const riseSeconds = 0.03;
const fallSeconds = 0.18;

/**
 * Bar heights that ease toward their targets frame by frame. `step` takes
 * the target levels and the seconds since the last step, and returns heights
 * from `waveFloor` to 1.
 */
export function createWaveEasing(bars = waveBars) {
	const heights = new Array<number>(bars).fill(waveFloor);
	return {
		heights,
		step(targets: readonly number[], elapsed: number): number[] {
			const dt = Math.min(Math.max(elapsed, 0), 0.25);
			for (let bar = 0; bar < bars; bar++) {
				const target = waveFloor + (1 - waveFloor) * (targets[bar] ?? 0);
				const time = target > heights[bar] ? riseSeconds : fallSeconds;
				heights[bar] += (target - heights[bar]) * (1 - Math.exp(-dt / time));
			}
			return heights;
		},
		reset() { heights.fill(waveFloor); }
	};
}
