import { afterEach, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import UploadStorageNotice from './UploadStorageNotice.svelte';

let cleanup: (() => void) | undefined;

afterEach(() => {
	cleanup?.();
	document.body.innerHTML = '';
});

it('requires an unchecked, explicit choice before submitting plyr-only storage', () => {
	const form = document.createElement('form');
	document.body.append(form);
	const component = mount(UploadStorageNotice, {
		target: form,
		props: { protectedAudio: true, spacesSupported: false, accepted: false }
	});
	cleanup = () => {
		void unmount(component);
	};
	flushSync();
	const input = form.querySelector('input');
	if (!input) throw new Error('storage choice missing');
	expect(form.textContent).toContain('without a copy on my PDS');
	expect(input.checked).toBe(false);
	expect(form.checkValidity()).toBe(false);
	input.click();
	flushSync();
	expect(input.checked).toBe(true);
	expect(form.checkValidity()).toBe(true);
});

it('explains PDS ownership without offering plyr-only storage to capable accounts', () => {
	const component = mount(UploadStorageNotice, {
		target: document.body,
		props: { protectedAudio: true, spacesSupported: true, accepted: false }
	});
	cleanup = () => {
		void unmount(component);
	};
	flushSync();
	expect(document.body.textContent).toContain('Space on your PDS');
	expect(document.querySelector('input')).toBeNull();
});
