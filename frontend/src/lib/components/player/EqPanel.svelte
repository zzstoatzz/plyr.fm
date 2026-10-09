<script lang="ts">
	import { untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { cubicOut } from 'svelte/easing';
	import { eq } from '$lib/eq.svelte';
	import { player } from '$lib/player.svelte';
	import { BANDS, GAIN_LIMIT_DB, PRESETS, isFlat, logFrequencies, responseDb } from '$lib/eq/bands';

	const WIDTH = 320;
	const HEIGHT = 140;
	const PAD_X = 14;
	const PAD_Y = 12;
	const MIN_HZ = 20;
	const MAX_HZ = 20000;
	const CURVE_POINTS = logFrequencies(120, MIN_HZ, MAX_HZ);
	const GLIDE_MS = 260;

	let svg = $state<SVGSVGElement | null>(null);
	let dragging = $state<number | null>(null);
	let focused = $state<number | null>(null);

	// the drawn gains glide to a new preset; while dragging they track the pointer exactly
	let shown = $state<number[]>([...eq.gains]);
	$effect(() => {
		const target = [...eq.gains];
		if (!browser || dragging !== null || reducedMotion()) {
			shown = target;
			return;
		}
		const from = untrack(() => [...shown]);
		const start = performance.now();
		let frame = requestAnimationFrame(function step(now: number) {
			const k = cubicOut(Math.min(1, (now - start) / GLIDE_MS));
			shown = from.map((v, i) => v + (target[i] - v) * k);
			if (k < 1) frame = requestAnimationFrame(step);
		});
		return () => cancelAnimationFrame(frame);
	});

	function reducedMotion(): boolean {
		return browser && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
	}

	function xFor(hz: number): number {
		const t = (Math.log10(hz) - Math.log10(MIN_HZ)) / (Math.log10(MAX_HZ) - Math.log10(MIN_HZ));
		return PAD_X + t * (WIDTH - PAD_X * 2);
	}

	function yFor(db: number): number {
		const t = (GAIN_LIMIT_DB - db) / (GAIN_LIMIT_DB * 2);
		return PAD_Y + Math.max(0, Math.min(1, t)) * (HEIGHT - PAD_Y * 2);
	}

	function dbFor(y: number): number {
		const t = (y - PAD_Y) / (HEIGHT - PAD_Y * 2);
		return GAIN_LIMIT_DB - t * GAIN_LIMIT_DB * 2;
	}

	const bandX = BANDS.map((b) => xFor(b.frequency));
	const zeroY = yFor(0);

	let curve = $derived.by(() => {
		const db = responseDb(shown, CURVE_POINTS, eq.sampleRate);
		return CURVE_POINTS.map((hz, i) => `${xFor(hz).toFixed(1)},${yFor(db[i]).toFixed(1)}`);
	});
	let line = $derived(`M${curve.join('L')}`);
	let area = $derived(`M${xFor(MIN_HZ)},${zeroY}L${curve.join('L')}L${xFor(MAX_HZ)},${zeroY}Z`);

	function formatDb(db: number): string {
		if (db === 0) return '0 dB';
		return `${db > 0 ? '+' : '−'}${Math.abs(db)} dB`;
	}

	function setGain(index: number, db: number) {
		if (!eq.enabled) eq.setEnabled(true, player.audioElement);
		eq.setGain(index, db);
	}

	function pointToSvg(event: PointerEvent): { x: number; y: number } | null {
		if (!svg) return null;
		const rect = svg.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return null;
		return {
			x: ((event.clientX - rect.left) / rect.width) * WIDTH,
			y: ((event.clientY - rect.top) / rect.height) * HEIGHT
		};
	}

	function nearestBand(x: number): number {
		let best = 0;
		for (let i = 1; i < bandX.length; i++) {
			if (Math.abs(bandX[i] - x) < Math.abs(bandX[best] - x)) best = i;
		}
		return best;
	}

	function onPointerDown(event: PointerEvent) {
		const point = pointToSvg(event);
		if (!point || !svg) return;
		event.preventDefault();
		const index = nearestBand(point.x);
		dragging = index;
		svg.setPointerCapture(event.pointerId);
		setGain(index, dbFor(point.y));
		svg.querySelector<SVGGElement>(`[data-band="${index}"]`)?.focus({ preventScroll: true });
	}

	function onPointerMove(event: PointerEvent) {
		if (dragging === null) return;
		const point = pointToSvg(event);
		if (point) setGain(dragging, dbFor(point.y));
	}

	function onPointerUp(event: PointerEvent) {
		if (dragging === null) return;
		svg?.releasePointerCapture(event.pointerId);
		dragging = null;
	}

	function keyedGain(key: string, current: number): number | null {
		switch (key) {
			case 'ArrowUp':
			case 'ArrowRight':
				return current + 1;
			case 'ArrowDown':
			case 'ArrowLeft':
				return current - 1;
			case 'PageUp':
				return current + 3;
			case 'PageDown':
				return current - 3;
			case 'Home':
				return -GAIN_LIMIT_DB;
			case 'End':
				return GAIN_LIMIT_DB;
			case '0':
			case 'Delete':
			case 'Backspace':
				return 0;
			default:
				return null;
		}
	}

	function onBandKeydown(event: KeyboardEvent, index: number) {
		const next = keyedGain(event.key, eq.gains[index]);
		if (next === null) return;
		event.preventDefault();
		setGain(index, next);
	}

	function choosePreset(gains: readonly number[]) {
		if (!eq.enabled) eq.setEnabled(true, player.audioElement);
		eq.setGains(gains);
	}

	let activeBand = $derived(dragging ?? focused);
</script>

<div class="eq-panel" class:off={!eq.enabled}>
	<header>
		<span class="title">equalizer</span>
		<label class="toggle">
			<span class="toggle-text">{eq.enabled ? 'on' : 'off'}</span>
			<input
				type="checkbox"
				role="switch"
				aria-label="equalizer"
				checked={eq.enabled}
				onchange={(e) => eq.setEnabled(e.currentTarget.checked, player.audioElement)}
			/>
		</label>
	</header>

	<div class="presets" role="group" aria-label="presets">
		{#each PRESETS as preset (preset.id)}
			<button
				type="button"
				class="chip"
				class:active={eq.enabled && eq.preset?.id === preset.id}
				aria-pressed={eq.enabled && eq.preset?.id === preset.id}
				onclick={() => choosePreset(preset.gains)}
			>
				{preset.name}
			</button>
		{/each}
		{#if !eq.preset}
			<span class="chip custom" class:active={eq.enabled}>custom</span>
		{/if}
	</div>

	<div class="graph-wrap">
		<svg
			bind:this={svg}
			class="graph"
			class:dragging={dragging !== null}
			viewBox="0 0 {WIDTH} {HEIGHT}"
			role="group"
			aria-label="equalizer bands"
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerUp}
		>
			<defs>
				<linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="currentColor" stop-opacity="0.35" />
					<stop offset="50%" stop-color="currentColor" stop-opacity="0.04" />
					<stop offset="100%" stop-color="currentColor" stop-opacity="0.35" />
				</linearGradient>
			</defs>
			{#each bandX as x, i (i)}
				<line
					class="guide"
					class:hot={activeBand === i}
					x1={x}
					x2={x}
					y1={PAD_Y}
					y2={HEIGHT - PAD_Y}
				/>
			{/each}
			<line class="zero" x1={PAD_X} x2={WIDTH - PAD_X} y1={zeroY} y2={zeroY} />
			<path class="area" d={area} fill="url(#eq-fill)" />
			<path class="curve" d={line} />
			{#each BANDS as band, i (band.frequency)}
				<g
					class="band"
					class:hot={activeBand === i}
					data-band={i}
					role="slider"
					tabindex="0"
					aria-label="{band.label} Hz"
					aria-orientation="vertical"
					aria-valuemin={-GAIN_LIMIT_DB}
					aria-valuemax={GAIN_LIMIT_DB}
					aria-valuenow={eq.gains[i]}
					aria-valuetext={formatDb(eq.gains[i])}
					onkeydown={(e) => onBandKeydown(e, i)}
					onfocus={() => (focused = i)}
					onblur={() => (focused = null)}
					ondblclick={() => setGain(i, 0)}
				>
					<circle class="halo" cx={bandX[i]} cy={yFor(shown[i])} r="10" />
					<circle class="knob" cx={bandX[i]} cy={yFor(shown[i])} r="4.5" />
				</g>
			{/each}
		</svg>
		{#if activeBand !== null}
			<span
				class="readout"
				style:left="{(bandX[activeBand] / WIDTH) * 100}%"
				style:top="{(Math.max(PAD_Y + 6, yFor(shown[activeBand]) - 14) / HEIGHT) * 100}%"
				aria-hidden="true">{formatDb(eq.gains[activeBand])}</span
			>
		{/if}
	</div>
	<div class="labels" aria-hidden="true">
		{#each BANDS as band, i (band.frequency)}
			<span class:hot={activeBand === i} style:left="{(bandX[i] / WIDTH) * 100}%">{band.label}</span
			>
		{/each}
	</div>

	<footer>
		<span class="hint">drag a point, or use arrow keys</span>
		<button
			type="button"
			class="reset"
			disabled={isFlat(eq.gains)}
			onclick={() => eq.setGains(PRESETS[0].gains)}
		>
			reset
		</button>
	</footer>
</div>

<style>
	.eq-panel {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 100%;
		color: var(--text-primary);
		font-family: inherit;
		--eq-color: var(--accent);
	}

	.eq-panel.off {
		--eq-color: var(--text-muted);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.title {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		letter-spacing: 0.02em;
	}

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
	}

	.toggle-text {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		min-width: 1.5em;
		text-align: right;
	}

	.toggle input {
		appearance: none;
		width: 36px;
		height: 20px;
		margin: 0;
		border-radius: var(--radius-full);
		background: var(--border-default);
		border: 1px solid var(--border-default);
		position: relative;
		cursor: pointer;
		flex-shrink: 0;
		transition:
			background 0.15s,
			border-color 0.15s;
	}

	.toggle input::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		border-radius: var(--radius-full);
		background: var(--text-secondary);
		transition:
			transform 0.2s var(--ease-surface),
			background 0.15s;
	}

	.toggle input:checked {
		background: color-mix(in srgb, var(--accent) 65%, transparent);
		border-color: var(--accent);
	}

	.toggle input:checked::after {
		transform: translateX(16px);
		background: var(--accent);
	}

	.toggle input:focus-visible {
		outline: 2px solid var(--text-primary);
		outline-offset: 2px;
	}

	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.chip {
		padding: 0.25rem 0.625rem;
		font-family: inherit;
		font-size: var(--text-xs);
		color: var(--text-secondary);
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-full);
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s,
			background 0.15s;
	}

	.chip:hover {
		color: var(--text-primary);
		border-color: var(--border-emphasis);
	}

	.chip.active {
		color: var(--accent);
		border-color: color-mix(in srgb, var(--accent) 60%, transparent);
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}

	.chip.custom {
		cursor: default;
		border-style: dashed;
	}

	.chip:focus-visible {
		outline: 2px solid var(--text-primary);
		outline-offset: 2px;
	}

	.graph {
		display: block;
		width: 100%;
		height: auto;
		color: var(--eq-color);
		touch-action: none;
		cursor: ns-resize;
		user-select: none;
		-webkit-user-select: none;
		overflow: visible;
	}

	.guide {
		stroke: var(--border-subtle);
		stroke-width: 1;
		transition: stroke 0.15s;
	}

	.guide.hot {
		stroke: var(--border-emphasis);
	}

	.zero {
		stroke: var(--border-emphasis);
		stroke-width: 1;
		stroke-dasharray: 2 4;
	}

	.curve {
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
		transition: stroke 0.2s;
	}

	.eq-panel:not(.off) .curve {
		filter: drop-shadow(0 0 4px color-mix(in srgb, var(--accent) 55%, transparent));
	}

	.band {
		outline: none;
		cursor: grab;
	}

	.graph.dragging .band {
		cursor: grabbing;
	}

	.halo {
		fill: currentColor;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.band:hover .halo,
	.band.hot .halo {
		opacity: 0.18;
	}

	.band:focus-visible .halo {
		opacity: 0.3;
		stroke: var(--text-primary);
		stroke-width: 1.5;
	}

	.knob {
		fill: var(--bg-tertiary);
		stroke: currentColor;
		stroke-width: 2;
		transition: r 0.15s var(--ease-surface);
	}

	.band.hot .knob {
		r: 5.5;
		fill: currentColor;
	}

	.graph-wrap {
		position: relative;
	}

	.readout {
		position: absolute;
		translate: -50% -100%;
		padding: 0.1rem 0.375rem;
		font-size: var(--text-xs);
		font-variant-numeric: lining-nums tabular-nums;
		white-space: nowrap;
		color: var(--text-primary);
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
		pointer-events: none;
	}

	.labels {
		position: relative;
		height: 1rem;
		margin-top: -0.5rem;
	}

	.labels span {
		position: absolute;
		translate: -50% 0;
		font-size: var(--text-xs);
		font-variant-numeric: lining-nums tabular-nums;
		color: var(--text-tertiary);
		transition: color 0.15s;
	}

	.labels span.hot {
		color: var(--text-primary);
	}

	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.hint {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
	}

	.reset {
		padding: 0;
		font-family: inherit;
		font-size: var(--text-xs);
		color: var(--text-secondary);
		background: none;
		border: none;
		cursor: pointer;
	}

	.reset:hover:not(:disabled) {
		color: var(--accent);
	}

	.reset:disabled {
		color: var(--text-muted);
		cursor: default;
	}

	.reset:focus-visible {
		outline: 2px solid var(--text-primary);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}

	@media (prefers-reduced-motion: reduce) {
		.toggle input::after,
		.knob,
		.halo,
		.curve {
			transition: none;
		}
	}
</style>
