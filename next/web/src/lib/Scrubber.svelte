<script lang="ts">
	import { formatDuration, player } from './player.svelte';

	let { compact = false }: { compact?: boolean } = $props();
	// while dragging, show the drag position instead of the playhead
	let dragging = $state<number | null>(null);
	const max = $derived(player.duration || 0);
	const value = $derived(dragging ?? player.time);
	const pct = $derived(max ? (value / max) * 100 : 0);
</script>

<div class="scrub" class:compact>
	<input
		type="range"
		min="0"
		max={max || 1}
		step="0.1"
		{value}
		style:--pct="{pct}%"
		aria-label="seek"
		aria-valuetext="{formatDuration(value)} of {formatDuration(max)}"
		disabled={!player.current}
		oninput={(e) => (dragging = +(e.currentTarget as HTMLInputElement).value)}
		onchange={(e) => {
			player.seek(+(e.currentTarget as HTMLInputElement).value);
			dragging = null;
		}}
	/>
	{#if !compact}
		<div class="times small muted">
			<span>{formatDuration(value)}</span>
			<span>-{formatDuration(Math.max(0, max - value))}</span>
		</div>
	{/if}
</div>

<style>
	.scrub {
		width: 100%;
	}
	input {
		-webkit-appearance: none;
		appearance: none;
		width: 100%;
		height: 20px;
		margin: 0;
		background: transparent;
		cursor: pointer;
	}
	input::-webkit-slider-runnable-track {
		height: 4px;
		border-radius: var(--r-full);
		background: linear-gradient(to right, var(--c-1000) var(--pct), var(--c-100) var(--pct));
	}
	input::-moz-range-track {
		height: 4px;
		border-radius: var(--r-full);
		background: linear-gradient(to right, var(--c-1000) var(--pct), var(--c-100) var(--pct));
	}
	input::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		margin-top: -5px;
		border-radius: 50%;
		background: var(--c-1000);
		border: 0;
	}
	input::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--c-1000);
		border: 0;
	}
	.compact input::-webkit-slider-thumb {
		width: 10px;
		height: 10px;
		margin-top: -3px;
	}
	.times {
		display: flex;
		justify-content: space-between;
		font-variant-numeric: tabular-nums;
	}
</style>
