import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ProfileSection from './ProfileSection.svelte';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
	await cleanup?.();
	document.body.innerHTML = '';
	vi.restoreAllMocks();
});

it('cannot replace saved access defaults when preferences fail to load', async () => {
	const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
		const url = String(input);
		return url.endsWith('/artists/me')
			? Response.json({ display_name: 'artist' })
			: new Response('unavailable', { status: 503 });
	});
	const target = document.createElement('div');
	document.body.appendChild(target);
	const component = mount(ProfileSection, {
		target,
		props: { atprotofansEligible: false, checkingAtprotofans: false }
	});
	cleanup = () => unmount(component);
	await vi.waitFor(() => {
		flushSync();
		expect(target.querySelector('[role="alert"]')?.textContent).toContain('could not load');
	});
	const submit = target.querySelector<HTMLButtonElement>('button[type="submit"]');
	expect(submit?.disabled).toBe(true);
	const form = target.querySelector('form');
	form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	await Promise.resolve();
	expect(fetcher.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});
