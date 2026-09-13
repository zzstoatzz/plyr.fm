import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AddToMenu from './AddToMenu.svelte';
import { auth } from '$lib/auth.svelte';
import { toast } from '$lib/toast.svelte';
import { likes } from '$lib/likes.svelte';

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
	await cleanup?.();
	document.body.innerHTML = '';
	auth.isAuthenticated = false;
	toast.toasts = [];
	likes.reset();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function clickButton(text: string): void {
	const button = [...document.querySelectorAll('button')].find(
		(button) => button.title === text || button.textContent?.trim() === text
	);
	if (!button) throw new Error('button not found: ' + text);
	button.click();
	flushSync();
}

it.each([false, true])('signed-out add menu shows a sign-in link (phone: %s)', async (phone) => {
	auth.isAuthenticated = false;
	vi.stubGlobal('matchMedia', (media: string) => ({ matches: phone, media }));
	const fetch = vi
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(new Response('{}', { status: 401 }));
	const component = mount(AddToMenu, {
		target: document.body,
		props: { trackId: 7, trackTitle: 'fixture', fileId: 'fixture' }
	});
	cleanup = () => unmount(component);
	flushSync();
	clickButton('add to...');
	clickButton('add to liked');

	await vi.waitFor(() => expect(toast.toasts).toHaveLength(1));
	expect(toast.toasts[0]).toMatchObject({
		type: 'info',
		message: '',
		action: { label: 'sign in to like tracks', href: '/login?return_to=%2F' }
	});
	expect(fetch).not.toHaveBeenCalled();
	expect(likes.isLiked({ id: 7 })).toBe(false);
	await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
});

it.each([200, 500])('signed-in menu preserves the request outcome (%s)', async (status) => {
	auth.isAuthenticated = true;
	vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media }));
	const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status }));
	const onLikeChange = vi.fn();
	const component = mount(AddToMenu, {
		target: document.body,
		props: { trackId: 8, trackTitle: 'fixture', onLikeChange }
	});
	cleanup = () => unmount(component);
	flushSync();
	clickButton('add to...');
	clickButton('add to liked');
	await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
	expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/tracks/8/like'), {
		method: 'POST',
		credentials: 'include'
	});
	expect(likes.isLiked({ id: 8 })).toBe(status === 200);
	expect(toast.toasts).toHaveLength(1);
	expect(toast.toasts[0]?.message).toBe(status === 200 ? 'liked fixture' : 'failed to update like');
	if (status === 200) expect(onLikeChange).toHaveBeenCalledWith(true);
	else expect(onLikeChange).not.toHaveBeenCalled();
});
