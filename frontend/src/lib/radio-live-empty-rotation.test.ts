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

describe('an empty remembered station must not strand bare /radio', () => {
	beforeEach(() => {
		localStorage.clear();
		radio.state = null;
		radio.stations = [];
	});

	it('falls back to the default when the remembered station has nothing on air', async () => {
		localStorage.setItem('plyr_radio_station', 'firehose');
		const calls: (string | null)[] = [];
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const url = String(input);
			calls.push(url.includes('station=') ? new URL(url).searchParams.get('station') : null);
			const empty = url.includes('station=firehose');
			return new Response(
				JSON.stringify(
					empty
						? { ...liveStateWithNoRotation(), live: null }
						: { ...liveStateWithNoRotation(), live: null, station_slug: 'loved', current: { id: 1 } }
				),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			);
		});

		await radio.show(null); // bare /radio

		// asked for the remembered station, found it silent, retried the default
		expect(calls[0]).toBe('firehose');
		expect(localStorage.getItem('plyr_radio_station')).toBeNull();
		// landed on the server default rather than on silence
		expect(radio.station).toBe('loved');
	});

	it('respects an explicit /radio/<slug> even when it is off air', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ ...liveStateWithNoRotation(), live: null }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);

		await radio.show('firehose');

		// being told a station is off air beats being silently shown a different one
		expect(radio.station).toBe('firehose');
		expect(localStorage.getItem('plyr_radio_station')).toBe('firehose');
	});
});
