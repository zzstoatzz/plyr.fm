export type SwipeSide = 'left' | 'right';

export interface SwipeState {
	side: SwipeSide | null;
	/** 0..1 — how far toward the commit threshold the gesture has travelled */
	progress: number;
	committed: boolean;
	dx: number;
}

/** the engaged gesture's state from its horizontal travel against the row width. */
export function resolveSwipe(dx: number, width: number, fraction = 0.35, minPx = 72): SwipeState {
	const distance = Math.abs(dx);
	const threshold = Math.max(minPx, width * fraction);
	return {
		side: dx > 0 ? 'right' : dx < 0 ? 'left' : null,
		progress: Math.min(1, distance / threshold),
		committed: distance >= threshold,
		dx
	};
}

/**
 * where the row actually sits for a given finger travel: one-to-one up to
 * the threshold, then rubber-banding so the row feels like it has mass
 * instead of skating off the screen.
 */
export function displacement(dx: number, width: number, fraction = 0.35, minPx = 72): number {
	const threshold = Math.max(minPx, width * fraction);
	const distance = Math.abs(dx);
	if (distance <= threshold) return dx;
	const overshoot = distance - threshold;
	const damped = threshold + overshoot * (0.3 / (1 + overshoot / width));
	return Math.sign(dx) * damped;
}

const SLOP_PX = 8;
// a swipe wins any contest it plausibly means to win: horizontal engages up to
// ~53° off-axis, because thumbs arc and scrolling has the rest of the screen
const HORIZONTAL_BIAS = 0.75;
const SNAP_BACK = 'transform 260ms cubic-bezier(0.2, 0.9, 0.3, 1.1)';
const SLIDE_OUT = 'transform 180ms cubic-bezier(0.4, 0, 1, 1)';
const IDLE: SwipeState = { side: null, progress: 0, committed: false, dx: 0 };

export interface SwipeParams {
	onLeft?: () => void;
	onRight?: () => void;
	onUpdate?: (_state: SwipeState) => void;
	/** a committed left swipe slides the row out and collapses its wrapper before onLeft */
	dismissLeft?: boolean;
	disabled?: boolean;
	/** selector for descendants that own their own gesture (e.g. a drag handle) */
	ignore?: string;
}

/**
 * Svelte action: drag a row sideways with a finger or a mouse. Vertical
 * intent is left to the browser (scroll) and to the row's own drag handlers;
 * once the gesture is horizontal it owns the pointer, moves the node with
 * resistance past the threshold, and on release either commits or springs
 * back. The click that follows a swipe is swallowed.
 */
