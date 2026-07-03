// CopyrightFlag popover contract: the copyright match info must be reachable by
// tap/click (mobile has no hover) and dismissable, and it must surface both the
// matched-song text and a link to the docs — the old native `title` attribute
// gave none of this on touch (see Woody report).
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import CopyrightFlag from '$lib/components/portal/CopyrightFlag.svelte';

let component: Record<string, unknown> | null = null;

function mountFlag(props: Record<string, unknown>): HTMLButtonElement {
	component = mount(CopyrightFlag, { target: document.body, props });
	const trigger = document.querySelector<HTMLButtonElement>('.copyright-flag-trigger');
	expect(trigger).toBeTruthy();
	return trigger!;
}

function popover(): HTMLElement | null {
	return document.querySelector<HTMLElement>('.copyright-flag-popover');
}

afterEach(() => {
	if (component) {
		unmount(component);
		component = null;
	}
	document.body.innerHTML = '';
});

describe('CopyrightFlag', () => {
	it('is closed until the trigger is clicked (works without hover)', () => {
		const trigger = mountFlag({ match: 'Love Story by Taylor Swift' });
		expect(popover()).toBeNull();

		flushSync(() => trigger.click());
		const open = popover();
		expect(open).toBeTruthy();
		expect(open!.textContent).toContain('Love Story by Taylor Swift');
	});

	it('toggles closed on a second click', () => {
		const trigger = mountFlag({ match: 'Some Song' });
		flushSync(() => trigger.click());
		expect(popover()).toBeTruthy();
		flushSync(() => trigger.click());
		expect(popover()).toBeNull();
	});

	it('dismisses on an outside pointerdown', () => {
		const trigger = mountFlag({ match: 'Some Song' });
		flushSync(() => trigger.click());
		expect(popover()).toBeTruthy();

		const outside = document.createElement('div');
		document.body.appendChild(outside);
		flushSync(() => outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
		expect(popover()).toBeNull();
	});

	it('always links to the docs and to the record when present', () => {
		const trigger = mountFlag({ match: 'X', recordUrl: 'https://pds.example/record/1' });
		flushSync(() => trigger.click());
		const hrefs = Array.from(popover()!.querySelectorAll('a')).map((a) => a.getAttribute('href'));
		expect(hrefs).toContain('https://pds.example/record/1');
		expect(hrefs.some((h) => h?.includes('docs.plyr.fm'))).toBe(true);
	});

	it('renders without a match string (scan flagged but no primary match)', () => {
		const trigger = mountFlag({ match: null });
		flushSync(() => trigger.click());
		const open = popover();
		expect(open).toBeTruthy();
		expect(open!.querySelector('.copyright-flag-match')).toBeNull();
		expect(open!.textContent).toContain('possible copyright match');
	});
});
