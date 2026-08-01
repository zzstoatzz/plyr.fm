// a live broadcast preempts the rotation: no position to resume, and hls.js
// drives it wherever hls.js works — native HLS is the fallback, not the default.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { player, type RadioNowPlaying } from '$lib/player.svelte';
import type { Track } from '$lib/types';

vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

const hlsInstance = { loadSource: vi.fn(), attachMedia: vi.fn(), destroy: vi.fn() };
let hlsSupported = true;
class HlsCtor {
	static isSupported = () => hlsSupported;
	loadSource = hlsInstance.loadSource;
	attachMedia = hlsInstance.attachMedia;
	destroy = hlsInstance.destroy;
}
vi.mock('hls.js', () => ({ default: HlsCtor }));

function track(): Track {
	return {
		id: 1,
		title: 'firehose',
		artist: 'waow.tech',
		artist_handle: 'waow.tech',
		file_id: '',
		file_type: 'mp3',
		play_count: 0
	};
}

function live(): RadioNowPlaying {
	return {
		track: track(),
		stream_url: 'https://relay.test/live/index.m3u8',
		start_at: 0,
		live: true,
		streamKind: 'hls'
	};
}

function recorded(): RadioNowPlaying {
	return { track: track(), stream_url: 'https://audio.test/seg.mp3', start_at: 42 };
}

describe('live radio', () => {
	let el: HTMLAudioElement;

	beforeEach(() => {
		vi.clearAllMocks();
		hlsSupported = true;
		// the player is a module singleton — start every case with a cold module
		// so the preload-warmed path is only exercised where it's the subject.
		Object.assign(player, { hlsModule: null, hlsLoad: null });
		el = document.createElement('audio');
		player.audioElement = el;
		player.stopRadio();
	});

	it('uses hls.js even where canPlayType claims native HLS support', async () => {
		// Chrome answers "maybe" for the HLS mime type and then cannot demux the
		// MPEG-TS segments — trusting it left the station on-air and silent.
		vi.spyOn(el, 'canPlayType').mockReturnValue('maybe');
		player.playRadio(live());
		await vi.waitFor(() => expect(hlsInstance.attachMedia).toHaveBeenCalled());
		expect(hlsInstance.loadSource).toHaveBeenCalledWith('https://relay.test/live/index.m3u8');
		// the element's own src is left alone — hls.js drives it via MSE
		expect(el.src).toBe('');
	});

	it('starts playback once hls.js has media, not before the async import', async () => {
		vi.spyOn(el, 'canPlayType').mockReturnValue('maybe');
		player.playRadio(live());
		await vi.waitFor(() => expect(hlsInstance.attachMedia).toHaveBeenCalled());
		const playOrder = (el.play as ReturnType<typeof vi.fn>).mock.invocationCallOrder;
		const attachOrder = hlsInstance.attachMedia.mock.invocationCallOrder[0];
		expect(playOrder.some((order) => order > attachOrder)).toBe(true);
	});

	it('attaches synchronously once preloaded, keeping the tap gesture intact', async () => {
		// mobile only honours a play() in the same task as the tap, so a warmed
		// module must not push the attach onto a later microtask.
		vi.spyOn(el, 'canPlayType').mockReturnValue('maybe');
		await player.preloadHls();
		vi.clearAllMocks();
		player.playRadio(live());
		expect(hlsInstance.attachMedia).toHaveBeenCalled(); // no await
		expect(el.play).toHaveBeenCalledTimes(1); // the gesture's own play, not a replay
	});

	it('disables remote playback so iOS ManagedMediaSource will attach', async () => {
		vi.spyOn(el, 'canPlayType').mockReturnValue('maybe');
		player.playRadio(live());
		await vi.waitFor(() => expect(hlsInstance.attachMedia).toHaveBeenCalled());
		expect(el.disableRemotePlayback).toBe(true);
	});

	it('falls back to native playback where hls.js is unsupported (iOS Safari)', async () => {
		hlsSupported = false;
		vi.spyOn(el, 'canPlayType').mockReturnValue('maybe');
		player.playRadio(live());
		await vi.waitFor(() => expect(el.src).toContain('index.m3u8'));
		expect(hlsInstance.attachMedia).not.toHaveBeenCalled();
	});

	it('never loads hls.js for a recorded rotation entry', async () => {
		vi.spyOn(el, 'canPlayType').mockReturnValue('');
		player.playRadio(recorded());
		await vi.waitFor(() => expect(el.src).toContain('seg.mp3'));
		expect(hlsInstance.attachMedia).not.toHaveBeenCalled();
	});

	it('does not seek a live broadcast — it is wherever it is', async () => {
		vi.spyOn(el, 'canPlayType').mockReturnValue('maybe');
		Object.defineProperty(el, 'duration', { value: 600, configurable: true });
		Object.defineProperty(el, 'readyState', { value: 1, configurable: true });
		const np = live();
		np.start_at = 300; // a stale rotation position must be ignored
		player.playRadio(np);
		await vi.waitFor(() => expect(hlsInstance.attachMedia).toHaveBeenCalled());
		expect(el.currentTime).toBe(0);
	});

	it('tears the hls instance down when radio stops', async () => {
		vi.spyOn(el, 'canPlayType').mockReturnValue('');
		player.playRadio(live());
		await vi.waitFor(() => expect(hlsInstance.attachMedia).toHaveBeenCalled());
		player.stopRadio();
		expect(hlsInstance.destroy).toHaveBeenCalled();
	});
});
