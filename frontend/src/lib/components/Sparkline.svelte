<script lang="ts">
	import type { ActivityHistogramBucket } from '$lib/types';

	let { histogram }: { histogram: ActivityHistogramBucket[] } = $props();

	const sparklinePath = $derived.by(() => {
		if (histogram.length === 0) return '';
		const max = Math.max(...histogram.map((b) => b.count), 1);
		const w = 100;
		const h = 32;
		const step = w / (histogram.length - 1 || 1);
		const points = histogram.map((b, i) => `${i * step},${h - (b.count / max) * h * 0.85}`);
		return `M${points.join(' L')} L${w},${h} L0,${h} Z`;
	});
</script>

<div class="sparkline-container">
	<span class="sparkline-label">last 7 days</span>
	<svg class="sparkline" viewBox="0 0 100 32" preserveAspectRatio="none">
		<defs>
			<linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color="var(--accent)" stop-opacity="0.3" />
				<stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02" />
			</linearGradient>
		</defs>
		<path d={sparklinePath} fill="url(#spark-fill)" />
		<path
			d={sparklinePath.replace(/ L\d+,32 L0,32 Z/, '')}
			fill="none" stroke="var(--accent)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"
		/>
	</svg>
</div>

<style>
	.sparkline-container {
		margin-bottom: 1.25rem;
		position: relative;
		background: color-mix(in srgb, var(--track-bg) 70%, transparent);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border: 1px solid var(--glass-border, var(--track-border));
		border-radius: var(--radius-md);
		padding: 0.625rem 0.75rem 0.375rem;
	}

	.sparkline-label {
		font-size: var(--text-xs);
		color: var(--text-muted);
		position: absolute;
		top: 0.375rem;
		right: 0.625rem;
	}

	.sparkline {
		width: 100%;
		height: 32px;
		display: block;
	}
</style>
