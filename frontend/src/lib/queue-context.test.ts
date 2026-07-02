// collection continuity: tapping a track inside an ordered collection plays it
// and queues the rest of the collection as a labeled "next from: <label>" tail,
// preserving the user's explicit up-next across the context switch (Spotify
// semantics). See queue.playContext.
import { describe, it, expect, beforeEach } from 'vitest';
import { queue } from '$lib/queue.svelte';
import { player } from '$lib/player.svelte';
import type { Track } from '$lib/types';

function track(id: number): Track {
	return {
		id,
		title: `track ${id}`,
		artist: 'artist',
		artist_handle: 'artist.test',
		file_id: `f${id}`,
		file_type: 'mp3',
		play_count: 0
	};
}

const album = (ids: number[]) => ids.map(track);

beforeEach(() => {
	queue.clear();
	player.radio = null;
});

describe('queue.playContext', () => {
	it('plays the tapped track and queues the collection remainder as a labeled tail', () => {
		queue.playContext(album([1, 2, 3, 4, 5]), 2, 'road mix');

		expect(queue.currentTrack?.id).toBe(3);
		expect(queue.tracks.map((t) => t.id)).toEqual([3, 4, 5]);
		// the remainder (4, 5) is the continuation tail
		expect(queue.continuationFromIndex).toBe(1);
		expect(queue.continuationLabel).toBe('road mix');
		expect(queue.isContinuationIndex(1)).toBe(true);
		expect(queue.isContinuationIndex(2)).toBe(true);
		expect(queue.isContinuationIndex(0)).toBe(false);
	});

	it('preserves the explicit up-next across the context switch', () => {
		// seed an explicit queue: current a, up-next b, c
		queue.setQueue(album([10, 11, 12]), 0);
		expect(queue.continuationFromIndex).toBe(3); // no tail yet

		// tap track 21 inside a different collection
		queue.playContext(album([20, 21, 22, 23]), 1, 'album x');

		// tapped track, THEN the surviving explicit up-next, THEN the collection tail
		expect(queue.tracks.map((t) => t.id)).toEqual([21, 11, 12, 22, 23]);
		expect(queue.currentIndex).toBe(0);
		// boundary sits after the explicit region (tapped + 2 up-next)
		expect(queue.continuationFromIndex).toBe(3);
		expect(queue.isContinuationIndex(3)).toBe(true); // 22
		expect(queue.isContinuationIndex(2)).toBe(false); // 12 (explicit)
		expect(queue.continuationLabel).toBe('album x');
	});

	it('leaves no tail (and no label) when the last track is tapped', () => {
		queue.playContext(album([1, 2, 3]), 2, 'road mix');

		expect(queue.currentTrack?.id).toBe(3);
		expect(queue.tracks.map((t) => t.id)).toEqual([3]);
		expect(queue.continuationFromIndex).toBe(1); // == length, no tail
		expect(queue.continuationLabel).toBeNull();
	});

	it('exits radio mode', () => {
		player.radio = { track: track(99), stream_url: 'https://audio.test/99.mp3', start_at: 0 };
		queue.playContext(album([1, 2, 3]), 0, 'road mix');
		expect(player.radio).toBeNull();
	});

	// the layout "keep playing" effect calls queue.clearContinuation() whenever
	// keepPlaying is off (the default). a collection tail lives in the same
	// continuation region, so it must NOT be torn down by that path — otherwise
	// the feature is instantly broken for every default-settings user.
	it('survives clearContinuation (keep-playing off does not drop a collection tail)', () => {
		queue.playContext(album([1, 2, 3, 4]), 0, 'road mix');
		expect(queue.tracks.map((t) => t.id)).toEqual([1, 2, 3, 4]);

		queue.clearContinuation();

		expect(queue.tracks.map((t) => t.id)).toEqual([1, 2, 3, 4]);
		expect(queue.continuationLabel).toBe('road mix');
	});

	it('clearContinuation still tears down the For You tail (label === null)', () => {
		queue.setQueue(album([1]), 0);
		queue.appendContinuation(album([50, 51, 52])); // For You backfill → label null
		expect(queue.continuationLabel).toBeNull();
		expect(queue.tracks).toHaveLength(4);

		queue.clearContinuation();

		expect(queue.tracks.map((t) => t.id)).toEqual([1]);
	});

	it('does not duplicate a track already in the explicit up-next', () => {
		queue.setQueue(album([1, 2]), 0); // current 1, up-next 2
		// collection contains track 2 again after the tapped track
		queue.playContext(album([5, 2, 6]), 0, 'album x');

		// track 2 stays in the explicit region and is not re-added to the tail
		expect(queue.tracks.map((t) => t.id)).toEqual([5, 2, 6]);
		expect(queue.continuationFromIndex).toBe(2);
	});
});
