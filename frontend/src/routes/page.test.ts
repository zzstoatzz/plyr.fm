import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import HomePage from './+page.svelte';

let component: ReturnType<typeof mount> | undefined;
afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.innerHTML = '';
	localStorage.clear();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it.each([false, true])(
	'starts with month despite a saved all-time period (empty=%s)',
	async (empty) => {
		localStorage.setItem('topTracksPeriod', 'all_time');
		vi.stubGlobal('matchMedia', (media: string) => ({
			media,
			matches: false,
			addEventListener() {},
			removeEventListener() {}
		}));
		vi.stubGlobal(
			'IntersectionObserver',
			class {
				observe() {}
				disconnect() {}
			}
		);
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			}
		);
		const periods: Array<string | null> = [];
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const url = new URL(String(input));
			if (url.pathname === '/tracks/top') {
				periods.push(url.searchParams.get('period'));
				return Response.json(
					empty
						? []
						: [
								{
									id: 1,
									title: 'Monthly favorite',
									artist: 'Artist',
									artist_handle: 'artist.test',
									file_id: 'audio',
									file_type: 'mp3',
									play_count: 0
								}
							]
				);
			}
			if (url.pathname === '/tracks/tags') return Response.json([]);
			return Response.json({ tracks: [], has_more: false });
		});
		component = mount(HomePage, { target: document.body });
		flushSync();
		await vi.waitFor(() => expect(periods.length).toBeGreaterThan(0));
		await new Promise((resolve) => setTimeout(resolve, 20));
		flushSync();
		expect(periods).toEqual(['month']);
		if (!empty) expect(document.querySelector('.period-toggle')?.textContent).toBe('past month');
	}
);
