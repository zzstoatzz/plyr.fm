export type SwipeSide = 'left' | 'right';

export interface SwipeState {
	side: SwipeSide | null;
	/** 0..1 — how far toward the commit threshold the row has travelled */
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

const ENGAGE_PX = 6;
const IDLE: SwipeState = { side: null, progress: 0, committed: false, dx: 0 };

export interface SwipeParams {
	onLeft?: () => void;
	onRight?: () => void;
	onUpdate?: (_state: SwipeState) => void;
	disabled?: boolean;
}

/**
 * Svelte action: drag a row sideways with a finger or a mouse. Vertical
 * intent is left to the browser (scroll) and to the row's own drag handlers;
 * once the gesture is horizontal it owns the pointer, translates the node,
 * and on release either commits (past the threshold) or snaps back. The
 * click that follows a swipe is swallowed.
 */
export function swipeable(node: HTMLElement, params: SwipeParams = {}) {
	let current = params;
	let pointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let dx = 0;
	let engaged = false;
	let abandoned = false;
	let swallowClick = false;

	node.style.touchAction = 'pan-y';

	const emit = (state: SwipeState) => current.onUpdate?.(state);

	function reset(animate: boolean) {
		node.style.transition = animate ? 'transform 180ms ease-out' : '';
		node.style.transform = '';
		pointerId = null;
		engaged = false;
		abandoned = false;
		dx = 0;
		emit(IDLE);
	}

	function onPointerDown(e: PointerEvent) {
		if (current.disabled || pointerId !== null) return;
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		pointerId = e.pointerId;
		startX = e.clientX;
		startY = e.clientY;
		dx = 0;
		engaged = false;
		abandoned = false;
		node.style.transition = '';
	}

	function onPointerMove(e: PointerEvent) {
		if (e.pointerId !== pointerId || abandoned) return;
		dx = e.clientX - startX;
		const dy = e.clientY - startY;
		if (!engaged) {
			if (Math.abs(dy) > ENGAGE_PX && Math.abs(dy) >= Math.abs(dx)) {
				abandoned = true;
				return;
			}
			if (Math.abs(dx) <= ENGAGE_PX) return;
			engaged = true;
			node.setPointerCapture?.(e.pointerId);
		}
		e.preventDefault();
		node.style.transform = `translateX(${dx}px)`;
		emit(resolveSwipe(dx, node.offsetWidth));
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
		reset(true);
		if (state.committed && state.side === 'right') current.onRight?.();
		if (state.committed && state.side === 'left') current.onLeft?.();
	}

	function onPointerCancel(e: PointerEvent) {
		if (e.pointerId !== pointerId) return;
		reset(true);
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
