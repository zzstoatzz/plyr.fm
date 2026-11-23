<script lang="ts">
	/** Bars over time. Hover, tap or arrow through them; the selected bar's value shows in a tip.
	 *  `quiet` draws the secondary series (uploads) in the muted ink, short and without a tip of its own. */
	type Bar = { label: string; value: number; detail?: string };
	let { bars, height = 190, label, unit, quiet = false, axis = true, selected = $bindable<number | undefined>() }: {
		bars: Bar[]; height?: number; label: string; unit: [string, string]; quiet?: boolean; axis?: boolean; selected?: number;
	} = $props();

	let width = $state(0);
	const left = $derived(axis ? 34 : 4);
	const bottom = $derived(axis ? 22 : 2);
	const max = $derived(Math.max(1, ...bars.map(bar => bar.value)));
	const peak = $derived(bars.findIndex(bar => bar.value === max && bar.value > 0));
	const step = $derived(bars.length ? Math.max(0, width - left - 4) / bars.length : 0);
	const gap = $derived(Math.min(6, step * 0.22));
	const plot = $derived(height - bottom - 8);
	const ticks = $derived(niceTicks(max, quiet ? 1 : 3));
	const top = $derived(Math.max(max, ticks.at(-1) ?? max));
	const shown = $derived(selected ?? (quiet ? undefined : peak >= 0 ? peak : undefined));
	const labelEvery = $derived(Math.max(1, Math.ceil(bars.length / Math.max(1, Math.floor((width - left) / 70)))));

	function niceTicks(value: number, count: number) {
		const raw = value / count;
		const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
		const nice = [1, 2, 2.5, 5, 10].map(m => m * magnitude).find(m => m >= raw) ?? raw;
		return Array.from({ length: count + 1 }, (_, i) => Math.round(i * nice));
	}
	const y = (value: number) => 8 + plot - (plot * value) / top;
	const count = (value: number) => `${value.toLocaleString()} ${value === 1 ? unit[0] : unit[1]}`;

	function key(event: KeyboardEvent) {
		if (!bars.length) return;
		const at = shown ?? bars.length - 1;
		const next = event.key === 'ArrowLeft' ? at - 1 : event.key === 'ArrowRight' ? at + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? bars.length - 1 : undefined;
		if (next === undefined) return;
		event.preventDefault();
		selected = Math.min(bars.length - 1, Math.max(0, next));
	}
	function point(event: PointerEvent) {
		const box = (event.currentTarget as SVGElement).getBoundingClientRect();
		const index = Math.floor((event.clientX - box.left - left) / (step || 1));
		if (index >= 0 && index < bars.length) selected = index;
	}
</script>

<div class="chart" class:quiet bind:clientWidth={width}>
	{#if width}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
		<svg {width} {height} role="group" aria-label={label} aria-roledescription="bar chart" tabindex={quiet ? undefined : 0}
			onkeydown={key} onpointermove={point} onpointerdown={point} onpointerleave={() => { if (!quiet) selected = undefined; }}>
			{#if axis}
				{#each ticks as tick (tick)}
					<line x1={left} x2={width} y1={y(tick)} y2={y(tick)} class="grid" />
					<text x={left - 8} y={y(tick) + 4} text-anchor="end" class="axis">{tick.toLocaleString()}</text>
				{/each}
			{/if}
			{#each bars as bar, index (bar.label)}
				{@const h = Math.max(bar.value ? 2 : 0, plot - (y(bar.value) - 8))}
				<rect x={left + index * step + gap / 2} y={8 + plot - h} width={Math.max(1, step - gap)} height={h} rx={Math.min(3, (step - gap) / 3)}
					class:on={index === shown} />
				{#if axis && index % labelEvery === 0}
					<text x={left + index * step + step / 2} y={height - 6} text-anchor="middle" class="axis">{bar.label}</text>
				{/if}
			{/each}
		</svg>
		{#if shown !== undefined && bars[shown] && !quiet}
			{@const bar = bars[shown]}
			<div class="tip" style:left="{Math.min(width - 150, Math.max(0, left + shown * step + step / 2 - 60))}px" style:top="{Math.max(0, y(bar.value) - 52)}px">
				<b>{count(bar.value)}</b><span>{bar.detail ?? bar.label}</span>
			</div>
		{/if}
		<p class="sr" aria-live="polite">{shown !== undefined && bars[shown] && selected !== undefined ? `${bars[shown].detail ?? bars[shown].label}: ${count(bars[shown].value)}` : ''}</p>
	{/if}
</div>

<style>
	.chart { position: relative; min-width: 0; }
	svg { display: block; overflow: visible; touch-action: pan-y; }
	svg:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 6px; }
	.grid { stroke: color-mix(in srgb, var(--text) 8%, transparent); }
	.axis { fill: var(--faint, var(--muted)); font-size: var(--t-11-2); font-family: inherit; }
	rect { fill: color-mix(in srgb, var(--accent) 62%, transparent); }
	rect.on { fill: var(--accent); }
	.quiet rect { fill: color-mix(in srgb, var(--muted) 55%, transparent); }
	.tip { position: absolute; display: grid; gap: 0.1rem; padding: 0.4rem 0.65rem; border-radius: 0.5rem; background: var(--text); color: var(--bg);
		font-size: var(--t-13-6); line-height: 1.3; white-space: nowrap; pointer-events: none; box-shadow: 0 6px 20px rgb(0 0 0 / 0.25); }
	.tip b { font-size: var(--t-15); }
	.tip span { opacity: 0.75; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