export function swipeable(node: HTMLElement, params: SwipeParams = {}) {
	let current = params;
	let pointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let dx = 0;
	let engaged = false;
	let abandoned = false;
	let armed = false;
	let swallowClick = false;
	let settling = false;

	node.style.touchAction = 'pan-y';

	const emit = (state: SwipeState) => current.onUpdate?.(state);

	function reset(transition: string | null) {
		node.style.transition = transition ?? '';
		node.style.transform = '';
		pointerId = null;
		engaged = false;
		abandoned = false;
		armed = false;
		dx = 0;
		emit(IDLE);
	}

	function dismiss(then: () => void) {
		settling = true;
		const wrapper = node.parentElement;
		const height = wrapper?.getBoundingClientRect().height ?? 0;
		node.style.transition = SLIDE_OUT;
		node.style.transform = `translateX(${-node.offsetWidth - 16}px)`;
		const collapse = () => {
			if (wrapper && height) {
				wrapper.style.height = `${height}px`;
				wrapper.style.overflow = 'hidden';
				wrapper.style.transition = 'height 160ms ease-out, margin 160ms ease-out';
				requestAnimationFrame(() => {
					wrapper.style.height = '0px';
					wrapper.style.marginBottom = '-0.5rem';
				});
				setTimeout(finish, 170);
			} else {
				finish();
			}
		};
		const finish = () => {
			settling = false;
			then();
			// the keyed list may hand these nodes to a future row — leave no trace
			requestAnimationFrame(() => {
				if (wrapper) {
					wrapper.style.height = '';
					wrapper.style.overflow = '';
					wrapper.style.transition = '';
					wrapper.style.marginBottom = '';
				}
				node.style.transition = '';
				node.style.transform = '';
			});
		};
		setTimeout(collapse, 180);
	}

	function onPointerDown(e: PointerEvent) {
		// a swallow only applies to the click that trails a swipe, never to a new gesture
		swallowClick = false;
		if (current.disabled || settling || pointerId !== null) return;
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		if (current.ignore && e.target instanceof Element && e.target.closest(current.ignore)) return;
		pointerId = e.pointerId;
		startX = e.clientX;
		startY = e.clientY;
		dx = 0;
		engaged = false;
		abandoned = false;
		armed = false;
		node.style.transition = '';
	}

	function onPointerMove(e: PointerEvent) {
		if (e.pointerId !== pointerId || abandoned) return;
		dx = e.clientX - startX;
		const dy = e.clientY - startY;
		if (!engaged) {
			// wait out the thumb's opening wobble, then decide ONCE by angle —
			// an early vertical blip must not steal a horizontal swipe
			if (Math.hypot(dx, dy) < SLOP_PX) return;
			if (Math.abs(dx) < Math.abs(dy) * HORIZONTAL_BIAS) {
				abandoned = true;
				return;
			}
			engaged = true;
			node.setPointerCapture?.(e.pointerId);
		}
		e.preventDefault();
		const width = node.offsetWidth;
		node.style.transform = `translateX(${displacement(dx, width)}px)`;
		const state = resolveSwipe(dx, width);
		if (state.committed !== armed) {
			armed = state.committed;
			if (armed) navigator.vibrate?.(8);
		}
		emit(state);
	}

	function onPointerUp(e: PointerEvent) {
		if (e.pointerId !== pointerId) return;
		if (!engaged) {
			pointerId = null;
			abandoned = false;
			return;
		}
		const state = resolveSwipe(dx, node.offsetWidth);
		swallowClick = true;
		if (state.committed && state.side === 'left' && current.dismissLeft) {
			pointerId = null;
			engaged = false;
			dismiss(() => {
				emit(IDLE);
				current.onLeft?.();
			});
			return;
		}
		reset(SNAP_BACK);
		if (state.committed && state.side === 'right') current.onRight?.();
		if (state.committed && state.side === 'left') current.onLeft?.();
	}

	function onPointerCancel(e: PointerEvent) {
		if (e.pointerId !== pointerId) return;
		reset(SNAP_BACK);
	}

	// the row is also HTML5-draggable for reordering; a sideways gesture is ours
	function onDragStart(e: DragEvent) {
		if (engaged || (pointerId !== null && Math.abs(dx) > Math.abs(e.clientY - startY))) {
			e.preventDefault();
		}
	}

	function onClick(e: MouseEvent) {
		if (!swallowClick) return;
		swallowClick = false;
		e.stopPropagation();
		e.preventDefault();
	}

	node.addEventListener('pointerdown', onPointerDown);
	node.addEventListener('pointermove', onPointerMove);
	node.addEventListener('pointerup', onPointerUp);
	node.addEventListener('pointercancel', onPointerCancel);
	node.addEventListener('dragstart', onDragStart);
	node.addEventListener('click', onClick, true);

	return {
		update(next: SwipeParams) {
			current = next;
		},
		destroy() {
			node.removeEventListener('pointerdown', onPointerDown);
			node.removeEventListener('pointermove', onPointerMove);
			node.removeEventListener('pointerup', onPointerUp);
			node.removeEventListener('pointercancel', onPointerCancel);
			node.removeEventListener('dragstart', onDragStart);
			node.removeEventListener('click', onClick, true);
		}
	};
}
