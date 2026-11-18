/** Opens a track's menu from right-click, or from a held touch on phones (iOS Safari never fires contextmenu for that). */
export function pressMenu(node: HTMLElement, open: (x: number, y: number) => void) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let start: { x: number; y: number; pointer: number } | undefined;
	let swallowClick = false;
	const cancel = () => { clearTimeout(timer); timer = undefined; start = undefined; };
	const linked = (target: EventTarget | null) => target instanceof Element && !!target.closest('a[href]');

	let opened = -Infinity;
	function contextmenu(event: MouseEvent) {
		if (linked(event.target) || event.defaultPrevented) return;
		event.preventDefault();
		if (performance.now() - opened < 800) return;
		cancel();
		open(event.clientX, event.clientY);
	}
	function down(event: PointerEvent) {
		if (event.pointerType !== 'touch' || !event.isPrimary) return;
		swallowClick = false;
		start = { x: event.clientX, y: event.clientY, pointer: event.pointerId };
		timer = setTimeout(() => {
			if (!start) return;
			swallowClick = true;
			opened = performance.now();
			navigator.vibrate?.(10);
			open(start.x, start.y);
			start = undefined;
		}, 450);
	}
	function move(event: PointerEvent) {
		if (start?.pointer === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancel();
	}
	function click(event: MouseEvent) {
		if (!swallowClick) return;
		swallowClick = false;
		event.preventDefault();
		event.stopPropagation();
	}
	node.addEventListener('contextmenu', contextmenu);
	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', cancel);
	node.addEventListener('pointercancel', cancel);
	node.addEventListener('click', click, true);
	return {
		destroy() {
			cancel();
			node.removeEventListener('contextmenu', contextmenu);
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', cancel);
			node.removeEventListener('pointercancel', cancel);
			node.removeEventListener('click', click, true);
		}
	};
}
