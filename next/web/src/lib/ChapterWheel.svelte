<script lang="ts">
	import { clock, type Chapter } from '@plyr/next-core/chapters';

	// The "now: <chapter>" line under the scrubber opens a picker wheel of the tracklist. Nothing seeks until a commit:
	// hold and drag, then let go on another chapter (letting go on the playing one, or sliding sideways off, cancels),
	// or click to browse, then click a chapter, scroll, or use the arrow keys and Enter. Escape or a click outside closes it.
	let { chapters, current, seek, preview = $bindable() }: {
		chapters: Chapter[]; current: number; seek?: (seconds: number) => void; preview?: number;
	} = $props();

	const ROW = 38;
	const HOLD_MS = 140;
	const CANCEL_DX = 90;
	let mode = $state<'closed' | 'drag' | 'browse'>('closed');
	let selected = $state(0);
	let offset = $state(0);
	let cancel = $state(false);
	let touch = $state(false);
	let gesture: { x: number; y: number; from: number; moved: boolean; hold?: ReturnType<typeof setTimeout> } | undefined;
	let flick: { y: number; from: number; moved: boolean } | undefined;
	let wheel: HTMLDivElement | undefined = $state();
	let line: HTMLDivElement | undefined = $state();
	const id = `chapter-wheel-${Math.random().toString(36).slice(2, 8)}`;
	const max = $derived((chapters.length - 1) * ROW);
	const chapter = $derived(chapters[current]);

	$effect(() => { preview = mode !== 'closed' && selected !== current ? chapters[selected]?.start : undefined; });
	$effect(() => {
		if (mode !== 'browse') return;
		const outside = (event: PointerEvent) => { if (!wheel?.contains(event.target as Node) && !line?.contains(event.target as Node)) close(); };
		document.addEventListener('pointerdown', outside, true);
		return () => document.removeEventListener('pointerdown', outside, true);
	});

	function scrollTo(value: number) {
		offset = Math.max(0, Math.min(max, value));
		selected = Math.round(offset / ROW);
	}
	function open(next: 'drag' | 'browse') {
		selected = current;
		offset = current * ROW;
		cancel = false;
		mode = next;
	}
	function close(commit = false) {
		if (commit && seek && selected !== current && chapters[selected]) seek(chapters[selected].start);
		if (gesture?.hold) clearTimeout(gesture.hold);
		gesture = undefined;
		cancel = false;
		mode = 'closed';
	}
	function choose(index: number) {
		selected = index;
		close(true);
		line?.focus();
	}

	function down(event: PointerEvent) {
		if (!seek || event.button !== 0) return;
		touch = event.pointerType !== 'mouse';
		if (mode === 'browse') { close(); return; }
		line?.setPointerCapture(event.pointerId);
		gesture = { x: event.clientX, y: event.clientY, from: current * ROW, moved: false,
			hold: setTimeout(() => { if (gesture && event.pointerType !== 'mouse') open('drag'); }, HOLD_MS) };
	}
	function move(event: PointerEvent) {
		if (!gesture) return;
		const dy = event.clientY - gesture.y;
		const dx = event.clientX - gesture.x;
		if (mode === 'closed' && Math.abs(dy) > 4) { clearTimeout(gesture.hold); open('drag'); }
		if (mode !== 'drag') return;
		if (Math.abs(dy) > 4) gesture.moved = true;
		if (!gesture.moved && Math.abs(dx) <= CANCEL_DX) return;
		cancel = Math.abs(dx) > CANCEL_DX;
		scrollTo(gesture.from - dy);
	}
	function up() {
		if (!gesture) return;
		clearTimeout(gesture.hold);
		if (mode === 'drag' && (gesture.moved || cancel)) { close(!cancel); return; }
		gesture = undefined;
		if (mode === 'closed') open('browse');
		else mode = 'browse';
	}
	function key(event: KeyboardEvent) {
		if (!seek) return;
		touch = false;
		const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
		if (mode === 'closed') {
			if (step || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open('browse'); }
			return;
		}
		if (step) { event.preventDefault(); scrollTo((selected + step) * ROW); }
		else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); scrollTo(event.key === 'Home' ? 0 : max); }
		else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); close(true); }
		else if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); } close(); }
	}
	let settle: ReturnType<typeof setTimeout> | undefined;
	function wheelScroll(event: WheelEvent) {
		if (mode === 'closed') return;
		event.preventDefault();
		scrollTo(offset + event.deltaY * 0.5);
		clearTimeout(settle);
		settle = setTimeout(() => { offset = selected * ROW; }, 140);
	}
	function flickDown(event: PointerEvent) {
		if (mode !== 'browse') return;
		wheel?.setPointerCapture(event.pointerId);
		flick = { y: event.clientY, from: offset, moved: false };
	}
	function flickMove(event: PointerEvent) {
		if (!flick) return;
		const dy = event.clientY - flick.y;
		if (Math.abs(dy) > 4) flick.moved = true;
		if (flick.moved) scrollTo(flick.from - dy);
	}
	function flickUp(event: PointerEvent) {
		const state = flick;
		flick = undefined;
		if (!state) return;
		if (state.moved) { offset = selected * ROW; return; }
		const rect = wheel?.getBoundingClientRect();
		if (!rect) return;
		const index = Math.round((offset + event.clientY - rect.top - rect.height / 2) / ROW);
		if (index >= 0 && index < chapters.length) choose(index);
	}

	const hint = $derived(cancel ? 'let go to cancel' : selected === current
		? mode === 'browse' ? `${touch ? 'tap' : 'click'} outside to close` : 'let go to keep playing'
		: `${mode === 'browse' ? touch ? 'tap' : 'click' : 'let go'} to jump to ${clock(chapters[selected]?.start ?? 0)}`);
