import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import HiddenTagsFilter from './HiddenTagsFilter.svelte';
import { auth } from '$lib/auth.svelte';
import { DEFAULT_PREFERENCES, preferences } from '$lib/preferences.svelte';
import { tracksCache } from '$lib/tracks.svelte';

const posts: string[][] = [];
let releaseFirst: () => void = () => {};

beforeEach(() => {
	posts.length = 0;
	auth.isAuthenticated = true;
	preferences.data = { ...DEFAULT_PREFERENCES, hidden_tags: [] };
	vi.spyOn(tracksCache, 'fetch').mockResolvedValue(undefined);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			if (init?.method === 'POST') {
				posts.push(JSON.parse(String(init.body)).hidden_tags);
				if (posts.length === 1) await new Promise<void>((resolve) => (releaseFirst = resolve));
				return new Response('{}');
			}
			return new Response(JSON.stringify(url.includes('/tracks/tags') ? [] : {}));
		})
	);
});

afterEach(() => {
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('HiddenTagsFilter', () => {
	it('saves quick successive hides in order, ending with every tag', async () => {
		const app = mount(HiddenTagsFilter, { target: document.body });
		flushSync();
		document.querySelector<HTMLButtonElement>('.filter-toggle')?.click();
		flushSync();
		document.querySelector<HTMLButtonElement>('.add-btn')?.click();
		flushSync();
		const input = document.querySelector<HTMLInputElement>('.tag-input');
		if (!input) throw new Error('sheet input missing');

		for (const tag of ['drone', 'noise']) {
			input.value = tag;
			input.dispatchEvent(new Event('input', { bubbles: true }));
			input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
			flushSync();
		}

		expect(preferences.data?.hidden_tags).toEqual(['drone', 'noise']);
		await vi.waitFor(() => expect(posts).toHaveLength(1));
		releaseFirst();
		await vi.waitFor(() => expect(posts).toHaveLength(2));
		expect(posts.at(-1)).toEqual(['drone', 'noise']);
		unmount(app);
	});
});
