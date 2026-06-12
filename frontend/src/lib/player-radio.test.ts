// a policy-blocked autoplay tune-in (NotAllowedError) must roll the player
// back out of radio mode — not leave a silent on-air state ("stop" + LIVE
// with no sound). follow-up to #1592/#1593.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { player, type RadioNowPlaying } from '$lib/player.svelte';
import type { Track } from '$lib/types';

vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play');

function track(id: number): Track {
	return {
		id,
		title: `track ${id}`,
		artist: 'artist',
		artist_handle: 'artist.test',
		file_id: '',
		file_type: 'mp3',
		play_count: 0
	};
}

function nowPlaying(id: number): RadioNowPlaying {
	return { track: track(id), stream_url: `https://audio.test/${id}.mp3`, start_at: 0 };
}

const blocked = () =>
	new DOMException('The play method is not allowed in the current context', 'NotAllowedError');

beforeEach(() => {
	playSpy.mockReset();
	player.audioElement = document.createElement('audio');
	player.radio = null;
	player.currentTrack = null;
	player.paused = true;
});

describe('playRadio under autoplay policy', () => {
	it('rolls back out of radio mode when a fresh tune-in is blocked', async () => {
		playSpy.mockRejectedValueOnce(blocked());
		player.playRadio(nowPlaying(1));
		await vi.waitFor(() => expect(player.radio).toBeNull());
		expect(player.paused).toBe(true);
	});

	it('restores the previously loaded track on rollback', async () => {
		const prev = track(7);
		player.currentTrack = prev;
		playSpy.mockRejectedValueOnce(blocked());
		player.playRadio(nowPlaying(1));
		// $state proxies assigned objects, so compare by id rather than identity
		await vi.waitFor(() => expect(player.currentTrack?.id).toBe(prev.id));
		expect(player.radio).toBeNull();
	});

	it('keeps radio mode when a blocked play happens mid-session', async () => {
		playSpy.mockResolvedValueOnce(undefined);
		player.playRadio(nowPlaying(1));
		expect(player.radio?.track.id).toBe(1);

		playSpy.mockRejectedValueOnce(blocked());
		player.playRadio(nowPlaying(2));
		await vi.waitFor(() => expect(player.paused).toBe(true));
		expect(player.radio?.track.id).toBe(2);
	});

	it('keeps radio mode on non-policy playback errors', async () => {
		playSpy.mockRejectedValueOnce(new DOMException('no source', 'NotSupportedError'));
		player.playRadio(nowPlaying(1));
		await vi.waitFor(() => expect(player.paused).toBe(true));
		expect(player.radio?.track.id).toBe(1);
	});
});
