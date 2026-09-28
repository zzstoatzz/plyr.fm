import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Player from './components/player/Player.svelte';
import RadioPage from '../routes/radio/[[station]]/+page.svelte';
import { page } from '$app/stores';
import { get } from 'svelte/store';
import { player } from './player.svelte';
import { queue } from './queue.svelte';
import { radio, type RadioTrack, type RadioState } from './radio.svelte';

const track = (id: number): RadioTrack => ({
	id,
	title: `track ${id}`,
	artist: 'artist',
	artist_handle: 'artist.test',
	artist_did: 'did:plc:artist',
	stream_url: `https://audio.test/${id}.mp3`,
	file_type: 'mp3',
	duration: 10,
	artwork_url: null,
	thumbnail_url: null,
	atproto_record_uri: null,
	atproto_record_cid: null,
	created_at: '2026-09-27T00:00:00Z',
	tags: [],
	like_count: 0,
	play_count: 0,
	liked: false
});
const state = (): RadioState => ({
	station: 'loved',
	station_slug: 'loved',
	generated_at: new Date().toISOString(),
	loop_duration_seconds: 30,
	current_index: 0,
	current_started_at: null,
	current_ends_at: null,
	progress_seconds: 0,
	current: track(1),
	up_next: [track(2)],
	rotation: [track(1), track(2)]
});
vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
let elementPaused = false;
let elementEnded = false;
vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => elementPaused);
vi.spyOn(HTMLMediaElement.prototype, 'ended', 'get').mockImplementation(() => elementEnded);
vi.stubGlobal(
	'fetch',
	vi.fn(async () => new Response(JSON.stringify(state())))
);
const playbackStates: MediaSessionPlaybackState[] = [];
Object.defineProperty(navigator, 'mediaSession', {
	configurable: true,
	value: {
		setActionHandler() {},
		setPositionState() {},
		metadata: null,
		set playbackState(value: MediaSessionPlaybackState) {
			playbackStates.push(value);
		}
	}
});
vi.stubGlobal(
	'MediaMetadata',
	class {
		constructor(public value: MediaMetadataInit) {}
	}
);
let pageComponent: ReturnType<typeof mount> | undefined;
let component: ReturnType<typeof mount>;
let audio: HTMLAudioElement;
beforeEach(() => {
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
	radio.stations = [{ slug: 'loved', name: 'loved', description: '', is_default: true }];
	get(page).url.search = '';
	queue.tracks = [];
	queue.currentIndex = -1;
	player.radio = null;
	player.currentTrack = null;
	player.paused = true;
	radio.state = state();
	elementPaused = false;
	elementEnded = false;
	play.mockResolvedValue(undefined);
	component = mount(Player, { target: document.body });
	flushSync();
	audio = player.audioElement!;
	radio.tuneIn();
	flushSync();
	playbackStates.length = 0;
});
afterEach(async () => {
	if (pageComponent) await unmount(pageComponent);
	pageComponent = undefined;
	radio.stop();
	await unmount(component);
	document.body.replaceChildren();
});
describe('radio source transitions through the mounted player', () => {
	it.each([-12, 12])(
		'uses station progress when the device clock differs by %i hours',
		async (hours) => {
			const snapshot = state();
			snapshot.generated_at = new Date(Date.now() - hours * 3600000).toISOString();
			snapshot.progress_seconds = 4;
			radio.state = null;
			vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(snapshot)));
			await radio.loadState();
			radio.tuneIn();
			Object.defineProperty(audio, 'duration', { configurable: true, value: 10 });
			audio.dispatchEvent(new Event('loadedmetadata'));
			expect(audio.currentTime).toBeGreaterThanOrEqual(4);
			expect(audio.currentTime).toBeLessThan(5);
		}
	);
	it('counts elapsed time after receipt without following wall-clock changes', async () => {
		const snapshot = state();
		snapshot.progress_seconds = 4;
		radio.state = null;
		vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(snapshot)));
		const monotonic = vi.spyOn(performance, 'now').mockReturnValue(1000);
		await radio.loadState();
		monotonic.mockReturnValue(3000);
		const wallClock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 43200000);
		try {
			radio.tuneIn();
			expect(player.radio?.start_at).toBe(6);
		} finally {
			monotonic.mockRestore();
			wallClock.mockRestore();
		}
	});
	it('resets the successor to zero after a long track ends', () => {
		audio.currentTime = 4800;
		radio.onEnded();
		Object.defineProperty(audio, 'duration', { configurable: true, value: 10 });
		audio.dispatchEvent(new Event('loadedmetadata'));
		expect(audio.currentTime).toBe(0);
	});

	it('waits for the new source metadata instead of seeking with the previous duration', () => {
		Object.defineProperty(audio, 'readyState', { configurable: true, value: 1 });
		Object.defineProperty(audio, 'duration', { configurable: true, value: 1 });
		audio.currentTime = 0;
		player.playRadio({ ...player.radio!, start_at: 4 });
		expect(audio.currentTime).toBe(0);
		Object.defineProperty(audio, 'duration', { configurable: true, value: 10 });
		audio.dispatchEvent(new Event('loadedmetadata'));
		expect(audio.currentTime).toBe(4);
	});

	it('does not roll back to the ended track while the station catches up', async () => {
		const snapshot = state();
		const boundary = Date.parse(snapshot.generated_at) + 1000;
		snapshot.progress_seconds = 9;
		snapshot.current_started_at = new Date(boundary - 10000).toISOString();
		snapshot.current_ends_at = new Date(boundary).toISOString();
		radio.state = snapshot;
		vi.mocked(fetch)
			.mockResolvedValueOnce(new Response(JSON.stringify(snapshot)))
			.mockResolvedValueOnce(new Response(JSON.stringify(snapshot)));
		radio.onEnded();
		expect(radio.state?.progress_seconds).toBe(0);
		await radio.loadState();
		expect(radio.current?.id).toBe(2);
		expect(player.radio?.track.id).toBe(2);
		const successor = {
			...snapshot,
			generated_at: new Date(boundary + 1000).toISOString(),
			current_started_at: new Date(boundary).toISOString(),
			current: track(2),
			progress_seconds: 1
		};
		vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(successor)));
		await radio.loadState();
		expect(radio.state?.progress_seconds).toBe(1);
	});

	it('ignores the natural end pause and delayed pause from the old source', () => {
		elementPaused = true;
		elementEnded = true;
		audio.dispatchEvent(new Event('pause'));
		flushSync();
		expect(player.paused).toBe(false);
		expect(playbackStates).not.toContain('paused');
		audio.dispatchEvent(new Event('ended'));
		elementPaused = false;
		elementEnded = false;
		flushSync();
		audio.dispatchEvent(new Event('pause'));
		flushSync();
		expect(player.radio?.track.id).toBe(2);
		expect(player.paused).toBe(false);
		expect(playbackStates).not.toContain('paused');
	});
	it('ignores a superseded shared-player play rejection', async () => {
		let reject: (error: DOMException) => void = () => {};
		player.paused = true;
		flushSync();
		elementPaused = true;
		play.mockImplementationOnce(
			() =>
				new Promise((_, rejectPromise) => {
					reject = rejectPromise;
				})
		);
		player.paused = false;
		flushSync();
		radio.onEnded();
		elementPaused = false;
		flushSync();
		reject(new DOMException('old source interrupted', 'AbortError'));
		await Promise.resolve();
		flushSync();
		expect(player.radio?.track.id).toBe(2);
		expect(player.paused).toBe(false);
	});
	it('pauses for a genuine failure of the currently requested source', async () => {
		player.paused = true;
		flushSync();
		elementPaused = true;
		play.mockRejectedValueOnce(new DOMException('cannot decode', 'NotSupportedError'));
		player.paused = false;
		flushSync();
		await Promise.resolve();
		flushSync();
		expect(player.paused).toBe(true);
	});

	it('honors an explicit pause and ignores an already-queued play event', () => {
		elementPaused = true;
		audio.dispatchEvent(new Event('pause'));
		flushSync();
		expect(player.paused).toBe(true);
		audio.dispatchEvent(new Event('play'));
		flushSync();
		expect(player.paused).toBe(true);
		expect(playbackStates.at(-1)).toBe('paused');
		radio.onEnded();
		flushSync();
		expect(player.paused).toBe(true);
	});
});

