<script lang="ts">
	import { API_URL } from '$lib/config';
	import { monotonePath, rollingMean, type ChartPoint } from '$lib/activity-smoothing';
	import type { ActivityHistogramResponse } from '$lib/types';

	const ranges = ['day', 'week', 'month', 'year', 'all'] as const;
	type Range = (typeof ranges)[number];
	const seriesOptions = ['activity', 'plays'] as const;
	type Series = (typeof seriesOptions)[number];
	const descriptions = {
		day: 'past 24 hours',
		week: 'past 7 days',
		month: 'past 30 days',
		year: 'past 365 days',
		all: 'all time'
	} satisfies Record<Range, string>;
	const averageWindows = {
		day: { size: 3, label: '3-hour average' },
		week: { size: 12, label: '12-hour average' },
		month: { size: 3, label: '3-day average' },
		year: { size: 7, label: '7-day average' },
		all: { size: 1, label: '' }
	} satisfies Record<Range, { size: number; label: string }>;
	const id = $props.id();
	let range = $state<Range>('week');
	let series = $state<Series>('activity');
	let response = $state<ActivityHistogramResponse | null>(null);
	let loading = $state(true);
	let failed = $state(false);
	let attempt = $state(0);
	let active = $state<number | null>(null);
	let position = $state(0);
	const buckets = $derived(response?.buckets ?? []);
	const noun = $derived(series === 'plays' ? 'play' : 'event');
	const total = $derived(buckets.reduce((sum, bucket) => sum + bucket.count, 0));
	const peak = $derived(Math.max(1, ...buckets.map((bucket) => bucket.count)));
	const ceiling = $derived(Math.ceil(peak / 4) * 4);
	const selected = $derived(active === null ? null : buckets[active]);
	const averaging = $derived(averageWindows[range]);
	const trend = $derived(
		rollingMean(
			buckets.map((bucket) => bucket.count),
			averaging.size,
			Math.max(0, buckets.length - 1)
		)
	);
	const trackedSince = $derived(
		response?.series === 'plays'
			? response.tracked_since === null
				? Infinity
				: Date.parse(response.tracked_since)
			: -Infinity
	);
	const scrobbledOnly = $derived(
		buckets.map(
			(_, i) => i < buckets.length - 1 && bucketStart(buckets[i + 1].date) <= trackedSince
		)
	);
	const xs = $derived(
		buckets.map((_, i) => (buckets.length === 1 ? 500 : (i / (buckets.length - 1)) * 1000))
	);
	const yFor = (value: number): number => 180 - (value / ceiling) * 172;
	const barWidth = $derived(Math.max(1, Math.min(24, (1000 / Math.max(1, buckets.length)) * 0.7)));
	const bars = $derived(
		buckets.map((bucket, i) => ({
			x: Math.min(1000 - barWidth, Math.max(0, xs[i] - barWidth / 2)),
			y: yFor(bucket.count),
			height: 180 - yFor(bucket.count)
		}))
	);
	const trendPoints = $derived(
		trend.flatMap((value, i): (ChartPoint & { index: number })[] =>
			value === null ? [] : [{ x: xs[i], y: yFor(value), index: i }]
		)
	);
	const boundary = $derived(trendPoints.findLastIndex((point) => scrobbledOnly[point.index]));
	const scrobbledLine = $derived(
		boundary < 0 ? '' : monotonePath(trendPoints.slice(0, boundary + 2))
	);
	const trackedLine = $derived(monotonePath(trendPoints.slice(Math.max(0, boundary + 1))));
	const areaLine = $derived(monotonePath(trendPoints));
	const marker = $derived(
		active === null ? null : { x: xs[active], y: yFor(trend[active] ?? buckets[active].count) }
	);
	const ticks = $derived(
		[...new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1])].filter(
			(i) => i >= 0
		)
	);

	function bucketStart(date: string): number {
		return Date.parse(date.length === 10 ? `${date}T00:00:00Z` : date);
	}

	function count(value: number): string {
		return `${value.toLocaleString()} ${value === 1 ? noun : `${noun}s`}`;
	}

	$effect(() => {
		const requestedRange = range;
		const requestedSeries = series;
		void attempt;
		const controller = new AbortController();
		loading = true;
		failed = false;
		response = null;
		active = null;
		async function load(): Promise<void> {
			try {
				const result = await fetch(
					`${API_URL}/activity/histogram?range=${requestedRange}&series=${requestedSeries}`,
					{ signal: controller.signal }
				);
				if (!result.ok) throw new Error('activity unavailable');
				const data: ActivityHistogramResponse = await result.json();
				if (!data.interval) throw new Error('activity ranges unavailable');
				if (!controller.signal.aborted) {
					response = data;
					position = Math.max(0, data.buckets.length - 1);
				}
			} catch {
				if (!controller.signal.aborted) failed = true;
			} finally {
				if (!controller.signal.aborted) loading = false;
			}
		}
		void load();
		return () => controller.abort();
	});

	function dateLabel(date: string, detailed = false): string {
		const value = new Date(date.length === 10 ? `${date}T00:00:00Z` : date);
		const options: Intl.DateTimeFormatOptions = { timeZone: 'UTC' };
		if (response?.interval === 'month') {
			options.month = detailed ? 'long' : 'short';
			options.year = 'numeric';
		} else if (response?.interval === 'hour') {
			if (detailed || range === 'week') {
				options.month = 'short';
				options.day = 'numeric';
			}
			options.hour = 'numeric';
			if (detailed) options.minute = '2-digit';
		} else {
			options.month = detailed ? 'long' : 'short';
			options.day = 'numeric';
			if (detailed || range === 'year') options.year = 'numeric';
		}
		return value.toLocaleString(undefined, options);
	}

	function inspect(event: PointerEvent): void {
		if (event.pointerType !== 'mouse') return;
		const bounds =
			event.currentTarget instanceof HTMLElement
				? event.currentTarget.getBoundingClientRect()
				: null;
		if (!bounds) return;
		position = Math.round(
			Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * (buckets.length - 1)
		);
		active = position;
	}
