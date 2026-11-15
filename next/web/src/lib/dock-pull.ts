export type DockPull = ReturnType<typeof createDockPull>;
export type DockPullUpdate = { distance: number; released: boolean; open: boolean };

export function createDockPull(open: () => void, preload: () => void) {
	let pull: DockPullUpdate | undefined;
	let listener: ((pull: DockPullUpdate) => void) | undefined;

	function publish(next: DockPullUpdate) {
		pull = next;
		listener?.(next);
	}

	function connect(receive: typeof listener) {
		listener = receive;
		if (pull) receive?.(pull);
		return () => { listener = undefined; pull = undefined; };
	}

	function attach(button: HTMLButtonElement) {
		const phone = matchMedia('(max-width: 720px)');
		const reduced = matchMedia('(prefers-reduced-motion: reduce)');
		let start: { x: number; y: number } | undefined;
		let rest: number | undefined;

		function begin(event: TouchEvent) {
			if (event.touches.length !== 1) { release(false); return; }
			if (!phone.matches) return;
			preload();
			const { clientX: x, clientY: y } = event.touches[0];
			start = { x, y };
		}

		function move(event: TouchEvent) {
			if (!start) return;
			if (event.touches.length !== 1) { release(false); return; }
			const { clientX, clientY } = event.touches[0];
			const up = start.y - clientY;
			const across = Math.abs(clientX - start.x);
			if (rest === undefined && (up < -10 || across > 10 && across >= up)) { start = undefined; return; }
			if (rest === undefined && up <= Math.max(10, 1.5 * across)) return;
			if (!event.cancelable) { release(false); return; }
			event.preventDefault();
			if (rest === undefined) {
				rest = button.closest('[data-testid="player-dock"]')?.getBoundingClientRect().top ?? innerHeight;
				publish({ distance: Math.min(rest, up), released: false, open: false });
				if (!reduced.matches) open();
			} else publish({ distance: Math.min(rest, Math.max(up, 0)), released: false, open: false });
		}

		function release(allowOpen: boolean) {
			start = undefined;
			if (rest === undefined || !pull) return;
			const shouldOpen = allowOpen && pull.distance >= Math.min(120, innerHeight * 0.16);
			const last = { distance: pull.distance, released: true, open: shouldOpen };
			rest = undefined;
			if (reduced.matches) {
				pull = undefined;
				if (shouldOpen) open();
			} else publish(last);
		}

		const end = () => release(true);
		const cancel = () => release(false);
		button.addEventListener('touchstart', begin, { passive: true });
		button.addEventListener('touchmove', move, { passive: false });
		button.addEventListener('touchend', end);
		button.addEventListener('touchcancel', cancel);
		return () => {
			cancel();
			button.removeEventListener('touchstart', begin);
			button.removeEventListener('touchmove', move);
			button.removeEventListener('touchend', end);
			button.removeEventListener('touchcancel', cancel);
		};
	}

	return { attach, connect };
}
