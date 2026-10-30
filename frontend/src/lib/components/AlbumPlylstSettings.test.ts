import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import AlbumPlylstSettings from './AlbumPlylstSettings.svelte';
import PlylstLink from './PlylstLink.svelte';
import { API_URL } from '$lib/config';
import { defaultPublishing, LISTENING_POLICIES } from '$lib/publishing';

const components: object[] = [];
afterEach(async () => {
	for (const component of components.splice(0)) await unmount(component);
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

describe('album plylst setting', () => {
	it('persists the owner choice before publishing it to the page', async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
		vi.stubGlobal('fetch', fetchMock);
		const onchange = vi.fn<(albumId: string, enabled: boolean) => void>();
		components.push(
			mount(AlbumPlylstSettings, {
				target: document.body,
				props: { albumId: 'album', enabled: false, onchange }
			})
		);
		flushSync();
		const checkbox = document.querySelector('input');
		if (!checkbox) throw new Error('missing checkbox');
		checkbox.checked = true;
		checkbox.dispatchEvent(new Event('change', { bubbles: true }));
		await vi.waitFor(() => expect(onchange).toHaveBeenCalledWith('album', true));
		expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/albums/album?show_plylst=true`, {
			method: 'PATCH',
			credentials: 'include'
		});
	});

	it('restores the saved choice and shows an inline error after refusal', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 403 }))
		);
		const onchange = vi.fn<(albumId: string, enabled: boolean) => void>();
		components.push(
			mount(AlbumPlylstSettings, {
				target: document.body,
				props: { albumId: 'album', enabled: false, onchange }
			})
		);
		flushSync();
		const checkbox = document.querySelector('input');
		if (!checkbox) throw new Error('missing checkbox');
		checkbox.checked = true;
		checkbox.dispatchEvent(new Event('change', { bubbles: true }));
		await vi.waitFor(() =>
			expect(document.querySelector('[role="alert"]')?.textContent).toContain('could not save')
		);
		await tick();
		expect(checkbox.checked).toBe(false);
		expect(onchange).not.toHaveBeenCalled();
	});

	it('uses a fixed destination and local favicon without sharing a referrer', () => {
		components.push(
			mount(PlylstLink, {
				target: document.body,
				props: {
					album: { artist_handle: 'artist.test', slug: 'a/b?c', show_plylst: true },
					tracks: [{ publishing: defaultPublishing() }]
				}
			})
		);
		flushSync();
		const link = document.querySelector('a');
		expect(link?.href).toBe('https://plylst.renderg.host/u/artist.test/album/a%2Fb%3Fc');
		expect(link?.rel).toBe('noopener noreferrer');
		expect(document.querySelector('img')?.getAttribute('src')).toBe('/integrations/plylst.svg');
		expect(link?.textContent?.trim()).toBe('');
	});
	it.each(LISTENING_POLICIES.filter((policy) => policy !== 'public'))(
		'hides the outbound link for %s listening',
		(listening) => {
			const publishing = defaultPublishing();
			publishing.access.listening = listening;
			components.push(
				mount(PlylstLink, {
					target: document.body,
					props: {
						album: { artist_handle: 'artist.test', slug: 'demo', show_plylst: true },
						tracks: [{ publishing }]
					}
				})
			);
			flushSync();
			expect(document.querySelector('a')).toBeNull();
		}
	);

	it('hides the link until the owner enables it', () => {
		components.push(
			mount(PlylstLink, {
				target: document.body,
				props: {
					album: { artist_handle: 'artist.test', slug: 'demo', show_plylst: false },
					tracks: [{ publishing: defaultPublishing() }]
				}
			})
		);
		flushSync();
		expect(document.querySelector('a')).toBeNull();
	});
});
