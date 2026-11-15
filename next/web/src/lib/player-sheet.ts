import type { DockPull, DockPullUpdate } from './dock-pull';

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
	let flights: { expanded: HTMLElement; docked: HTMLElement; x: number; y: number; scale: number }[] = [];
	let rest = innerHeight;
	let position = 0;
	let target = 0;
	let frame = 0;
	let finishTimeout: ReturnType<typeof setTimeout> | undefined;
	let closing = false;
	let ready = false;
	let pendingPull: DockPullUpdate | undefined;
	let touch: { x: number; y: number; lastY: number; time: number; speed: number } | undefined;

	function measure() {
		rest = dock?.getBoundingClientRect().top ?? innerHeight;
		flights = dialog.scrollTop > 1 || reduced.matches ? [] : pairs.flatMap(({ expanded, docked, art }) => {
			if (!expanded || !docked?.isConnected) return [];
			const from = expanded.getBoundingClientRect();
			const to = docked.getBoundingClientRect();
			if (!from.width || !to.width) return [];
			const scale = art ? to.width / from.width : parseFloat(getComputedStyle(docked).fontSize) / parseFloat(getComputedStyle(expanded).fontSize);
			return [{ expanded, docked, x: to.left - from.left, y: to.top - from.top - rest, scale }];
		});
	}

	function render(next: number) {
		position = next;
		panel.style.transform = next ? `translateY(${next}px)` : '';
		const progress = Math.min(1, next / Math.max(1, rest));
		const phase = Math.max(0, (progress - 0.6) / 0.4);
		const horizontal = phase * phase * (3 - 2 * phase);
		dialog.style.setProperty('--player-backdrop', String(0.18 * Math.min(1, (1 - progress) / 0.15)));
		for (const { expanded, docked, x, y, scale } of flights) {
			docked.style.visibility = next ? 'hidden' : '';
			expanded.style.transform = next ? `translate(${x * horizontal}px, ${y * progress}px) scale(${1 - (1 - scale) * progress})` : '';
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
		touch = undefined;
		closing = true;
		if (!phone.matches || reduced.matches || !ready) { close(); return; }
		if (!position) measure();
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
		if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(target); });
	}

	function reset() {
		touch = undefined;
		if (!closing && (position || frame)) settle(0);
	}

	function begin(event: TouchEvent) {
		if (event.touches.length !== 1) { if (touch) reset(); return; }
		if (!ready || closing || frame || !phone.matches || dialog.scrollTop > 1 || (event.target instanceof Element && event.target.closest('button, a, input, textarea, select'))) return;
		const { clientX: x, clientY: y } = event.touches[0];
		touch = { x, y, lastY: y, time: event.timeStamp, speed: 0 };
		target = 0;
	}

	function move(event: TouchEvent) {
		if (!touch) return;
		if (event.touches.length !== 1) { reset(); return; }
		const { clientX: x, clientY: y } = event.touches[0];
		const dx = Math.abs(x - touch.x), dy = y - touch.y;
		if (!target && (dy < -10 || dx > 10 && dx >= dy)) { touch = undefined; return; }
		if (!target && dy <= Math.max(10, dx * 1.5)) return;
		if (!event.cancelable) { reset(); return; }
		event.preventDefault();
		if (!target && !position) measure();
		touch.speed = (y - touch.lastY) / Math.max(1, event.timeStamp - touch.time);
		touch.time = event.timeStamp;
		touch.lastY = y;
		queueRender(dy);
	}

	function end(event: TouchEvent) {
		const speed = touch && event.timeStamp - touch.time < 90 ? touch.speed : 0;
		if (!touch || target < Math.min(120, innerHeight * 0.16) && (target < 48 || speed < 0.8)) { if (touch) reset(); return; }
		render(target);
		dismiss();
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

	panel.addEventListener('touchstart', begin, { passive: true });
	panel.addEventListener('touchmove', move, { passive: false });
	panel.addEventListener('touchend', end);
	panel.addEventListener('touchcancel', reset);
	function destroy() {
		stopFrame();
		dialogOpen.disconnect();
		disconnect?.();
		panel.removeEventListener('touchstart', begin);
		panel.removeEventListener('touchmove', move);
		panel.removeEventListener('touchend', end);
		panel.removeEventListener('touchcancel', reset);
		render(0);
		dialog.style.removeProperty('--player-backdrop');
	}
	return { dismiss, destroy };
}
