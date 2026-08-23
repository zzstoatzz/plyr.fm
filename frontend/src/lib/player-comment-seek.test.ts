// comment-timestamp seek on a not-yet-loaded track must apply after the new
// source attaches, never against the previous source ("first click goes to 0")
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { player } from '$lib/player.svelte';
import { queue } from '$lib/queue.svelte';
import type { Track } from '$lib/types';

vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

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

let cleanup: (() => void) | null = null;

async function mountPlayer(): Promise<HTMLAudioElement> {
	const Player = (await import('$lib/components/player/Player.svelte')).default;
	const component = mount(Player, { target: document.body });
	cleanup = () => unmount(component);
	flushSync();
	const audio = player.audioElement;
	if (!audio) throw new Error('player audio element did not mount');
	return audio;
}

async function waitForAttach(audio: HTMLAudioElement, fileId: string): Promise<void> {
	await vi.waitFor(() => {
		if (!audio.src.includes(fileId)) throw new Error(`audio not attached to ${fileId}`);
	});
}

beforeEach(() => {
	queue.tracks = [track(1)];
	queue.currentIndex = 0;
	queue.progressMs = 0;
	player.currentTrack = track(1);
	player.radio = null;
	player.paused = false;
	player.pendingSeek = null;
});

afterEach(() => {
	cleanup?.();
	cleanup = null;
	document.body.innerHTML = '';
});

describe('pending comment-timestamp seek', () => {
	it('applies the seek once the new track attaches, not against the old source', async () => {
		const audio = await mountPlayer();
		await waitForAttach(audio, 'file-1');
		audio.dispatchEvent(new Event('loadeddata'));

		// comment timestamp click on a different track
		player.pendingSeek = { trackId: 2, ms: 43_000 };
		queue.playNow(track(2));
		player.currentTrack = track(2);
		flushSync();

		// the seek must not have touched the element before the new source loads
		expect(audio.currentTime).toBe(0);

		await waitForAttach(audio, 'file-2');
		audio.dispatchEvent(new Event('loadeddata'));

		expect(audio.currentTime).toBeCloseTo(43);
		expect(player.pendingSeek).toBeNull();
	});

	it('wins over saved-progress restore on a fresh mount', async () => {
		queue.progressMs = 99_000; // hydrated saved position for some prior session
		player.pendingSeek = { trackId: 1, ms: 43_000 };
		const audio = await mountPlayer();
		await waitForAttach(audio, 'file-1');

		audio.dispatchEvent(new Event('loadeddata'));

		expect(audio.currentTime).toBeCloseTo(43);
		expect(player.pendingSeek).toBeNull();
	});

	it('clears a pending seek that belongs to a different track', async () => {
		const audio = await mountPlayer();
		await waitForAttach(audio, 'file-1');
		audio.dispatchEvent(new Event('loadeddata'));

		player.pendingSeek = { trackId: 3, ms: 43_000 };
		queue.playNow(track(2));
		player.currentTrack = track(2);
		flushSync();

		await waitForAttach(audio, 'file-2');
		audio.dispatchEvent(new Event('loadeddata'));

		expect(audio.currentTime).toBe(0);
		expect(player.pendingSeek).toBeNull();
	});
});
