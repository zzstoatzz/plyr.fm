import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { queue } from './queue.svelte';
import { auth } from './auth.svelte';
import type { Track } from './types';

function track(id: number): Track {
	return {
		id,
		title: `t${id}`,
		artist: 'a',
		artist_did: 'did:plc:a',
		artist_handle: 'a.test',
		file_id: `f${id}`,
		file_type: 'mp3',
		play_count: 0,
		like_count: 0,
		created_at: '2026-01-01T00:00:00Z'
	};
}

function queueResponse(revision: number, tracks: Track[]) {
	return new Response(
		JSON.stringify({
			revision,
			state: { track_ids: tracks.map((t) => t.file_id), current_index: 0 },
			tracks
		}),
		{ headers: { etag: `"${revision}"` } }
	);
}

describe('queue sync races', () => {
	beforeEach(() => {
		auth.isAuthenticated = true;
		queue.clear();
		queue.tracks = [track(1), track(2)];
		queue.currentIndex = 0;
		queue.revision = 1;
	});

	afterEach(() => {
		auth.isAuthenticated = false;
		queue.clear();
		queue.revision = null;
		vi.restoreAllMocks();
	});

	it('a 409 keeps the local queue and re-pushes it under the new revision', async () => {
		const calls: { method: string; ifMatch: string | null }[] = [];
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			const method = init?.method ?? 'GET';
			calls.push({
				method,
				ifMatch: new Headers(init?.headers).get('If-Match')
			});
			if (method === 'PUT' && calls.filter((c) => c.method === 'PUT').length === 1) {
				return new Response('{"detail":"queue state conflict"}', { status: 409 });
			}
			if (method === 'GET') return queueResponse(5, [track(9)]);
			return queueResponse(6, [track(1), track(2)]);
		});

		const ok = await queue.pushQueue();

		expect(ok).toBe(true);
		// the user's queue survived the conflict — the server's [f9] did not replace it
		expect(queue.tracks.map((t) => t.file_id)).toEqual(['f1', 'f2']);
		expect(queue.revision).toBe(6);
		expect(calls.map((c) => `${c.method}:${c.ifMatch}`)).toEqual([
			'PUT:"1"',
			'GET:null',
			'PUT:"5"'
		]);
	});

	it('two conflicts in a row concede to the server', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			const method = init?.method ?? 'GET';
			if (method === 'PUT')
				return new Response('{"detail":"queue state conflict"}', { status: 409 });
			return queueResponse(7, [track(9)]);
		});

		const ok = await queue.pushQueue();

		expect(ok).toBe(false);
		expect(queue.tracks.map((t) => t.file_id)).toEqual(['f9']);
		expect(queue.revision).toBe(7);
	});

	it('the success echo never clobbers a queue that changed mid-flight', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			if ((init?.method ?? 'GET') === 'PUT') {
				// the user acts while the request is in the air
				queue.addTracks([track(3)]);
				return queueResponse(2, [track(1), track(2)]);
			}
			return queueResponse(2, [track(1), track(2)]);
		});

		await queue.pushQueue();

		expect(queue.tracks.map((t) => t.file_id)).toContain('f3');
	});
});
