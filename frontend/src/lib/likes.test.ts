import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { likes } from './likes.svelte';
import { auth } from './auth.svelte';
import { toast } from './toast.svelte';
import type { Track } from './types';

// SAFETY: the owner reads only id, title, is_liked, like_count, file_id and gated; the rest of Track is never touched here
const track = (id: number, liked = false): Track =>
	({ id, title: `t${id}`, is_liked: liked, like_count: 3, file_id: 'f', gated: false }) as Track;

const originalFetch = globalThis.fetch;
const requests: string[] = [];
let respond: (url: string) => Response = () => new Response('{}', { status: 200 });

beforeEach(() => {
	requests.length = 0;
	respond = () => new Response('{}', { status: 200 });
	globalThis.fetch = async (input, init) => {
		const url = String(input);
		requests.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
		return respond(url);
	};
	auth.isAuthenticated = true;
	toast.toasts = [];
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	auth.isAuthenticated = false;
	toast.toasts = [];
});

describe('likes', () => {
	it('flips optimistically, calls the endpoint, and every surface reads the same answer', async () => {
		const t = track(7);
		const done = likes.toggle(t);
		expect(likes.isLiked(t)).toBe(true);
		expect(t.like_count).toBe(4);
		expect(await done).toBe(true);
		expect(requests).toEqual(['POST /tracks/7/like']);
		expect(likes.isLiked({ id: 7, is_liked: false })).toBe(true);
		expect(toast.toasts.at(-1)?.message).toBe('liked t7');
	});

	it('reverts when the request fails', async () => {
		const t = track(8, true);
		respond = () => new Response('nope', { status: 500 });
		expect(await likes.toggle(t)).toBe(true);
		expect(t.is_liked).toBe(true);
		expect(t.like_count).toBe(3);
		expect(requests).toEqual(['DELETE /tracks/8/like']);
		expect(toast.toasts.at(-1)?.message).toBe('failed to update like');
	});

	it('refuses without a session and asks for sign-in', async () => {
		auth.isAuthenticated = false;
		const t = track(9);
		expect(await likes.toggle(t)).toBe(false);
		expect(requests).toEqual([]);
		expect(toast.toasts.at(-1)?.message).toBe('sign in to like tracks');
	});

	it('takes a result recorded by another surface', () => {
		likes.record(10, true);
		expect(likes.isLiked({ id: 10, is_liked: false })).toBe(true);
	});
});
