import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import TrackPage from './+page.svelte';

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
	await cleanup?.();
	document.body.innerHTML = '';
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it('shows the standard 404 after the authenticated track request is refused', async () => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
		}
	);
	vi.stubGlobal('matchMedia', (media: string) => ({
		media,
		matches: false,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn()
	}));
	const fetch = vi
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(new Response('{}', { status: 404 }));
	const component = mount(TrackPage, { target: document.body, props: { data: { track: null } } });
	cleanup = () => unmount(component);
	flushSync();
	await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('404'));
	expect(document.body.textContent).toContain("we couldn't find what you're looking for");
	expect(document.querySelector<HTMLAnchorElement>('a.home-link')?.getAttribute('href')).toBe('/');
	expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/tracks/'), {
		credentials: 'include'
	});
});
