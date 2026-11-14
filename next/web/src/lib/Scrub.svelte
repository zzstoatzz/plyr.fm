<script lang="ts">
	import { player } from './player.svelte';
	import { clock } from './tracks';

	let scrub: number | undefined = $state();
	let { clockLabels = true }: { clockLabels?: boolean } = $props();
	const position = $derived(scrub ?? player.position);
</script>

<div class="scrub" class:clockLabels>
	{#if clockLabels}<span>{clock(position)}</span>{/if}
	<input aria-label="Playback position" type="range" min="0" max={player.duration || 1} step="0.01"
		value={Math.min(position, player.duration)}
		disabled={!player.duration}
		oninput={event => { scrub = event.currentTarget.valueAsNumber; }}
		onchange={event => { player.seek(event.currentTarget.valueAsNumber); scrub = undefined; }}
		onblur={() => { scrub = undefined; }} />
	{#if clockLabels}<span>{clock(player.duration)}</span>{/if}
</div>

<style>
	.scrub { display: flex; align-items: center; gap: 0.6rem; min-width: 0; }
	input { margin: 0; }
	span { color: var(--muted); font-size: 0.75rem; font-variant-numeric: tabular-nums; }
</style>
