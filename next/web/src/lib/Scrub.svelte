<script lang="ts">
	import { player } from './player.svelte';
	import { clock } from './tracks';

	let scrub: number | undefined = $state();
	let { clockLabels = true, stacked = false, chapter }: { clockLabels?: boolean; stacked?: boolean; chapter?: string } = $props();
	const position = $derived(scrub ?? player.position);
</script>

<div class="scrub" class:clockLabels class:stacked>
	{#if clockLabels}<span>{clock(position)}</span>{/if}
	<input aria-label="Playback position" type="range" min="0" max={player.duration || 1} step="0.01"
		value={Math.min(position, player.duration)}
		disabled={!player.duration || !player.canSeek}
		oninput={event => { scrub = event.currentTarget.valueAsNumber; }}
		onchange={event => { player.seek(event.currentTarget.valueAsNumber); scrub = undefined; }}
		onblur={() => { scrub = undefined; }} />
	{#if stacked}<span class="chapter truncate" aria-live="polite">{chapter ? `now: ${chapter}` : ''}</span>{/if}
	{#if clockLabels}<span>{stacked && player.duration ? `−${clock(Math.max(0, player.duration - position))}` : clock(player.duration)}</span>{/if}
</div>

<style>
	.scrub { display: flex; align-items: center; gap: 0.6rem; min-width: 0; }
	.stacked { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 0.15rem 0.5rem; }
	.stacked input { grid-area: 1 / 1 / 2 / 4; min-height: 2rem; }
	.chapter { color: var(--accent); text-align: center; }
	.stacked span:last-child { justify-self: end; }
	input { margin: 0; }
	span { color: var(--muted); font-size: 0.75rem; font-variant-numeric: tabular-nums; }
</style>
