<script lang="ts">
	/** Bars over time, as many as the range has (up to a year of days). Hover, tap or arrow through them; the selected
	 *  bar's value shows in a tip. `average` draws a running average over that many bars as a line on top.
	 *  `quiet` draws the secondary series (uploads) in the muted ink, short and without a tip of its own. */
	type Bar = { value: number; detail: string; tick?: string };
	let { bars, height = 190, label, unit, quiet = false, axis = true, average, selected = $bindable<number | undefined>() }: {
		bars: Bar[]; height?: number; label: string; unit: [string, string]; quiet?: boolean; axis?: boolean; average?: number; selected?: number;
	} = $props();

	let width = $state(0);
	const left = $derived(axis ? 34 : 4);
	const bottom = $derived(axis ? 22 : 2);
	const max = $derived(Math.max(1, ...bars.map(bar => bar.value)));
	const peak = $derived(bars.findIndex(bar => bar.value === max && bar.value > 0));
	const step = $derived(bars.length ? Math.max(0, width - left - 4) / bars.length : 0);
	const gap = $derived(step > 6 ? Math.min(6, step * 0.22) : step > 2.5 ? step * 0.25 : 0);
	const plot = $derived(height - bottom - 8);
	const ticks = $derived(niceTicks(max, quiet ? 1 : 3));
	const top = $derived(Math.max(max, ticks.at(-1) ?? max));
	let tipWidth = $state(0);
	const shown = $derived(selected ?? (quiet ? undefined : peak >= 0 ? peak : undefined));
	/** tick labels at least 44px apart, so a crowded axis drops some rather than overlapping */
	const ticksShown = $derived.by(() => {
		let last = -Infinity;
		return bars.flatMap((bar, index) => {
			const x = left + index * step;
			if (!bar.tick || x - last < 44) return [];
			last = x;
			return [{ x, text: bar.tick }];
		});
	});
	const line = $derived.by(() => {
		if (!average || bars.length < 2) return '';
		let sum = 0;
		return bars.map((bar, index) => {
			sum += bar.value - (index >= average ? bars[index - average].value : 0);
			return `${(left + index * step + step / 2).toFixed(1)},${y(sum / Math.min(index + 1, average)).toFixed(1)}`;
		}).join(' ');
	});

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
			{#each bars as bar, index (index)}
				{#if bar.value}
					{@const h = Math.max(1.5, plot - (y(bar.value) - 8))}
					<rect x={left + index * step + gap / 2} y={8 + plot - h} width={Math.max(0.8, step - gap)} height={h} class:on={index === shown} />
				{/if}
			{/each}
			{#if line}<polyline points={line} class="average" />{/if}
			{#if shown !== undefined && !quiet && step < 6}
				<line x1={left + shown * step + step / 2} x2={left + shown * step + step / 2} y1={8} y2={8 + plot} class="cursor" />
			{/if}
			{#if axis}
				{#each ticksShown as tick (tick.x)}<text x={tick.x} y={height - 6} class="axis">{tick.text}</text>{/each}
			{/if}
		</svg>
		{#if shown !== undefined && bars[shown] && !quiet}
			{@const bar = bars[shown]}
			<div class="tip" bind:offsetWidth={tipWidth} style:left="{Math.max(0, Math.min(width - tipWidth, left + shown * step + step / 2 - tipWidth / 2))}px" style:top="{Math.max(0, y(bar.value) - 52)}px">
				<b>{count(bar.value)}</b><span>{bar.detail}</span>
			</div>
		{/if}
		<p class="sr" aria-live="polite">{shown !== undefined && bars[shown] && selected !== undefined ? `${bars[shown].detail}: ${count(bars[shown].value)}` : ''}</p>
	{/if}
</div>

<style>
	.chart { position: relative; min-width: 0; }
	svg { display: block; overflow: visible; touch-action: pan-y; }
	svg:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 6px; }
	.grid { stroke: color-mix(in srgb, var(--text) 8%, transparent); }
	.axis { fill: var(--faint, var(--muted)); font-size: var(--t-11-2); font-family: inherit; }
	rect { fill: color-mix(in srgb, var(--accent) 55%, transparent); }
	.average { fill: none; stroke: var(--text); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; opacity: 0.85; pointer-events: none; }
	.cursor { stroke: var(--text); stroke-dasharray: 2 3; opacity: 0.45; }
	rect.on { fill: var(--accent); }
	.quiet rect { fill: color-mix(in srgb, var(--muted) 55%, transparent); }
	.tip { position: absolute; display: grid; gap: 0.1rem; padding: 0.4rem 0.65rem; border-radius: 0.25rem; background: var(--text); color: var(--bg);
		font-size: var(--t-13-6); line-height: 1.3; white-space: nowrap; pointer-events: none; box-shadow: 0 6px 20px rgb(0 0 0 / 0.25); }
	.tip b { font-size: var(--t-15); }
	.tip span { opacity: 0.75; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
