import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { swipeToDismiss } from './swipe-to-dismiss';

describe('sheet dismissal', () => {
	let sheet: HTMLDivElement;
	let handle: HTMLButtonElement;
	let content: HTMLDivElement;
	let dismiss: ReturnType<typeof vi.fn<() => void>>;
	let cleanup: void | (() => void);

	function pointer(target: HTMLElement, type: string, y: number, extra: PointerEventInit = {}) {
		target.dispatchEvent(
			new PointerEvent(type, {
				bubbles: true,
				pointerId: 1,
				pointerType: 'touch',
				button: 0,
				clientX: 50,
				clientY: y,
				...extra
			})
		);
	}

	beforeEach(() => {
		sheet = document.createElement('div');
		handle = document.createElement('button');
		handle.dataset.sheetHandle = '';
		content = document.createElement('div');
		content.className = 'sheet-content';
		sheet.append(handle, content);
		document.body.append(sheet);
		dismiss = vi.fn<() => void>();
		handle.onclick = dismiss;
		cleanup = swipeToDismiss(dismiss)(sheet);
	});

	afterEach(() => {
		cleanup?.();
		sheet.remove();
	});

	it.each(['mouse', 'touch', 'pen'])(
		'drags the handle with %s even when content is scrolled',
		(pointerType) => {
			content.scrollTop = 200;
			pointer(handle, 'pointerdown', 0, { pointerType });
			pointer(sheet, 'pointermove', 100, { pointerType });
			expect(sheet.style.transform).toBe('translateY(100px)');
			pointer(sheet, 'pointerup', 100, { pointerType });
			expect(dismiss).toHaveBeenCalledTimes(1);
		}
	);

	it('leaves content gestures to native scrolling', () => {
		pointer(content, 'pointerdown', 0);
		pointer(content, 'pointermove', 120);
		pointer(content, 'pointerup', 120);
		expect(dismiss).not.toHaveBeenCalled();
		expect(sheet.style.transform).toBe('');
	});

	it.each(['pointercancel', 'lostpointercapture'])(
		'snaps back without dismissing on %s',
		(event) => {
			pointer(handle, 'pointerdown', 0);
			pointer(sheet, 'pointermove', 120);
			pointer(sheet, event, 120);
			expect(dismiss).not.toHaveBeenCalled();
			expect(sheet.style.transform).toBe('');
		}
	);

	it('suppresses the click after a drag but preserves keyboard activation', () => {
		pointer(handle, 'pointerdown', 0);
		pointer(sheet, 'pointermove', 120);
		pointer(sheet, 'pointerup', 120);
		handle.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
		expect(dismiss).toHaveBeenCalledTimes(1);
		handle.click();
		expect(dismiss).toHaveBeenCalledTimes(2);
	});

	it('does not use stale flick velocity after holding a short drag', () => {
		pointer(handle, 'pointerdown', 0);
		pointer(sheet, 'pointermove', 20);
		const release = new PointerEvent('pointerup', { bubbles: true, pointerId: 1 });
		Object.defineProperty(release, 'timeStamp', { value: performance.now() + 1000 });
		sheet.dispatchEvent(release);
		expect(dismiss).not.toHaveBeenCalled();
	});

	it('keeps dragging when capture transfers from the handle to the sheet', () => {
		pointer(handle, 'pointerdown', 0);
		pointer(sheet, 'pointermove', 20);
		pointer(handle, 'lostpointercapture', 20);
		pointer(sheet, 'pointermove', 100);
		expect(sheet.style.transform).toBe('translateY(100px)');
		pointer(sheet, 'pointerup', 100);
		expect(dismiss).toHaveBeenCalledTimes(1);
	});

	it('ignores a second pointer and cleans up an interrupted drag', () => {
		pointer(handle, 'pointerdown', 0);
		pointer(handle, 'pointerdown', 300, { pointerId: 2 });
		pointer(sheet, 'pointermove', 120);
		expect(sheet.style.transform).toBe('translateY(120px)');
		cleanup?.();
		cleanup = undefined;
		expect(sheet.style.transform).toBe('');
		pointer(sheet, 'pointerup', 120);
		expect(dismiss).not.toHaveBeenCalled();
	});
});
