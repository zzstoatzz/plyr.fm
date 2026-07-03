// findNextPlayableIndex is the shared forward-scan behind every "current track
// can't play, skip ahead" path (gated denial, still-processing, load/media
// failure). the load-failure path is what stops auto-advance from dead-airing
// on a 404 / dead R2 url / corrupt media — regression cover for that.
import { describe, it, expect, vi } from 'vitest';

// control the "still on an undecodable interim rendition" predicate directly.
const isOptimizingMock = vi.hoisted(() => vi.fn((_t: Track) => false));
const canPlayFormatMock = vi.hoisted(() => vi.fn((_f?: string) => true));
vi.mock('$lib/utils/track-audio', () => ({ isOptimizing: isOptimizingMock }));
vi.mock('$lib/audio-support', () => ({
	canPlayFormat: canPlayFormatMock,
	hasPlayableLossless: () => true
}));

import { findNextPlayableIndex } from './audio-source';
import type { Track } from './types';

function track(id: number, extra: Partial<Track> = {}): Track {
	return { id, file_id: `f${id}`, file_type: 'mp3', gated: false, ...extra } as Track;
}

describe('findNextPlayableIndex', () => {
	it('returns the next non-gated track after the current one', () => {
		const tracks = [track(1), track(2), track(3)];
		expect(findNextPlayableIndex(tracks, 0)).toBe(1);
	});

	it('skips consecutive gated tracks to the first playable one', () => {
		const tracks = [track(1), track(2, { gated: true }), track(3, { gated: true }), track(4)];
		expect(findNextPlayableIndex(tracks, 0)).toBe(3);
	});

	it('returns -1 when only gated tracks remain (so the player pauses)', () => {
		const tracks = [track(1), track(2, { gated: true }), track(3, { gated: true })];
		expect(findNextPlayableIndex(tracks, 0)).toBe(-1);
	});

	it('returns -1 at the end of the queue', () => {
		expect(findNextPlayableIndex([track(1), track(2)], 1)).toBe(-1);
	});

	it('skips tracks still awaiting a playable rendition by default', () => {
		// track 2 is optimizing and this browser cannot play its interim format.
		isOptimizingMock.mockImplementation((t: Track) => t.id === 2);
		canPlayFormatMock.mockReturnValue(false);
		const tracks = [track(1), track(2), track(3)];
		expect(findNextPlayableIndex(tracks, 0)).toBe(2);
	});

	it('does not skip awaiting tracks when skipAwaiting is off (gated-denial scan)', () => {
		isOptimizingMock.mockImplementation((t: Track) => t.id === 2);
		canPlayFormatMock.mockReturnValue(false);
		const tracks = [track(1), track(2), track(3)];
		expect(findNextPlayableIndex(tracks, 0, { skipAwaiting: false })).toBe(1);
	});
});
