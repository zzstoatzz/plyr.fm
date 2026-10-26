import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import HideTagSheet from './HideTagSheet.svelte';

const popular = [
	{ name: 'ai', track_count: 40, total_plays: 900 },
	{ name: 'ambient', track_count: 12, total_plays: 300 }
];

vi.stubGlobal(
	'fetch',
	vi.fn(async (url: string) => {
		const q = new URL(url).searchParams.get('q');
		const body = q ? popular.filter((t) => t.name.startsWith(q)) : popular;
		return new Response(JSON.stringify(body));
	})
);

let app: ReturnType<typeof mount> | null = null;

function render(hiddenTags: string[] = []) {
	const onHide = vi.fn();
	const onUnhide = vi.fn();
	app = mount(HideTagSheet, { target: document.body, props: { hiddenTags, onHide, onUnhide } });
	flushSync();
	const backdrop = document.querySelector<HTMLElement>('.sheet-backdrop');
	const input = document.querySelector<HTMLInputElement>('.tag-input');
	if (!backdrop || !input || !app) throw new Error('sheet did not render');
	return { sheet: app, backdrop, input, onHide, onUnhide };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

describe('HideTagSheet', () => {
	it('is inert until opened, then focuses the input within the same call', () => {
		const { sheet, backdrop, input } = render();
		expect(backdrop.inert).toBe(true);

		sheet.open();

		expect(document.activeElement).toBe(input);
		expect(backdrop.inert).toBe(false);
	});

	it('lists popular tags that are not already hidden', async () => {
		const { sheet } = render(['ai']);
		sheet.open();
		await settle();
		flushSync();

		const names = [...document.querySelectorAll('.option-name')].map((el) => el.textContent);
		expect(names).toEqual(['ambient']);
	});

	it('hides a typed tag on enter and keeps the sheet open for the next one', async () => {
		const { sheet, backdrop, input, onHide } = render();
		sheet.open();
		input.value = 'Drone';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		flushSync();

		expect(onHide).toHaveBeenCalledWith('drone');
		expect(input.value).toBe('');
		expect(backdrop.classList.contains('open')).toBe(true);
	});

	it('closes on escape', () => {
		const { sheet, backdrop, input } = render();
		sheet.open();
		flushSync();
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();

		expect(backdrop.classList.contains('open')).toBe(false);
		expect(backdrop.inert).toBe(true);
	});

	it('sizes itself to the visible viewport so the keyboard never covers it', () => {
		const vv = Object.assign(new EventTarget(), { offsetTop: 0, height: 844 });
		vi.stubGlobal('visualViewport', vv);
		const { sheet, backdrop } = render();
		sheet.open();
		flushSync();
		expect(backdrop.style.height).toBe('844px');

		vv.height = 508;
		vv.offsetTop = 12;
		vv.dispatchEvent(new Event('resize'));
		flushSync();

		expect(backdrop.style.height).toBe('508px');
		expect(backdrop.style.top).toBe('12px');
		vi.stubGlobal('visualViewport', undefined);
	});
});
