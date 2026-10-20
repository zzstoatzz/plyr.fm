import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import UploadPauseNotice from './UploadPauseNotice.svelte';

let cleanup: (() => void) | undefined;

afterEach(() => {
	cleanup?.();
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

it('keeps a failed draft, prevents duplicate submissions, and confirms only saved messages', async () => {
	let finish: ((response: Response) => void) | undefined;
	const fetch = vi.fn<typeof globalThis.fetch>()
		.mockResolvedValueOnce(new Response('{}', { status: 503 }))
		.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
	vi.stubGlobal('fetch', fetch);
	const component = mount(UploadPauseNotice, { target: document.body, props: { message: 'paused' } });
	cleanup = () => { void unmount(component); };
	flushSync();
	const textarea = document.querySelector('textarea');
	const form = document.querySelector('form');
	const button = document.querySelector('button');
	if (!textarea || !form || !button) throw new Error('feedback form missing');
	expect(button.disabled).toBe(true);
	textarea.value = '  please email me  ';
	textarea.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
	expect(textarea.value).toBe('  please email me  ');
	expect(document.querySelector('[role="status"]')).toBeNull();
	form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	flushSync();
	expect(button.disabled).toBe(true);
	form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	expect(fetch).toHaveBeenCalledTimes(2);
	expect(fetch.mock.calls[1][1]).toMatchObject({
		credentials: 'include', method: 'POST', body: JSON.stringify({ message: 'please email me' })
	});
	if (!finish) throw new Error('request missing');
	finish(new Response('{"id":1}', { status: 201 }));
	await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toContain('saved'));
	expect(document.querySelector('textarea')).toBeNull();
});
