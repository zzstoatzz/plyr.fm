// accessibility regressions are easy to reintroduce and invisible in a visual
// diff — these lock the accessible names/roles added for the storybook a11y pass.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount } from 'svelte';

let comp: Record<string, unknown> | null = null;
afterEach(() => {
	if (comp) unmount(comp);
	comp = null;
	document.body.innerHTML = '';
});

describe('a11y: TagInput', () => {
	it('labels the icon-only remove button and the text input', async () => {
		const TagInput = (await import('./TagInput.svelte')).default;
		comp = mount(TagInput, {
			target: document.body,
			props: { tags: ['house'], onAdd: () => {}, onRemove: () => {} }
		});
		const remove = document.querySelector<HTMLButtonElement>('.tag-remove');
		expect(remove?.getAttribute('aria-label')).toBe('remove house');
		const input = document.querySelector<HTMLInputElement>('.tag-input');
		expect(input?.getAttribute('aria-label')).toBe('add tag');
	});
});

describe('a11y: WaveLoading', () => {
	it('exposes a status role with an accessible name and hides the decorative bars', async () => {
		const WaveLoading = (await import('./WaveLoading.svelte')).default;
		comp = mount(WaveLoading, { target: document.body, props: { message: 'loading tracks' } });
		const status = document.querySelector<HTMLElement>('.wave-loading');
		expect(status?.getAttribute('role')).toBe('status');
		expect(status?.getAttribute('aria-label')).toBe('loading tracks');
		expect(document.querySelector('.bars')?.getAttribute('aria-hidden')).toBe('true');
	});

	it('falls back to a generic label when no message is given', async () => {
		const WaveLoading = (await import('./WaveLoading.svelte')).default;
		comp = mount(WaveLoading, { target: document.body, props: {} });
		expect(document.querySelector('.wave-loading')?.getAttribute('aria-label')).toBe('loading');
	});
});
