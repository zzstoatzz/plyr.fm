// swipe-to-dismiss attachment for bottom sheets.
//
// the visual handle on a bottom sheet is a near-universal mobile affordance
// (iOS sheets, android bottom sheets) that signals "drag me down to close".
// without this attachment the affordance lies — the handle is decorative and
// the only dismiss is tapping a small × or the backdrop.
//
// usage:
//   <div class="sheet" {@attach swipeToDismiss(() => sheet.close())}>
//     <div class="sheet-handle-area" data-sheet-handle>
//       <div class="sheet-handle"></div>
//     </div>
//     ...
//   </div>
//
// the attachment is applied to the sheet element. it locates its handle by
// `[data-sheet-handle]` and binds pointer listeners there. drag updates the
// sheet's inline transform; release either dismisses (call `onDismiss`) past
// the threshold/velocity, or snaps back by clearing the inline transform.

import type { Attachment } from 'svelte/attachments';

interface SwipeToDismissOptions {
	/** css selector for the drag handle within the sheet (default: `[data-sheet-handle]`) */
	handleSelector?: string;
	/** distance in px past which release dismisses (default: 80) */
	dismissDeltaPx?: number;
	/** downward velocity in px/ms past which release dismisses (default: 0.5) */
	dismissVelocityPxPerMs?: number;
	/** ms to wait before clearing the inline dismiss transform (default: 250, matches sheet transition) */
	dismissResetMs?: number;
}

export function swipeToDismiss(
	onDismiss: () => void,
	options: SwipeToDismissOptions = {}
): Attachment<HTMLElement> {
	const {
		handleSelector = '[data-sheet-handle]',
		dismissDeltaPx = 80,
		dismissVelocityPxPerMs = 0.5,
		dismissResetMs = 250
	} = options;

	return (sheet) => {
		const handle = sheet.querySelector<HTMLElement>(handleSelector);
		if (!handle) return;

		let dragging = false;
		let startY = 0;
		let delta = 0;
		let lastY = 0;
		let lastT = 0;
		let velocity = 0;

		function down(event: PointerEvent) {
			dragging = true;
			startY = event.clientY;
			lastY = event.clientY;
			lastT = event.timeStamp;
			delta = 0;
			velocity = 0;
			handle!.setPointerCapture(event.pointerId);
			sheet.style.transition = 'none';
		}

		function move(event: PointerEvent) {
			if (!dragging) return;
			const d = Math.max(0, event.clientY - startY);
			const dt = event.timeStamp - lastT;
			if (dt > 0) velocity = (event.clientY - lastY) / dt;
			lastY = event.clientY;
			lastT = event.timeStamp;
			delta = d;
			sheet.style.transform = `translateY(${d}px)`;
		}

		function up() {
			if (!dragging) return;
			dragging = false;
			// restore the css transition so snap-back / dismiss animate
			sheet.style.transition = '';
			const shouldDismiss = delta > dismissDeltaPx || velocity > dismissVelocityPxPerMs;
			if (shouldDismiss) {
				// drive the dismiss animation explicitly so it flows from the
				// dragged position out of view, regardless of when the parent's
				// open class flips.
				sheet.style.transform = 'translateY(100%)';
				onDismiss();
				setTimeout(() => {
					sheet.style.transform = '';
				}, dismissResetMs);
			} else {
				// snap back: clear inline transform so the open css rule wins
				sheet.style.transform = '';
			}
		}

		handle.addEventListener('pointerdown', down);
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', up);
		handle.addEventListener('pointercancel', up);

		return () => {
			handle.removeEventListener('pointerdown', down);
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', up);
			handle.removeEventListener('pointercancel', up);
		};
	};
}
