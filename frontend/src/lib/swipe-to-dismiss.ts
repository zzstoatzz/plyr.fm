import type { Attachment } from 'svelte/attachments';

export function swipeToDismiss(onDismiss: () => void): Attachment<HTMLElement> {
	return (sheet) => {
		let pointerId: number | null = null;
		let startX = 0;
		let startY = 0;
		let delta = 0;
		let lastY = 0;
		let lastT = 0;
		let velocity = 0;
		let active = false;
		let swallowClick = false;

		function reset() {
			const captured = pointerId;
			pointerId = null;
			active = false;
			sheet.style.transition = '';
			sheet.style.transform = '';
			if (captured !== null && sheet.hasPointerCapture?.(captured)) {
				sheet.releasePointerCapture(captured);
			}
		}

		function down(event: PointerEvent) {
			if (pointerId !== null || event.button !== 0) return;
			if (!(event.target instanceof Element) || !event.target.closest('[data-sheet-handle]'))
				return;
			swallowClick = false;
			pointerId = event.pointerId;
			startX = event.clientX;
			startY = lastY = event.clientY;
			lastT = event.timeStamp;
			delta = velocity = 0;
		}

		function move(event: PointerEvent) {
			if (event.pointerId !== pointerId) return;
			const dx = event.clientX - startX;
			const dy = event.clientY - startY;
			if (!active) {
				if (Math.hypot(dx, dy) < 6) return;
				swallowClick = true;
				if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
					reset();
					return;
				}
				active = true;
				sheet.setPointerCapture?.(event.pointerId);
				sheet.style.transition = 'none';
			}
			const dt = event.timeStamp - lastT;
			if (dt > 0) velocity = (event.clientY - lastY) / dt;
			lastY = event.clientY;
			lastT = event.timeStamp;
			delta = Math.max(0, dy);
			sheet.style.transform = `translateY(${delta}px)`;
		}

		function up(event: PointerEvent) {
			if (event.pointerId !== pointerId) return;
			const freshVelocity = event.timeStamp - lastT < 100 ? velocity : 0;
			const dismiss = active && (delta > 80 || (delta > 6 && freshVelocity > 0.5));
			reset();
			if (dismiss) onDismiss();
		}

		function cancel(event: PointerEvent) {
			if (event.type === 'lostpointercapture' && event.target !== sheet) return;
			if (event.pointerId === pointerId) reset();
		}

		function click(event: MouseEvent) {
			if (!swallowClick || event.detail === 0) return;
			swallowClick = false;
			event.preventDefault();
			event.stopPropagation();
		}

		sheet.addEventListener('pointerdown', down);
		sheet.addEventListener('pointermove', move);
		sheet.addEventListener('pointerup', up);
		sheet.addEventListener('pointercancel', cancel);
		sheet.addEventListener('lostpointercapture', cancel);
		sheet.addEventListener('click', click, true);

		return () => {
			reset();
			sheet.removeEventListener('pointerdown', down);
			sheet.removeEventListener('pointermove', move);
			sheet.removeEventListener('pointerup', up);
			sheet.removeEventListener('pointercancel', cancel);
			sheet.removeEventListener('lostpointercapture', cancel);
			sheet.removeEventListener('click', click, true);
		};
	};
}
