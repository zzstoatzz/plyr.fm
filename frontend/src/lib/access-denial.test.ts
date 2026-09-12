import { afterEach, expect, it, vi } from 'vitest';
import { guardGatedTrack, playTrack } from './playback.svelte';
import { resolveAudioSource } from './audio-source';
import { queue } from './queue.svelte';
import { toast } from './toast.svelte';
import type { Track } from './types';

const track: Track = {
	id: 1,
	title: 'artist-only work',
	artist: 'artist',
	artist_handle: 'artist.test',
	artist_did: 'did:plc:artist',
	file_id: 'rendition',
	file_type: 'mp3',
	play_count: 0,
	audio_storage: 'r2_private',
	gated: true,
	publishing: {
		access: { listening: 'owner', downloads: 'off', visibility: 'public' },
		attach_rights: false
	}
};

afterEach(() => {
	toast.toasts = [];
	queue.tracks = [];
	vi.restoreAllMocks();
});

it('does not offer payment for artist-only queue access', () => {
	expect(guardGatedTrack(track, true)).toBe(false);
	expect(toast.toasts[0]?.message).toBe('only the artist can play this track');
	expect(toast.toasts[0]?.action).toBeUndefined();
});

it('keeps the current queue when the artist-only audio endpoint refuses playback', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 403 }));
	queue.tracks = [{ ...track, id: 2, gated: false }];
	expect(await playTrack(track)).toBe(false);
	expect(queue.tracks.map((entry) => entry.id)).toEqual([2]);
	expect(toast.toasts[0]?.action).toBeUndefined();
});

it('carries the actual audience through preloaded playback denial', async () => {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 403 }));
	expect(await resolveAudioSource(track, track.file_id)).toMatchObject({
		kind: 'gated-denied',
		requiresAuth: false,
		listening: 'owner'
	});
});

it('asks for authentication without describing signed-in listening as paid', () => {
	const signedIn: Track = {
		...track,
		publishing: {
			access: { listening: 'signed_in', downloads: 'off', visibility: 'public' },
			attach_rights: false
		}
	};
	expect(guardGatedTrack(signedIn, false)).toBe(false);
	expect(toast.toasts[0]?.message).toBe('this track requires an account');
	expect(toast.toasts[0]?.action?.label).toBe('sign in');
});