</script>

<section class="activity-chart" aria-label="activity over time" aria-busy={loading}>
	<div class="chart-header">
		<div class="toggle" role="group" aria-label="chart series">
			{#each seriesOptions as value}
				<button
					type="button"
					aria-pressed={series === value}
					onclick={() => {
						series = value;
					}}>{value}</button
				>
			{/each}
		</div>
		<div class="toggle" role="group" aria-label="chart time range">
			{#each ranges as value}
				<button
					type="button"
					aria-pressed={range === value}
					onclick={() => {
						range = value;
					}}>{value}</button
				>
			{/each}
		</div>
	</div>
	<div class="readout" aria-live="polite" aria-atomic="true">
		{#if loading}
			<span class="readout-value">loading {series}…</span>
		{:else if failed}
			<span class="readout-value">{series} couldn’t load</span>
		{:else}
			{@const shown = selected?.count ?? total}
			<span class="readout-value"
				><strong>{shown.toLocaleString()}</strong>
				{shown === 1 ? noun : `${noun}s`}{selected && active === buckets.length - 1
					? ' so far'
					: ''}{#if selected && active !== null && averaging.size > 1 && trend[active] !== null}<span
						class="average"
						>{` · ${trend[active]?.toLocaleString(undefined, { maximumFractionDigits: 1 })} average`}</span
					>{/if}</span
			>
			<span class="readout-date"
				>{selected ? `${dateLabel(selected.date, true)} UTC` : descriptions[range]}{selected &&
				active !== null &&
				scrobbledOnly[active]
					? ' · scrobbled plays only'
					: ''}</span
			>
		{/if}
	</div>
	{#if loading || failed}
		<div class="chart-message" role="status">
			{#if failed}<button
					class="retry"
					type="button"
					onclick={() => {
						attempt += 1;
					}}>try again</button
				>{/if}
		</div>
	{:else}
		<div class="chart-body">
			<div class="y-axis" aria-hidden="true">
				{#each [ceiling, ceiling / 2, 0] as tick}<span
						>{tick.toLocaleString(undefined, { notation: 'compact' })}</span
					>{/each}
			</div>
			<div class="plot">
				<svg viewBox="0 0 1000 188" preserveAspectRatio="none" aria-hidden="true">
					<defs>
						<linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stop-color="var(--accent)" stop-opacity="0.16" />
							<stop offset="100%" stop-color="var(--accent)" stop-opacity="0.01" />
						</linearGradient>
					</defs>
					{#each [8, 94, 180] as y}<line class="grid" x1="0" x2="1000" y1={y} y2={y} />{/each}
					{#each bars as bar, i}<rect
							class="bar"
							class:active={active === i}
							x={bar.x}
							y={bar.y}
							width={barWidth}
							height={bar.height}
						/>{/each}
					{#if trendPoints.length > 1}
						<path
							d={`${areaLine} L${trendPoints.at(-1)?.x},180 L${trendPoints[0].x},180 Z`}
							fill={`url(#${id}-fill)`}
						/>
						{#if scrobbledLine}<path class="series scrobbled" d={scrobbledLine} />{/if}
						{#if trendPoints.length - boundary > 2}<path class="series" d={trackedLine} />{/if}
					{/if}
					{#if marker}
						<line class="crosshair" x1={marker.x} x2={marker.x} y1="0" y2="180" />
					{/if}
				</svg>
				{#if marker || buckets.length === 1}
					{@const point = marker ?? { x: xs[0], y: yFor(buckets[0].count) }}
					<span
						class="point"
						style:left={`${point.x / 10}%`}
						style:top={`${(point.y / 188) * 100}%`}
					></span>
				{/if}
				{#if buckets.length}
					<input
						type="range"
						class="scrubber"
						min="0"
						max={buckets.length - 1}
						step="1"
						bind:value={position}
						aria-label={`explore ${series} by date`}
						aria-valuetext={`${dateLabel(buckets[position].date, true)} UTC: ${count(buckets[position].count)}`}
						oninput={(event) => {
							active = event.currentTarget.valueAsNumber;
						}}
						onfocus={() => {
							active = position;
						}}
						onblur={() => {
							active = null;
						}}
						onpointermove={inspect}
						onpointerleave={(event) => {
							if (event.pointerType === 'mouse') active = null;
						}}
					/>
				{/if}
				{#if total === 0}<span class="empty-chart">no {series} in this period</span>{/if}
			</div>
			<div class="x-axis" aria-hidden="true">
				{#each ticks as index}<span>{dateLabel(buckets[index].date)}</span>{/each}
			</div>
		</div>
	{/if}
	<div class="chart-footer">
		<span
			>{response?.interval === 'hour'
				? 'hourly'
				: response?.interval === 'month'
					? 'monthly'
					: 'daily'}
			{noun}s{averaging.size > 1 ? ` · line is a ${averaging.label}` : ''} · UTC{#if scrobbledLine}<span
					class="legend">{' · dashed: scrobbled plays only'}</span
				>{/if}</span
		>
		<span class="hint">hover, touch, or use arrow keys</span>
	</div>
</section>

<style>
	.activity-chart {
		font-variant-numeric: lining-nums tabular-nums;
		margin-bottom: 1.5rem;
		padding: 1.25rem;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		background: var(--bg-secondary);
	}
	.chart-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.toggle {
		display: flex;
		gap: 0.125rem;
		padding: 0.1875rem;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
	}
	button {
		font-family: inherit;
		font-size: var(--text-xs);
		cursor: pointer;
		color: var(--text-secondary);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-base);
		min-height: 36px;
		padding: 0.375rem 0.75rem;
	}
	button:hover {
		color: var(--text-primary);
		background: var(--bg-hover);
	}
	button[aria-pressed='true'] {
		background: var(--bg-tertiary);
		color: var(--accent-text);
		border-color: var(--border-default);
	}
	button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.readout {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		min-height: 3.75rem;
		padding: 1.125rem 0 0.75rem;
		font-variant-numeric: tabular-nums;
	}
	.readout-value {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	strong {
		color: var(--text-primary);
		font-size: var(--text-2xl);
		font-weight: 600;
	}
	.average {
		color: var(--text-tertiary);
	}
	.readout-date {
		color: var(--text-secondary);
		font-size: var(--text-xs);
	}
	.chart-body {
		display: grid;
		grid-template-columns: 2.5rem minmax(0, 1fr);
		grid-template-rows: 188px auto;
	}
	.y-axis {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		padding-bottom: 8px;
		color: var(--text-tertiary);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}
	.plot {
		position: relative;
		min-width: 0;
	}
	svg {
		width: 100%;
		height: 100%;
		display: block;
		overflow: visible;
	}
	.grid {
		stroke: var(--border-subtle);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.bar {
		fill: var(--text-tertiary);
		opacity: 0.18;
	}
	.bar.active {
		opacity: 0.4;
	}
	.series {
		fill: none;
		stroke: var(--accent-text);
		stroke-width: 1.75;
		stroke-linejoin: round;
		stroke-linecap: round;
		vector-effect: non-scaling-stroke;
	}
	.series.scrobbled {
		stroke-dasharray: 5 5;
		opacity: 0.7;
	}
	.crosshair {
		stroke: var(--text-tertiary);
		stroke-width: 1;
		stroke-dasharray: 3 4;
		vector-effect: non-scaling-stroke;
	}
	.point {
		position: absolute;
		width: 8px;
		height: 8px;
		transform: translate(-50%, -50%);
		border-radius: var(--radius-full);
		background: var(--accent-text);
		box-shadow: 0 0 0 3px var(--bg-secondary);
		pointer-events: none;
	}
	.scrubber {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		margin: 0;
		cursor: crosshair;
		touch-action: pan-y;
	}
	.plot:has(.scrubber:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 4px;
		border-radius: var(--radius-sm);
	}
	.x-axis {
		grid-column: 2;
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		padding-top: 0.5rem;
		font-size: var(--text-xs);
		color: var(--text-tertiary);
	}
	.x-axis span:only-child {
		margin: auto;
	}
	.empty-chart {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		pointer-events: none;
		color: var(--text-secondary);
		font-size: var(--text-sm);
	}
	.chart-message {
		height: 214px;
		display: grid;
		place-items: center;
	}
	.retry {
		border-color: var(--border-default);
	}
	.chart-footer {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		margin-top: 1rem;
		font-size: var(--text-xs);
		color: var(--text-tertiary);
	}
	@media (max-width: 540px) {
		.activity-chart {
			font-variant-numeric: lining-nums tabular-nums;
			padding: 1rem 0.875rem;
		}
		.chart-header {
			flex-direction: column;
			align-items: stretch;
			gap: 0.75rem;
		}
		.toggle {
			width: 100%;
		}
		.toggle button {
			flex: 1;
			min-height: 40px;
			padding-inline: 0.5rem;
		}
		.readout {
			flex-direction: column;
			gap: 0.25rem;
			min-height: 5rem;
		}
		.chart-body {
			grid-template-columns: 2rem minmax(0, 1fr);
		}
		.chart-footer {
			flex-direction: column;
			gap: 0.375rem;
		}
	}
</style>
