import { afterEach, describe, expect, it, vi } from 'vitest';
import { queue } from './queue.svelte';
import { auth } from './auth.svelte';
import type { Track } from './types';

const original = {
	id: 1249,
	title: 'ft sando (live on logan)',
	artist: 'nate',
	artist_handle: 'zzstoatzz.io',
	file_id: 'shared-audio',
	file_type: 'm4a',
	play_count: 2
} satisfies Track;
const reupload = { ...original, id: 1261, title: 'test', artist: 'oi bruv cheers innit' };

afterEach(() => {
	auth.isAuthenticated = false;
	queue.clear();
	queue.revision = null;
	vi.restoreAllMocks();
});

describe('queue track identity', () => {
	it('saves track identities alongside legacy audio IDs and accepts the echo', async () => {
		auth.isAuthenticated = true;
		queue.setQueue([original, reupload, original], 2);
		const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			const state = {
				track_ids: ['shared-audio', 'shared-audio', 'shared-audio'],
				track_record_ids: [1249, 1261, 1249],
				original_order_record_ids: [1249, 1261, 1249],
				current_record_id: 1249,
				current_index: 2
			};
			expect(await new Request(input, init).json()).toMatchObject({ state });
			return new Response(JSON.stringify({ revision: 1, state, tracks: [original, reupload] }));
		});

		expect(await queue.pushQueue()).toBe(true);
		expect(fetch).toHaveBeenCalledOnce();
		expect(queue.tracks.map((track) => track.id)).toEqual([1249, 1261, 1249]);
		expect(queue.currentTrack?.title).toBe(original.title);
	});

	it('restores distinct uploads and repeated entries sharing an audio file', () => {
		const snapshot = {
			revision: 1,
			state: {
				track_ids: ['shared-audio', 'shared-audio', 'shared-audio'],
				track_record_ids: [original.id, reupload.id, original.id],
				original_order_ids: ['shared-audio', 'shared-audio', 'shared-audio'],
				original_order_record_ids: [reupload.id, original.id, original.id],
				current_track_id: 'shared-audio',
				current_record_id: original.id,
				current_index: 2,
				shuffle: true
			},
			tracks: [original, reupload]
		};

		queue.applySnapshot(snapshot);

		expect(queue.tracks.map((track) => track.id)).toEqual([1249, 1261, 1249]);
		expect(queue.originalOrder.map((track) => track.id)).toEqual([1261, 1249, 1249]);
		expect(queue.currentIndex).toBe(2);
		expect(queue.currentTrack?.title).toBe(original.title);
	});

	it('does not substitute a shared-file upload for a missing track', () => {
		queue.playNow(original);
		const snapshot = {
			revision: 2,
			state: {
				track_ids: ['shared-audio'],
				track_record_ids: [original.id],
				original_order_ids: ['shared-audio'],
				original_order_record_ids: [original.id],
				current_track_id: 'shared-audio',
				current_record_id: original.id,
				current_index: 0,
				shuffle: false
			},
			tracks: [reupload]
		};

		queue.applySnapshot(snapshot);

		expect(queue.tracks).toEqual([]);
		expect(queue.originalOrder).toEqual([]);
	});

	it('finds the selected upload after a preceding missing track is removed', () => {
		expect(queue.resolveCurrentIndex('shared-audio', 1, [original, reupload], original.id)).toBe(0);
	});
});
