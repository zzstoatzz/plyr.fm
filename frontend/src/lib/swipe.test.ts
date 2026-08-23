import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { displacement, resolveSwipe, swipeable, type SwipeState } from './swipe';

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

function pointer(node: HTMLElement, type: string, x: number, y: number, extra: PointerEventInit = {}) {
	node.dispatchEvent(
		new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', bubbles: true, cancelable: true, ...extra })
	);
}

describe('displacement', () => {
	it('follows the finger to the threshold, then resists', () => {
		expect(displacement(50, 300)).toBe(50);
		expect(displacement(-105, 300)).toBe(-105);
		const past = displacement(205, 300);
		expect(past).toBeGreaterThan(105);
		expect(past).toBeLessThan(145);
		// resistance grows with overshoot
		expect(displacement(405, 300) - displacement(305, 300)).toBeLessThan(displacement(305, 300) - displacement(205, 300));
	});
});

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
		expect(node.style.transform).toBe(`translateX(${displacement(-140, 300)}px)`);
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

	it('a swipe with no trailing click does not eat the next tap', () => {
		pointer(node, 'pointerdown', 200, 50);
		pointer(node, 'pointermove', 60, 50);
		pointer(node, 'pointerup', 60, 50);
		expect(onLeft).toHaveBeenCalledTimes(1);
		// touch: no click follows the swipe. the next tap must get through.
		const click = vi.fn();
		node.addEventListener('click', click);
		pointer(node, 'pointerdown', 120, 50);
		pointer(node, 'pointerup', 120, 50);
		node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		expect(click).toHaveBeenCalledTimes(1);
	});

	it('a gesture that starts on an ignored descendant is not a swipe', () => {
		action.destroy();
		const handle = document.createElement('button');
		handle.className = 'drag-handle';
		node.appendChild(handle);
		action = swipeable(node, { onLeft, onRight, onUpdate, ignore: '.drag-handle' });
		handle.dispatchEvent(
			new PointerEvent('pointerdown', { clientX: 200, clientY: 50, pointerId: 1, pointerType: 'touch', bubbles: true })
		);
		pointer(node, 'pointermove', 60, 50);
		pointer(node, 'pointerup', 60, 50);
		expect(onLeft).not.toHaveBeenCalled();
		expect(node.style.transform).toBe('');
	});

	it('with dismissLeft, a committed left swipe slides out and collapses before removing', () => {
		vi.useFakeTimers();
		action.destroy();
		const wrapper = document.createElement('div');
		Object.defineProperty(wrapper, 'getBoundingClientRect', { value: () => ({ height: 64 }) });
		document.body.appendChild(wrapper);
		wrapper.appendChild(node);
		action = swipeable(node, { onLeft, onUpdate, dismissLeft: true });
		pointer(node, 'pointerdown', 200, 50);
		pointer(node, 'pointermove', 40, 50);
		pointer(node, 'pointerup', 40, 50);
		expect(node.style.transform).toBe('translateX(-316px)');
		expect(onLeft).not.toHaveBeenCalled();
		vi.advanceTimersByTime(180);
		expect(wrapper.style.height).toBe('64px');
		vi.advanceTimersByTime(200);
		expect(onLeft).toHaveBeenCalledTimes(1);
		expect(onUpdate).toHaveBeenLastCalledWith({ side: null, progress: 0, committed: false, dx: 0 });
		vi.useRealTimers();
		wrapper.remove();
	});

	it('crossing the threshold arms once and emits committed', () => {
		pointer(node, 'pointerdown', 200, 50);
		pointer(node, 'pointermove', 120, 50);
		expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ committed: false }));
		pointer(node, 'pointermove', 80, 50);
		expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ committed: true, side: 'left' }));
		pointer(node, 'pointerup', 80, 50);
	});

	it('a right mouse button never starts a swipe', () => {
		pointer(node, 'pointerdown', 200, 50, { pointerType: 'mouse', button: 2 });
		pointer(node, 'pointermove', 60, 50, { pointerType: 'mouse' });
		pointer(node, 'pointerup', 60, 50, { pointerType: 'mouse' });
		expect(onLeft).not.toHaveBeenCalled();
	});
});
