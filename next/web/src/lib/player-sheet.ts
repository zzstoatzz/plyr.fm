import type { DockPull, DockPullUpdate } from './dock-pull';
import { dismissPlayerPull, pullDirection } from '@plyr/next-core/behaviors/player-pull';

export function playerSheet(panel: HTMLElement, close: () => void, dockPull?: DockPull) {
	const sheet = panel.closest('dialog');
	if (!sheet) return;
	const dialog = sheet;
	const phone = matchMedia('(max-width: 720px)');
	const reduced = matchMedia('(prefers-reduced-motion: reduce)');
	const dock = document.querySelector<HTMLElement>('[data-testid="player-dock"]');
	const pairs = [
		{ expanded: panel.querySelector<HTMLElement>('[data-testid="now-playing-artwork"]'), docked: dock?.querySelector<HTMLElement>('.cover'), art: true },
		{ expanded: panel.querySelector<HTMLElement>('[data-testid="now-playing-title"]'), docked: dock?.querySelector<HTMLElement>('.description strong'), art: false }
	];
	let flights: { expanded: HTMLElement; docked: HTMLElement; bounds: DOMRect; x: number; y: number; scale: number; art: boolean }[] = [];
	let rest = innerHeight;
	let position = 0;
	let target = 0;
	let frame = 0;
	let coastFrame = 0;
	let finishTimeout: ReturnType<typeof setTimeout> | undefined;
	let closing = false;
	let ready = false;
	let pendingPull: DockPullUpdate | undefined;
	let touch: { x: number; y: number; lastY: number; time: number; speed: number; scroll: number; header: boolean; captured: boolean } | undefined;

	function measure() {
		rest = dock?.getBoundingClientRect().top ?? innerHeight;
		flights = dialog.scrollTop > 1 || reduced.matches ? [] : pairs.flatMap(({ expanded, docked, art }) => {
			if (!expanded || !docked?.isConnected) return [];
			const from = expanded.getBoundingClientRect();
			const to = docked.getBoundingClientRect();
			if (!from.width || !to.width) return [];
			const scale = art ? to.width / from.width : parseFloat(getComputedStyle(docked).fontSize) / parseFloat(getComputedStyle(expanded).fontSize);
			return [{ expanded, docked, bounds: from, x: to.left - from.left, y: to.top - from.top - rest, scale, art }];
		});
	}

	function render(next: number) {
		position = next;
		panel.style.transform = next ? `translateY(${next}px)` : '';
		const progress = Math.min(1, next / Math.max(1, rest));
		const phase = Math.max(0, (progress - 0.6) / 0.4);
		const horizontal = phase * phase * (3 - 2 * phase);
		dialog.style.setProperty('--player-backdrop', String(0.18 * Math.min(1, (1 - progress) / 0.15)));
		const art = flights.find(flight => flight.art);
		for (const flight of flights) {
			const { expanded, docked, bounds, x, y, scale } = flight;
			const size = 1 - (1 - scale) * progress;
			let lift = 0;
			if (art && !flight.art) {
				const artSize = 1 - (1 - art.scale) * progress;
				const horizontalOverlap = art.bounds.left + art.x * horizontal + art.bounds.width * artSize - (bounds.left + x * horizontal);
				const artBottom = art.bounds.top + art.y * progress + art.bounds.height * artSize;
				lift = Math.max(0, artBottom + 8 - (bounds.top + y * progress)) * Math.min(1, Math.max(0, horizontalOverlap / 24));
			}
			docked.style.visibility = next ? 'hidden' : '';
			expanded.style.transform = next ? `translate(${x * horizontal}px, ${y * progress + lift}px) scale(${size})` : '';
		}
	}

	function stopFrame() {
		cancelAnimationFrame(frame);
		frame = 0;
		clearTimeout(finishTimeout);
	}

	function settle(to: number, finish?: () => void) {
		stopFrame();
		if (reduced.matches) { render(to); finish?.(); return; }
		const from = position;
		const start = performance.now();
		const duration = 330;
		const done = () => { stopFrame(); render(to); finish?.(); };
		const animate = (now: number) => {
			const fraction = Math.min(1, Math.max(0, (now - start) / duration));
			if (fraction >= 1) { done(); return; }
			const ease = 1 - (1 - fraction) ** 3;
			render(from + (to - from) * ease);
			frame = requestAnimationFrame(animate);
		};
		frame = requestAnimationFrame(animate);
		finishTimeout = setTimeout(done, 900);
	}

	function dismiss() {
		if (closing) return;
		cancelAnimationFrame(coastFrame);
		touch = undefined;
		closing = true;
		if (!phone.matches || reduced.matches || !ready) { close(); return; }
		if (!position) {
			measure();
			rest += dialog.scrollTop;
		}
		settle(rest, close);
	}

	function fromDock(pull: DockPullUpdate) {
		if (closing) return;
		if (!ready) { pendingPull = pull; return; }
		queueRender(rest - pull.distance);
		if (pull.released) {
			render(target);
			if (pull.open) settle(0);
			else dismiss();
		}
	}

	function queueRender(next: number) {
		target = Math.min(rest, Math.max(0, next));
		if (!frame && (target || position)) frame = requestAnimationFrame(() => { frame = 0; render(target); });
	}

	function reset() {
		touch = undefined;
		cancelAnimationFrame(coastFrame);
		if (!closing && (position || frame)) settle(0);
	}

	function begin(event: TouchEvent) {
		cancelAnimationFrame(coastFrame);
		if (event.touches.length !== 1) { if (touch) reset(); return; }
		if (!ready || closing || frame || !phone.matches || !(event.target instanceof Element) ||
			!panel.contains(event.target) || event.target.closest('button, a, input, textarea, select, [data-player-no-pull]')) return;
		const { clientX: x, clientY: y } = event.touches[0];
		const header = !!event.target.closest('[data-player-header]');
		const scroll = Math.max(0, dialog.scrollTop);
		// Leave scrolling to the browser when this touch cannot reach the top.
		if (!header && scroll > dialog.getBoundingClientRect().bottom - y) return;
		touch = { x, y, lastY: y, time: event.timeStamp, speed: 0, scroll, header, captured: false };
		target = 0;
	}

	function move(event: TouchEvent) {
		if (!touch) return;
		if (event.touches.length !== 1) { reset(); return; }
		const { clientX: x, clientY: y } = event.touches[0];
		const dy = y - touch.y;
		if (!touch.captured) {
			const direction = pullDirection(x - touch.x, dy);
			if (direction === 'blocked') { touch = undefined; return; }
			if (direction === 'waiting') return;
			touch.captured = true;
		}
		if (!event.cancelable) { reset(); return; }
		event.preventDefault();
		const distance = dy - (touch.header ? 0 : touch.scroll);
		if (!touch.header && touch.scroll > 0) dialog.scrollTop = Math.max(0, -distance);
		if (!target && !position && distance > 0) {
			measure();
			if (touch.header) rest += dialog.scrollTop;
		}
		touch.speed = (y - touch.lastY) / Math.max(1, event.timeStamp - touch.time);
		touch.time = event.timeStamp;
		touch.lastY = y;
		queueRender(distance);
	}

	function end(event: TouchEvent) {
		if (!touch) return;
		if (event.touches.length) { reset(); return; }
		const speed = event.timeStamp - touch.time < 90 ? touch.speed : 0;
		if (!touch.captured || !dismissPlayerPull(target, speed, innerHeight, touch.header)) {
			const coast = touch.captured && !touch.header && !target && dialog.scrollTop > 0;
			reset();
			if (coast && !reduced.matches && Math.abs(speed) >= 0.12) coastScroll(speed);
			return;
		}
		render(target);
		dismiss();
	}

	function coastScroll(speed: number) {
		const start = performance.now();
		const origin = dialog.scrollTop;
		const duration = 260;
		const distance = Math.min(2.5, Math.max(-2.5, speed)) * duration / 3;
		const tick = (now: number) => {
			const time = Math.min(1, Math.max(0, (now - start) / duration));
			dialog.scrollTop = origin - distance * (1 - (1 - time) ** 3);
			if (time < 1 && dialog.scrollTop > 0) coastFrame = requestAnimationFrame(tick);
		};
		coastFrame = requestAnimationFrame(tick);
	}

	const disconnect = dockPull?.connect(fromDock);
	const dialogOpen = new MutationObserver(onOpen);
	function onOpen() {
		if (!dialog.open || ready || closing) return;
		dialogOpen.disconnect();
		ready = true;
		if (!phone.matches || reduced.matches) return;
		measure();
		if (pendingPull) {
			render(rest - pendingPull.distance);
			fromDock(pendingPull);
			pendingPull = undefined;
		} else { render(rest); settle(0); }
	}
	if (dialog.open) onOpen();
	else dialogOpen.observe(dialog, { attributes: true, attributeFilter: ['open'] });

	dialog.addEventListener('touchstart', begin, { passive: true });
	panel.addEventListener('touchmove', move, { passive: false });
	panel.addEventListener('touchend', end);
	panel.addEventListener('touchcancel', reset);
	window.addEventListener('resize', reset);
	function destroy() {
		stopFrame();
		cancelAnimationFrame(coastFrame);
		dialogOpen.disconnect();
		disconnect?.();
		dialog.removeEventListener('touchstart', begin);
		panel.removeEventListener('touchmove', move);
		panel.removeEventListener('touchend', end);
		panel.removeEventListener('touchcancel', reset);
		window.removeEventListener('resize', reset);
		render(0);
		dialog.style.removeProperty('--player-backdrop');
	}
	return { dismiss, destroy };
}
