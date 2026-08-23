import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveSwipe, swipeable, type SwipeState } from './swipe';

describe('resolveSwipe', () => {
	it('commits past 35% of the width, never under the 72px floor', () => {
		expect(resolveSwipe(120, 300).committed).toBe(true);
		expect(resolveSwipe(100, 300).committed).toBe(false);
		// narrow row: 35% of 150 = 52 < 72 floor
		expect(resolveSwipe(60, 150).committed).toBe(false);
		expect(resolveSwipe(72, 150).committed).toBe(true);
	});

	it('reports the side and a clamped progress', () => {
		expect(resolveSwipe(-30, 300)).toMatchObject({ side: 'left', progress: 30 / 105 });
		expect(resolveSwipe(30, 300).side).toBe('right');
		expect(resolveSwipe(0, 300).side).toBeNull();
		expect(resolveSwipe(500, 300).progress).toBe(1);
	});
});

const PointerEventCtor: typeof PointerEvent =
	typeof PointerEvent === 'undefined'
		? (class extends MouseEvent {
				pointerId: number;
				pointerType: string;
				constructor(type: string, init: PointerEventInit = {}) {
					super(type, init);
					this.pointerId = init.pointerId ?? 1;
					this.pointerType = init.pointerType ?? 'touch';
				}
			} as unknown as typeof PointerEvent)
		: PointerEvent;

function pointer(node: HTMLElement, type: string, x: number, y: number, extra: PointerEventInit = {}) {
	node.dispatchEvent(
		new PointerEventCtor(type, { clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', bubbles: true, cancelable: true, ...extra })
	);
}

describe('swipeable', () => {
	let node: HTMLElement;
	let onLeft: ReturnType<typeof vi.fn<() => void>>;
	let onRight: ReturnType<typeof vi.fn<() => void>>;
	let onUpdate: ReturnType<typeof vi.fn<(_state: SwipeState) => void>>;
	let action: ReturnType<typeof swipeable>;

	beforeEach(() => {
		node = document.createElement('div');
		Object.defineProperty(node, 'offsetWidth', { value: 300, configurable: true });
		document.body.appendChild(node);
		onLeft = vi.fn<() => void>();
		onRight = vi.fn<() => void>();
		onUpdate = vi.fn<(_state: SwipeState) => void>();
		action = swipeable(node, { onLeft, onRight, onUpdate });
	});

	afterEach(() => {
		action.destroy();
		node.remove();
	});

	it('a long swipe left removes; right likes; the trailing click is swallowed', () => {
		pointer(node, 'pointerdown', 200, 50);
		pointer(node, 'pointermove', 150, 52);
		pointer(node, 'pointermove', 60, 55);
		expect(node.style.transform).toBe('translateX(-140px)');
		pointer(node, 'pointerup', 60, 55);
		expect(onLeft).toHaveBeenCalledTimes(1);
		expect(onRight).not.toHaveBeenCalled();
		expect(node.style.transform).toBe('');

		const click = vi.fn();
		node.addEventListener('click', click);
		node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		expect(click).not.toHaveBeenCalled();

		pointer(node, 'pointerdown', 50, 50);
		pointer(node, 'pointermove', 200, 50);
		pointer(node, 'pointerup', 200, 50);
		expect(onRight).toHaveBeenCalledTimes(1);
	});

	it('a short swipe snaps back without acting', () => {
		pointer(node, 'pointerdown', 200, 50);
		pointer(node, 'pointermove', 160, 50);
		pointer(node, 'pointerup', 160, 50);
		expect(onLeft).not.toHaveBeenCalled();
		expect(onRight).not.toHaveBeenCalled();
		expect(onUpdate).toHaveBeenLastCalledWith({ side: null, progress: 0, committed: false, dx: 0 });
	});

	it('vertical intent is left alone (scroll / reorder), even if it drifts sideways later', () => {
		pointer(node, 'pointerdown', 200, 50);
		pointer(node, 'pointermove', 202, 80);
		pointer(node, 'pointermove', 60, 90);
		expect(node.style.transform).toBe('');
		pointer(node, 'pointerup', 60, 90);
		expect(onLeft).not.toHaveBeenCalled();
	});

	it('a sideways gesture cancels the native drag; a vertical one does not', () => {
		pointer(node, 'pointerdown', 200, 50);
		pointer(node, 'pointermove', 180, 51);
		const sideways = new MouseEvent('dragstart', { clientX: 180, clientY: 51, bubbles: true, cancelable: true });
		node.dispatchEvent(sideways);
		expect(sideways.defaultPrevented).toBe(true);
		pointer(node, 'pointerup', 180, 51);

		pointer(node, 'pointerdown', 200, 50);
		const vertical = new MouseEvent('dragstart', { clientX: 200, clientY: 80, bubbles: true, cancelable: true });
		node.dispatchEvent(vertical);
		expect(vertical.defaultPrevented).toBe(false);
		pointer(node, 'pointerup', 200, 80);
	});

	it('a right mouse button never starts a swipe', () => {
		pointer(node, 'pointerdown', 200, 50, { pointerType: 'mouse', button: 2 });
		pointer(node, 'pointermove', 60, 50, { pointerType: 'mouse' });
		pointer(node, 'pointerup', 60, 50, { pointerType: 'mouse' });
		expect(onLeft).not.toHaveBeenCalled();
	});
});
