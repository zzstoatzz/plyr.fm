import type { Attachment } from 'svelte/attachments';

interface DrawerGestureOptions {
	enabled?: boolean;
	scrollSelector?: string;
}

export function swipeToDismiss(
	onDismiss: () => void,
	{ enabled = true, scrollSelector = '.sheet-content' }: DrawerGestureOptions = {}
): Attachment<HTMLElement> {
	return (sheet) => {
		if (!enabled) return;
		let id: number | null = null;
		let source: 'touch' | 'pointer' | null = null;
		let startX = 0;
		let startY = 0;
		let lastY = 0;
		let lastTime = 0;
		let delta = 0;
		let velocity = 0;
		let dragging = false;
		let swallowClick = false;
		let animation: Animation | null = null;
		let disposed = false;
		let dismissed = false;
		sheet.style.translate = '';
		sheet.style.transition = '';

		function reset() {
			id = null;
			source = null;
			dragging = false;
			sheet.style.translate = '';
			sheet.style.transition = '';
		}

		function begin(target: EventTarget | null, x: number, y: number, time: number): boolean {
			if (id !== null || animation || !(target instanceof Element)) return false;
			swallowClick = false;
			if (
				target.closest('input, textarea, select, [contenteditable="true"], [data-no-drawer-drag]')
			)
				return false;
			const scroller = target.closest<HTMLElement>(scrollSelector);
			if (scroller && scroller.scrollTop > 0) return false;
			startX = x;
			startY = lastY = y;
			lastTime = time;
			delta = velocity = 0;
			return true;
		}

		function move(x: number, y: number, time: number): boolean {
			const dx = x - startX;
			const dy = y - startY;
			if (!dragging) {
				if (dy < 0 || Math.abs(dx) > Math.max(4, Math.abs(dy))) {
					reset();
					return false;
				}
				if (dy === 0) return false;
				dragging = true;
				swallowClick = true;
				sheet.style.transition = 'none';
			}
			const elapsed = time - lastTime;
			if (elapsed > 0) velocity = (y - lastY) / elapsed;
			lastY = y;
			lastTime = time;
			delta = Math.max(0, dy);
			sheet.style.translate = `0 ${delta}px`;
			return true;
		}

		function finish(time: number, cancelled = false) {
			if (id === null) return;
			const wasDragging = dragging;
			id = null;
			source = null;
			dragging = false;
			if (!wasDragging) return;
			const freshVelocity = time - lastTime < 100 ? velocity : 0;
			const threshold = Math.min(100, Math.max(48, sheet.getBoundingClientRect().height * 0.25));
			const dismiss = !cancelled && (delta >= threshold || (delta > 12 && freshVelocity > 0.5));
			const destination = dismiss
				? Math.max(delta, window.innerHeight - sheet.getBoundingClientRect().top + delta)
				: 0;
			const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;
			animation = sheet.animate(
				[{ translate: `0 ${delta}px` }, { translate: `0 ${destination}px` }],
				{ duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' }
			);
			void animation.finished
				.then(() => {
					if (disposed) return;
					if (dismiss) {
						dismissed = true;
						sheet.style.translate = `0 ${destination}px`;
					} else {
						reset();
					}
					animation?.cancel();
					animation = null;
					if (dismiss) onDismiss();
				})
				.catch(() => {});
		}

		function touchStart(event: TouchEvent) {
			if (event.touches.length !== 1) {
				finish(event.timeStamp, true);
				return;
			}
			const touch = event.touches[0];
			if (!begin(event.target, touch.clientX, touch.clientY, event.timeStamp)) return;
			id = touch.identifier;
			source = 'touch';
		}

		function touchMove(event: TouchEvent) {
			if (source !== 'touch') return;
			const touch = Array.from(event.touches).find((touch) => touch.identifier === id);
			if (!touch) return;
			if (!event.cancelable) {
				finish(event.timeStamp, true);
				return;
			}
			if (move(touch.clientX, touch.clientY, event.timeStamp)) event.preventDefault();
		}

		function touchEnd(event: TouchEvent) {
			if (
				source !== 'touch' ||
				!Array.from(event.changedTouches).some((touch) => touch.identifier === id)
			)
				return;
			finish(event.timeStamp, event.type === 'touchcancel');
		}

		function pointerDown(event: PointerEvent) {
			if (event.pointerType === 'touch' || event.button !== 0) return;
			if (!begin(event.target, event.clientX, event.clientY, event.timeStamp)) return;
			id = event.pointerId;
			source = 'pointer';
		}

		function pointerMove(event: PointerEvent) {
			if (source !== 'pointer' || event.pointerId !== id) return;
			if (move(event.clientX, event.clientY, event.timeStamp)) {
				event.preventDefault();
				sheet.setPointerCapture?.(event.pointerId);
			}
		}

		function pointerEnd(event: PointerEvent) {
			if (source !== 'pointer' || event.pointerId !== id) return;
			if (event.type === 'lostpointercapture' && event.target !== sheet) return;
			finish(event.timeStamp, event.type !== 'pointerup');
		}

		function dragStart(event: DragEvent) {
			if (dragging) event.preventDefault();
		}

		function click(event: MouseEvent) {
			if (!swallowClick || event.detail === 0) return;
			swallowClick = false;
			event.preventDefault();
			event.stopPropagation();
		}

		sheet.addEventListener('touchstart', touchStart, { passive: true });
		sheet.addEventListener('touchmove', touchMove, { passive: false });
		sheet.addEventListener('touchend', touchEnd);
		sheet.addEventListener('touchcancel', touchEnd);
		sheet.addEventListener('pointerdown', pointerDown);
		window.addEventListener('pointermove', pointerMove);
		window.addEventListener('pointerup', pointerEnd);
		window.addEventListener('pointercancel', pointerEnd);
		sheet.addEventListener('lostpointercapture', pointerEnd);
		sheet.addEventListener('click', click, true);
		sheet.addEventListener('dragstart', dragStart);
		return () => {
			disposed = true;
			animation?.cancel();
			if (!dismissed) reset();
			sheet.removeEventListener('touchstart', touchStart);
			sheet.removeEventListener('touchmove', touchMove);
			sheet.removeEventListener('touchend', touchEnd);
			sheet.removeEventListener('touchcancel', touchEnd);
			sheet.removeEventListener('pointerdown', pointerDown);
			window.removeEventListener('pointermove', pointerMove);
			window.removeEventListener('pointerup', pointerEnd);
			window.removeEventListener('pointercancel', pointerEnd);
			sheet.removeEventListener('lostpointercapture', pointerEnd);
			sheet.removeEventListener('click', click, true);
			sheet.removeEventListener('dragstart', dragStart);
		};
	};
}
