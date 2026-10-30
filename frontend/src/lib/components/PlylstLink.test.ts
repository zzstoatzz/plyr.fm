import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PlylstLink from './PlylstLink.svelte';
import { defaultPublishing, LISTENING_POLICIES } from '$lib/publishing';

const components: object[] = [];
afterEach(async () => {
	for (const component of components.splice(0)) await unmount(component);
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

describe('album plylst link', () => {
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