describe('radio mute through the shared audio element', () => {
	it('keeps native desktop volume changes synchronized', () => {
		player.volume = 0.7;
		flushSync();
		audio.volume = 0.3;
		audio.dispatchEvent(new Event('volumechange'));
		flushSync();
		expect(player.volume).toBe(0.3);
		expect(audio.muted).toBe(false);
	});
	it('mutes and restores audio when the browser ignores volume assignments', async () => {
		player.volume = 0.7;
		Object.defineProperty(audio, 'volume', { configurable: true, get: () => 1, set: () => {} });
		player.volume = 0;
		flushSync();
		audio.dispatchEvent(new Event('volumechange'));
		flushSync();
		expect(player.volume).toBe(0);
		expect(audio.volume).toBe(1);
		expect(audio.muted).toBe(true);
		player.volume = 0.7;
		flushSync();
		audio.dispatchEvent(new Event('volumechange'));
		flushSync();
		expect(player.volume).toBe(0.7);
		expect(audio.muted).toBe(false);
	});
});

describe('Eli’s full-page OBS autoplay contract (#1592)', () => {
	it.each(['', '?autoplay=0'])('does not autoplay with %s', async (search) => {
		radio.stop();
		flushSync();
		play.mockClear();
		get(page).url.search = search;
		pageComponent = mount(RadioPage, { target: document.body, props: { data: { station: null } } });
		flushSync();
		await new Promise((resolve) => setTimeout(resolve, 25));
		expect(play).not.toHaveBeenCalled();
	});
	it('does not retry a policy-blocked OBS autoplay attempt', async () => {
		radio.stop();
		flushSync();
		play.mockClear();
		get(page).url.search = '?autoplay=1';
		play.mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));
		pageComponent = mount(RadioPage, { target: document.body, props: { data: { station: null } } });
		flushSync();
		await vi.waitFor(() => expect(play).toHaveBeenCalled());
		await vi.waitFor(() => expect(player.radio).toBeNull());
		const calls = play.mock.calls.length;
		radio.state = state();
		flushSync();
		await new Promise((resolve) => setTimeout(resolve, 25));
		expect(play.mock.calls.length).toBe(calls);
		expect(player.paused).toBe(true);
	});

	it('defers autoplay=1 once and does not restart after a pause', async () => {
		radio.stop();
		flushSync();
		play.mockClear();
		get(page).url.search = '?autoplay=1';
		pageComponent = mount(RadioPage, { target: document.body, props: { data: { station: null } } });
		flushSync();
		expect(play).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(player.radio).not.toBeNull());
		elementPaused = true;
		audio.dispatchEvent(new Event('pause'));
		flushSync();
		const calls = play.mock.calls.length;
		await new Promise((resolve) => setTimeout(resolve, 25));
		expect(player.paused).toBe(true);
		expect(play.mock.calls.length).toBe(calls);
	});
});
