// horizontal-swipe attachment — flip left/right between radio stations.
//
// touch/pen only; mouse users get the pills + arrow keys. activates once motion
// is horizontal-dominant and past the noise floor, so it never steals a tap on
// the artwork link or a vertical page scroll. fires onSwipe('left'|'right') once
// per gesture when released past the distance threshold.
//
// usage:
//   <div {@attach horizontalSwipe((dir) => flip(dir === 'left' ? 'next' : 'prev'))}>...</div>

import type { Attachment } from 'svelte/attachments';

interface HorizontalSwipeOptions {
	/** distance in px past which release fires (default: 60) */
	swipeDeltaPx?: number;
	/** minimum horizontal delta (px) before activation, suppresses taps (default: 10) */
	activationDeltaPx?: number;
}

export function horizontalSwipe(
	onSwipe: (direction: 'left' | 'right') => void,
	options: HorizontalSwipeOptions = {}
): Attachment<HTMLElement> {
	const { swipeDeltaPx = 60, activationDeltaPx = 10 } = options;

	return (node) => {
		let tracking = false;
		let active = false;
		let startX = 0;
		let startY = 0;
		let dx = 0;
		let pointerId = -1;

		function down(event: PointerEvent) {
			if (event.pointerType === 'mouse') return;
			tracking = true;
			active = false;
			startX = event.clientX;
			startY = event.clientY;
			dx = 0;
			pointerId = event.pointerId;
		}

		function move(event: PointerEvent) {
			if (!tracking || event.pointerId !== pointerId) return;
			dx = event.clientX - startX;
			const dy = event.clientY - startY;

			if (!active) {
				if (Math.abs(dx) < activationDeltaPx) return; // below noise floor
				if (Math.abs(dy) > Math.abs(dx)) {
					// vertical-dominant: leave it to the page scroll
					tracking = false;
					return;
				}
				active = true;
			}
		}

		function up(event: PointerEvent) {
			if (!tracking || event.pointerId !== pointerId) return;
			const wasActive = active;
			tracking = false;
			active = false;
			pointerId = -1;
			if (!wasActive) return;
			if (Math.abs(dx) > swipeDeltaPx) onSwipe(dx < 0 ? 'left' : 'right');
		}

		node.addEventListener('pointerdown', down);
		node.addEventListener('pointermove', move);
		node.addEventListener('pointerup', up);
		node.addEventListener('pointercancel', up);

		return () => {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', up);
		};
	};
}
