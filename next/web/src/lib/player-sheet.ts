export function playerSheet(panel: HTMLElement, close: () => void) {
	const sheet = panel.closest('dialog');
	if (!sheet) return;
	const dialog = sheet;
	const phone = matchMedia('(max-width: 720px)');
	const reduce = matchMedia('(prefers-reduced-motion: reduce)');
	const cover = panel.querySelector<HTMLElement>('[data-testid="now-playing-artwork"]');
	const thumbnail = document.querySelector<HTMLElement>('[data-testid="player-dock"] .cover');
	let gesture: { x: number; y: number; lastY: number; time: number; speed: number } | undefined;
	let distance = 0;
	let closing = false;
	let settle: Animation | undefined;
	let coverFlight: Animation | undefined;
	let dockGeometry: { x: number; y: number; scale: number } | undefined;

	function dockTransform(amount: number) {
		if (!dockGeometry) return 'none';
		const { x, y, scale } = dockGeometry;
		return `translate(${x * amount}px, ${y * amount}px) scale(${1 - (1 - scale) * amount})`;
	}

	function flight(opening: boolean, offset: number, duration: number) {
		if (!cover || !thumbnail || !thumbnail.isConnected || dialog.scrollTop > 1 || reduce.matches) return;
		const from = cover.getBoundingClientRect();
		const to = thumbnail.getBoundingClientRect();
		if (!from.width || !to.width) return;
		const dock = `translate(${to.left - from.left}px, ${to.top - from.top - offset}px) scale(${to.width / from.width})`;
		const rest = 'translate(0, 0) scale(1)';
		thumbnail.style.visibility = 'hidden';
		coverFlight?.cancel();
		coverFlight = cover.animate(opening ? [{ transform: dock }, { transform: rest }] : [{ transform: rest }, { transform: dock }], {
			duration, easing: 'cubic-bezier(.2,.8,.25,1)', fill: 'both'
		});
		void coverFlight.finished.then(() => { thumbnail.style.visibility = ''; }, () => {});
	}

	function begin(event: TouchEvent) {
		if (event.touches.length !== 1) { reset(); return; }
		if (closing || !phone.matches || dialog.scrollTop > 1 || (event.target instanceof Element && event.target.closest('button, a, input, textarea, select'))) return;
		settle?.cancel();
		coverFlight?.cancel();
		if (thumbnail) thumbnail.style.visibility = '';
		dockGeometry = undefined;
		const { clientX: x, clientY: y } = event.touches[0];
		gesture = { x, y, lastY: y, time: event.timeStamp, speed: 0 };
	}

	function move(event: TouchEvent) {
		if (!gesture) return;
		if (event.touches.length !== 1) { reset(); return; }
		const { clientX: x, clientY: y } = event.touches[0];
		const dx = Math.abs(x - gesture.x), dy = y - gesture.y;
		if (!distance && (dy < -8 || dx > 8 && dx >= dy)) { gesture = undefined; return; }
		if (!distance && dy <= Math.max(8, dx * 1.5)) return;
		if (!event.cancelable) { reset(); return; }
		event.preventDefault();
		if (!distance && cover && thumbnail?.isConnected && !reduce.matches) {
			const from = cover.getBoundingClientRect();
			const to = thumbnail.getBoundingClientRect();
			if (from.width && to.width) dockGeometry = { x: to.left - from.left, y: to.top - from.top - innerHeight, scale: to.width / from.width };
		}
		gesture.speed = (y - gesture.lastY) / Math.max(1, event.timeStamp - gesture.time);
		gesture.time = event.timeStamp;
		gesture.lastY = y;
		distance = Math.min(innerHeight, Math.max(0, dy));
		panel.style.transform = `translateY(${distance}px)`;
		if (cover && dockGeometry) cover.style.transform = dockTransform(distance / innerHeight);
	}

	function reset() {
		gesture = undefined;
		if (!distance) return;
		const from = distance;
		distance = 0;
		panel.style.transform = '';
		if (cover && dockGeometry) {
			const transform = cover.style.transform;
			cover.style.transform = '';
			coverFlight = cover.animate([{ transform }, { transform: 'none' }], { duration: 190, easing: 'cubic-bezier(.2,.85,.25,1)' });
		}
		dockGeometry = undefined;
		if (!reduce.matches) settle = panel.animate([{ transform: `translateY(${from}px)` }, { transform: 'none' }], { duration: 190, easing: 'cubic-bezier(.2,.85,.25,1)' });
	}

	function end(event: TouchEvent) {
		const speed = gesture && event.timeStamp - gesture.time < 90 ? gesture.speed : 0;
		if (!gesture || distance < Math.min(120, innerHeight * 0.16) && (distance < 48 || speed < 0.8)) { reset(); return; }
		gesture = undefined;
		closing = true;
		if (reduce.matches) { close(); return; }
		const exit = innerHeight;
		if (cover && thumbnail && dockGeometry) {
			thumbnail.style.visibility = 'hidden';
			coverFlight = cover.animate([{ transform: cover.style.transform }, { transform: dockTransform(1) }], {
				duration: 245, easing: 'cubic-bezier(.2,.8,.25,1)', fill: 'both'
			});
		} else flight(false, exit - distance, 245);
		settle = panel.animate([{ transform: `translateY(${distance}px)` }, { transform: `translateY(${exit}px)` }], { duration: 245, easing: 'cubic-bezier(.2,.8,.25,1)', fill: 'forwards' });
		void settle.finished.then(close, () => {});
	}

	const opening = requestAnimationFrame(() => {
		if (!dialog.open || gesture || closing || !phone.matches || reduce.matches) return;
		const offset = thumbnail ? thumbnail.getBoundingClientRect().top - 24 : innerHeight;
		flight(true, -offset, 290);
		settle = panel.animate([{ transform: `translateY(${offset}px)` }, { transform: 'none' }], { duration: 290, easing: 'cubic-bezier(.2,.8,.25,1)' });
	});
	panel.addEventListener('touchstart', begin, { passive: true });
	panel.addEventListener('touchmove', move, { passive: false });
	panel.addEventListener('touchend', end);
	panel.addEventListener('touchcancel', reset);
	return () => {
		cancelAnimationFrame(opening);
		panel.removeEventListener('touchstart', begin);
		panel.removeEventListener('touchmove', move);
		panel.removeEventListener('touchend', end);
		panel.removeEventListener('touchcancel', reset);
		settle?.cancel();
		coverFlight?.cancel();
		if (cover) cover.style.transform = '';
		if (thumbnail) thumbnail.style.visibility = '';
	};
}
