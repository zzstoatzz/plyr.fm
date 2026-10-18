// a rotation entry whose audio is gone (R2 404, 2026-10-18 deep-cuts report)
// must not stall the station: the player moves on, and the station poll that
// still names the dead track must not put it back on air.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Player from './components/player/Player.svelte';
import { player } from './player.svelte';
import { queue } from './queue.svelte';
import { radio, type RadioTrack, type RadioState } from './radio.svelte';

const POLL_INTERVAL_MS = 30000;

const track = (id: number): RadioTrack => ({
	id,
	title: `track ${id}`,
	artist: 'artist',
	artist_handle: 'artist.test',
	artist_did: 'did:plc:artist',
	stream_url: `https://audio.test/${id}.mp3`,
	file_type: 'mp3',
	duration: 200,
	artwork_url: null,
	thumbnail_url: null,
	atproto_record_uri: null,
	atproto_record_cid: null,
	created_at: '2026-10-18T00:00:00Z',
	tags: [],
	like_count: 0,
	play_count: 0,
	liked: false
});

const stationAiring = (current: number, upNext: number[]): RadioState => ({
	station: 'deep cuts',
	station_slug: 'deep-cuts',
	generated_at: new Date().toISOString(),
	loop_duration_seconds: 800,
	current_index: 0,
	current_started_at: null,
	current_ends_at: null,
	progress_seconds: 30,
	current: track(current),
	up_next: upNext.map(track),
	rotation: [track(current), ...upNext.map(track)]
});

vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false);
const fetchMock = vi.fn(async () => new Response(JSON.stringify(stationAiring(1, [2, 3]))));
vi.stubGlobal('fetch', fetchMock);

let component: ReturnType<typeof mount>;
let audio: HTMLAudioElement;

const failSource = () => {
	audio.dispatchEvent(new Event('error'));
	flushSync();
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
	vi.stubGlobal('matchMedia', () => ({
		matches: false,
		addEventListener() {},
		removeEventListener() {}
	}));
	queue.tracks = [];
	queue.currentIndex = -1;
	player.radio = null;
	player.currentTrack = null;
	player.paused = true;
	radio.state = stationAiring(1, [2, 3]);
	component = mount(Player, { target: document.body });
	flushSync();
	audio = player.audioElement!;
	radio.tuneIn();
	flushSync();
});

afterEach(async () => {
	radio.stop();
	radio.forgetUnplayable();
	await unmount(component);
	document.body.replaceChildren();
	vi.useRealTimers();
});

describe('radio on an unplayable track', () => {
	it('moves on to the next entry when the on-air source fails to load', () => {
		expect(player.radio?.track.id).toBe(1);
		failSource();
		expect(player.radio?.track.id).toBe(2);
		expect(player.radio?.start_at).toBe(0);
		expect(player.paused).toBe(false);
		expect(radio.current?.id).toBe(2);
	});

	it('does not re-air the failed track when the station still names it', async () => {
		failSource();
		fetchMock.mockResolvedValue(new Response(JSON.stringify(stationAiring(1, [2, 3]))));
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
		flushSync();
		expect(player.radio?.track.id).toBe(2);
		expect(radio.current?.id).toBe(2);
		expect(radio.state?.up_next.map((t) => t.id)).toEqual([3]);
	});

	it('skips past consecutive unplayable entries', () => {
		failSource();
		failSource();
		expect(player.radio?.track.id).toBe(3);
	});

	it('ignores an error from a source the player has already left', () => {
		player.playRadio({ ...player.radio!, stream_url: 'https://audio.test/other.mp3' });
		radio.onMediaError('https://audio.test/1.mp3');
		expect(player.radio?.stream_url).toBe('https://audio.test/other.mp3');
		expect(radio.current?.id).toBe(1);
		expect(radio.state?.up_next.map((t) => t.id)).toEqual([2, 3]);
	});
});
