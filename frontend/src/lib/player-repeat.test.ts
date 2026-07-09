// repeat-one (#1445): a natural track end must restart the current track
// instead of advancing the queue — and advancing must resume when repeat
// is toggled back off.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { player } from '$lib/player.svelte';
import { queue } from '$lib/queue.svelte';
import type { Track } from '$lib/types';

vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

vi.stubGlobal(
	'fetch',
	vi.fn(() => Promise.resolve(new Response(JSON.stringify({}))))
);

function track(id: number): Track {
	return {
		id,
		title: `track ${id}`,
		artist: 'artist',
		artist_handle: 'artist.test',
		file_id: `file-${id}`,
		file_type: 'mp3',
		play_count: 0
	};
}

let component: Record<string, unknown>;

async function mountPlayer(): Promise<HTMLAudioElement> {
	const Player = (await import('$lib/components/player/Player.svelte')).default;
	component = mount(Player, { target: document.body });
	flushSync();
	const audio = player.audioElement;
	if (!audio) throw new Error('player audio element did not mount');
	return audio;
}

beforeEach(() => {
	playSpy.mockClear();
	queue.tracks = [track(1), track(2)];
	queue.currentIndex = 0;
	queue.repeatMode = 'none';
	player.currentTrack = track(1);
	player.radio = null;
	player.paused = false;
});

afterEach(() => {
	unmount(component);
	document.body.innerHTML = '';
});

describe('handleTrackEnded with repeat-one', () => {
	it('restarts the current track and does not advance', async () => {
		const audio = await mountPlayer();
		queue.repeatMode = 'one';
		playSpy.mockClear();

		audio.dispatchEvent(new Event('ended'));

		expect(playSpy).toHaveBeenCalled();
		expect(queue.currentIndex).toBe(0);
		expect(player.currentTrack?.id).toBe(1);
	});

	it('advances to the next track when repeat is off (control)', async () => {
		const audio = await mountPlayer();

		audio.dispatchEvent(new Event('ended'));
		flushSync();

		expect(queue.currentIndex).toBe(1);
	});
});
