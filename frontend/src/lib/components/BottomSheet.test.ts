import { afterEach, expect, it, vi } from 'vitest';
import { createRawSnippet, flushSync, mount, tick, unmount } from 'svelte';
import BottomSheet from './BottomSheet.svelte';

let cleanup: (() => void) | undefined;

afterEach(() => {
	cleanup?.();
	document.body.innerHTML = '';
});

it('keeps reverse tab inside the newly opened sheet and closes with escape', async () => {
	const close = vi.fn<() => void>();
	const component = mount(BottomSheet, {
		target: document.body,
		props: {
			open: true,
			onClose: close,
			ariaLabel: 'test sheet',
			children: createRawSnippet(() => ({
				render: () => '<div><button>first action</button><button>last action</button></div>'
			}))
		}
	});
	cleanup = () => { void unmount(component); };
	flushSync();
	await tick();
	const dialog = document.querySelector('[role="dialog"]');
	expect(document.activeElement).toBe(dialog);
	window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }));
	expect(document.activeElement?.textContent).toBe('last action');
	window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
	expect(document.activeElement?.getAttribute('data-sheet-handle')).toBe('');
	window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
	expect(close).toHaveBeenCalledOnce();
});