</script>

{#if chapter}
	<span class="anchor">
		<div bind:this={line} data-player-no-pull role="combobox" tabindex={seek ? 0 : -1} class="line truncate" class:open={mode !== 'closed'} class:disabled={!seek}
			aria-disabled={!seek} aria-label={`now: ${chapter.title}. Tracklist`} aria-haspopup="listbox" aria-expanded={mode !== 'closed'} aria-controls={id}
			aria-activedescendant={mode !== 'closed' ? `${id}-${selected}` : undefined}
			onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={() => close()} onkeydown={key} onwheel={wheelScroll}>
			now: {chapter.title}
		</div>
		{#if mode !== 'closed'}
			<div bind:this={wheel} data-player-no-pull class="wheel" class:cancel role="listbox" id={id} aria-label="Tracklist" tabindex="-1"
				onpointerdown={flickDown} onpointermove={flickMove} onpointerup={flickUp} onwheel={wheelScroll}>
				<div class="band" aria-hidden="true"></div>
				<div class="rows" style:transform={`translateY(${-offset - ROW / 2}px)`}>
					{#each chapters as item, index (item.start)}
						{@const d = Math.max(-3, Math.min(3, (index * ROW - offset) / ROW))}
						<div class="row" class:selected={index === selected} role="option" id={`${id}-${index}`} aria-selected={index === selected}
							aria-label={`${clock(item.start)}, ${item.label}`}
							style:opacity={1 - Math.abs(d) * 0.28}
							style:transform={`perspective(400px) rotateX(${-d * 18}deg) scale(${1 - Math.abs(d) * 0.05})`}>
							<span class="time">{clock(item.start)}</span>
							<span class="name truncate">{item.title}{#if item.artist}<small> · {item.artist}</small>{/if}</span>
							<span class="dot" class:on={index === current}></span>
						</div>
					{/each}
				</div>
				<div class="hint" aria-live="polite">{hint}</div>
			</div>
		{/if}
	</span>
{/if}

<style>
	.anchor { position: relative; display: flex; justify-content: center; min-width: 0; }
	.line { max-width: 100%; color: var(--accent); font-size: 0.75rem; padding: 0.1rem 0.55rem; border-radius: 99px; touch-action: none; user-select: none; -webkit-user-select: none; cursor: grab; }
	.line:hover:not(.disabled), .line.open { background: color-mix(in srgb, var(--accent) 12%, transparent); }
	.line.disabled { cursor: default; }
	.wheel { position: absolute; z-index: 20; top: 50%; left: 50%; width: min(24rem, calc(100vw - 2rem)); height: calc(38px * 5); transform: translate(-50%, -50%);
		background: var(--surface);
		border: 1px solid var(--line); border-radius: 22px; box-shadow: 0 18px 50px rgb(0 0 0 / 0.25); overflow: hidden; touch-action: none; user-select: none;
		animation: bloom 180ms cubic-bezier(.2, .9, .3, 1.15); }
	.wheel.cancel { opacity: 0.4; }
	@keyframes bloom { from { transform: translate(-50%, -50%) scale(0.6, 0.2); opacity: 0; } }
	.band { position: absolute; left: 10px; right: 10px; top: 50%; height: 38px; margin-top: -19px; border-radius: 12px; background: color-mix(in srgb, var(--accent) 12%, transparent); }
	.rows { position: absolute; left: 0; right: 0; top: 50%; }
	.row { height: 38px; display: grid; grid-template-columns: 3rem minmax(0, 1fr) 0.5rem; gap: 0.6rem; align-items: center; padding: 0 1.25rem; font-size: 0.9375rem; color: var(--text); cursor: pointer; }
	.row .time { color: var(--faint); font-size: 0.8125rem; font-variant-numeric: tabular-nums; }
	.row small { color: var(--muted); font-size: 0.8125rem; font-weight: 400; }
	.row.selected .name, .row.selected .time { color: var(--accent); font-weight: 600; }
	.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); opacity: 0; }
	.dot.on { opacity: 1; }
	.hint { position: absolute; left: 0; right: 0; bottom: 0; pointer-events: none; padding: 0.2rem 0; text-align: center; font-size: 0.75rem; color: var(--muted); background: var(--surface); }
	@media (prefers-reduced-motion: reduce) { .wheel { animation: none; } }
</style>
