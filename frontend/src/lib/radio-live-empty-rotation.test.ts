// a live station with an EMPTY rotation is still on the air. shipped broken
// once: the page gated its whole on-air block on a rotation entry existing, so
// `firehose` rendered "no tracks in rotation yet" and could not be tuned in to
// even while the broadcast was airing.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { radio } from '$lib/radio.svelte';
import { player } from '$lib/player.svelte';
import type { RadioState } from '$lib/radio.svelte';

vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

function liveStateWithNoRotation(): RadioState {
	return {
		station: 'firehose',
		station_slug: 'firehose',
		generated_at: new Date().toISOString(),
		loop_duration_seconds: 0,
		current_index: null,
		current_started_at: null,
		current_ends_at: null,
		progress_seconds: 0,
		current: null,
		up_next: [],
		rotation: [],
		live: {
			stream_url: 'https://relay.test/live/index.m3u8',
			kind: 'hls',
			started_at: '2026-07-30T19:12:32Z'
		}
	};
}

describe('a live station with no rotation', () => {
	beforeEach(() => {
		player.audioElement = document.createElement('audio');
		player.stopRadio();
		radio.state = null;
	});

	it('is on the air even though the rotation is empty', () => {
		radio.state = liveStateWithNoRotation();
		expect(radio.current).toBeNull();
		expect(radio.isLive).toBe(true);
		expect(radio.hasSomethingOnAir).toBe(true);
	});

	it('can be tuned in to, and airs the broadcast', () => {
		radio.state = liveStateWithNoRotation();
		radio.tuneIn();
		expect(player.radio).not.toBeNull();
		expect(player.radio?.stream_url).toBe('https://relay.test/live/index.m3u8');
		expect(player.radio?.live).toBe(true);
		// display-only entry: id 0 marks it as having no track page to link to
		expect(player.radio?.track.id).toBe(0);
		expect(player.radio?.track.title).toBe('firehose');
	});

	it('is genuinely off air when neither a broadcast nor a rotation exists', () => {
		const s = liveStateWithNoRotation();
		radio.state = { ...s, live: null };
		expect(radio.hasSomethingOnAir).toBe(false);
		radio.tuneIn();
		expect(player.radio).toBeNull();
	});
});
