// swipe-to-dismiss attachment for bottom sheets — instagram-comments style.
//
// gesture activates anywhere on the sheet, but only when the inner scroller is
// pinned at the top. once the user has scrolled into the content, a downward
// swipe scrolls (browser default) rather than dragging the sheet. when scroll
// is at top, a downward swipe drags the sheet; release past the threshold or
// at sufficient velocity dismisses.
//
// usage:
//   <div class="sheet" {@attach swipeToDismiss(() => sheet.close())}>
//     ...
//     <div class="sheet-content">...</div>
//   </div>
//
// the attachment binds on the sheet element; it locates the inner scroller via
// `scrollSelector` (default `.sheet-content`) to gate activation.

import type { Attachment } from 'svelte/attachments';

interface SwipeToDismissOptions {
	/** css selector for the inner scroll container that gates activation (default: `.sheet-content`) */
	scrollSelector?: string;
	/** distance in px past which release dismisses (default: 80) */
	dismissDeltaPx?: number;
	/** downward velocity in px/ms past which release dismisses (default: 0.5) */
	dismissVelocityPxPerMs?: number;
	/** ms to wait before clearing the inline dismiss transform (default: 250, matches sheet transition) */
	dismissResetMs?: number;
	/** minimum vertical delta (px) before activation, used to suppress accidental drags from taps (default: 6) */
	activationDeltaPx?: number;
}

export function swipeToDismiss(
	onDismiss: () => void,
	options: SwipeToDismissOptions = {}
): Attachment<HTMLElement> {
	const {
		scrollSelector = '.sheet-content',
		dismissDeltaPx = 80,
		dismissVelocityPxPerMs = 0.5,
		dismissResetMs = 250,
		activationDeltaPx = 6
	} = options;

	return (sheet) => {
		let tracking = false;
		let active = false;
		let startX = 0;
		let startY = 0;
		let delta = 0;
		let lastY = 0;
		let lastT = 0;
		let velocity = 0;
		let scroller: HTMLElement | null = null;
		let pointerId = -1;

		function findScroller(): HTMLElement | null {
			return sheet.querySelector<HTMLElement>(scrollSelector);
		}

		function scrollAtTop(): boolean {
			// no scroller (single-page sheet) ⇒ always at top
			return !scroller || scroller.scrollTop <= 0;
		}

		function down(event: PointerEvent) {
			// only react to touch/pen drags; mouse users have the close button + backdrop + escape
			if (event.pointerType === 'mouse') return;
			tracking = true;
			active = false;
			scroller = findScroller();
			startX = event.clientX;
			startY = event.clientY;
			lastY = event.clientY;
			lastT = event.timeStamp;
			delta = 0;
			velocity = 0;
			pointerId = event.pointerId;
		}

		function activate(event: PointerEvent) {
			active = true;
			try {
				sheet.setPointerCapture(event.pointerId);
			} catch {
				// pointer may have been released between move events; ignore
			}
			sheet.style.transition = 'none';
		}

		function move(event: PointerEvent) {
			if (!tracking || event.pointerId !== pointerId) return;
			const dx = event.clientX - startX;
			const dy = event.clientY - startY;

			if (!active) {
				// not yet activated — decide whether to take over
				if (Math.abs(dy) < activationDeltaPx) return; // below noise floor
				if (Math.abs(dx) > Math.abs(dy)) {
					// horizontal-dominant: not a dismiss gesture
					tracking = false;
					return;
				}
				if (dy <= 0) {
					// upward: never a dismiss
					tracking = false;
					return;
				}
				if (!scrollAtTop()) {
					// downward but scroller has scrolled — let the browser scroll
					tracking = false;
					return;
				}
				activate(event);
			}

			const d = Math.max(0, dy);
			const dt = event.timeStamp - lastT;
			if (dt > 0) velocity = (event.clientY - lastY) / dt;
			lastY = event.clientY;
			lastT = event.timeStamp;
			delta = d;
			sheet.style.transform = `translateY(${d}px)`;
		}

		function up(event: PointerEvent) {
			if (!tracking || event.pointerId !== pointerId) return;
			const wasActive = active;
			tracking = false;
			active = false;
			pointerId = -1;
			if (!wasActive) return;

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

		sheet.addEventListener('pointerdown', down);
		sheet.addEventListener('pointermove', move);
		sheet.addEventListener('pointerup', up);
		sheet.addEventListener('pointercancel', up);

		return () => {
			sheet.removeEventListener('pointerdown', down);
			sheet.removeEventListener('pointermove', move);
			sheet.removeEventListener('pointerup', up);
			sheet.removeEventListener('pointercancel', up);
		};
	};
}
