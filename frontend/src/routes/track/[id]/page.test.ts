import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import TrackPage from './+page.svelte';

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
	await cleanup?.();
	document.body.innerHTML = '';
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

beforeEach(() => {
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
});

it('shows the standard 404 after the authenticated track request is refused', async () => {
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

it('renders the artist avatar as the cover without declaring it 1200px track art', async () => {
	vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ comments: [] }));
	const avatar = 'https://example.com/avatar.jpg';
	const component = mount(TrackPage, {
		target: document.body,
		props: {
			data: {
				track: {
					id: 1,
					title: 'Crystal cathedral',
					artist: 'santi.codes',
					artist_handle: 'santi.codes',
					file_id: 'audio',
					file_type: 'mp3',
					play_count: 0,
					artist_avatar_url: avatar
				}
			}
		}
	});
	cleanup = () => unmount(component);
	flushSync();
	expect(document.querySelector('img.cover-art')?.getAttribute('src')).toBe(avatar);
	expect(document.head.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe(
		avatar
	);
	expect(document.head.querySelector('meta[property="og:image:width"]')).toBeNull();
});
