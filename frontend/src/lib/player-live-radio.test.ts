// a live broadcast preempts the rotation: no position to resume, and hls.js is
// only fetched when the browser can't play HLS natively.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { player, type RadioNowPlaying } from '$lib/player.svelte';
import type { Track } from '$lib/types';

vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

const hlsInstance = { loadSource: vi.fn(), attachMedia: vi.fn(), destroy: vi.fn() };
class HlsCtor {
	static isSupported = () => true;
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
		el = document.createElement('audio');
		player.audioElement = el;
		player.stopRadio();
	});

	it('uses hls.js when the browser cannot play HLS natively', async () => {
		vi.spyOn(el, 'canPlayType').mockReturnValue('');
		player.playRadio(live());
		await vi.waitFor(() => expect(hlsInstance.attachMedia).toHaveBeenCalled());
		expect(hlsInstance.loadSource).toHaveBeenCalledWith('https://relay.test/live/index.m3u8');
		// the element's own src is left alone — hls.js drives it via MSE
		expect(el.src).toBe('');
	});

	it('plays natively on Safari/iOS without loading hls.js', async () => {
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
		await vi.waitFor(() => expect(el.src).toContain('index.m3u8'));
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
