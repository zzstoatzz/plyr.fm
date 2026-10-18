import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { swipeToDismiss } from './swipe-to-dismiss';

describe('drawer gesture ownership', () => {
	let sheet: HTMLDivElement;
	let content: HTMLDivElement;
	let row: HTMLAnchorElement;
	let cleanup: void | (() => void);

	function touch(type: string, x: number, y: number, target: HTMLElement = row): TouchEvent {
		const event = new TouchEvent(type, { bubbles: true, cancelable: true });
		const point = { identifier: 1, clientX: x, clientY: y };
		Object.defineProperty(event, 'touches', { value: [point] });
		Object.defineProperty(event, 'changedTouches', { value: [point] });
		target.dispatchEvent(event);
		return event;
	}

	beforeEach(() => {
		sheet = document.createElement('div');
		content = document.createElement('div');
		content.className = 'sheet-content';
		row = document.createElement('a');
		row.href = '/artist';
		content.append(row);
		sheet.append(content);
		document.body.append(sheet);
		cleanup = swipeToDismiss(() => {})(sheet);
	});

	afterEach(() => {
		cleanup?.();
		sheet.remove();
	});

	it('claims downward movement from a list row before native scrolling starts', () => {
		touch('touchstart', 100, 100);
		expect(touch('touchmove', 100, 102).defaultPrevented).toBe(true);
		expect(sheet.style.translate).toBe('0 2px');
		touch('touchmove', 105, 170);
		expect(sheet.style.translate).toBe('0 70px');
	});

	it('leaves upward scrolling native for the entire gesture', () => {
		touch('touchstart', 100, 100);
		expect(touch('touchmove', 100, 90).defaultPrevented).toBe(false);
		expect(touch('touchmove', 100, 150).defaultPrevented).toBe(false);
		expect(sheet.style.translate).toBe('');
	});

	it('does not dismiss when scrolling a list back to the top', () => {
		content.scrollTop = 120;
		touch('touchstart', 100, 100);
		expect(touch('touchmove', 100, 130).defaultPrevented).toBe(false);
		content.scrollTop = 0;
		expect(touch('touchmove', 100, 190).defaultPrevented).toBe(false);
		expect(sheet.style.translate).toBe('');
	});

	it('drags the header even when the list is scrolled', () => {
		content.scrollTop = 120;
		touch('touchstart', 100, 100, sheet);
		expect(touch('touchmove', 100, 150, sheet).defaultPrevented).toBe(true);
		expect(sheet.style.translate).toBe('0 50px');
	});

	it('leaves inputs and horizontal gestures alone', () => {
		const input = document.createElement('input');
		sheet.append(input);
		touch('touchstart', 100, 100, input);
		expect(touch('touchmove', 100, 150, input).defaultPrevented).toBe(false);
		touch('touchstart', 100, 100);
		expect(touch('touchmove', 150, 102).defaultPrevented).toBe(false);
		expect(sheet.style.translate).toBe('');
	});

	it('does not move a disabled drawer', () => {
		cleanup?.();
		cleanup = swipeToDismiss(() => {}, { enabled: false })(sheet);
		touch('touchstart', 100, 100);
		expect(touch('touchmove', 100, 200).defaultPrevented).toBe(false);
		expect(sheet.style.translate).toBe('');
	});
});
