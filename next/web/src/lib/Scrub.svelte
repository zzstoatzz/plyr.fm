<script lang="ts">
	import { player } from './player.svelte';
	import { clock } from './tracks';
	import ChapterWheel from './ChapterWheel.svelte';
	import type { Chapter } from '@plyr/next-core/chapters';

	let scrub: number | undefined = $state();
	let { clockLabels = true, stacked = false, chapters = [], chapter = -1 }: {
		clockLabels?: boolean; stacked?: boolean; chapters?: Chapter[]; chapter?: number;
	} = $props();
	let preview: number | undefined = $state();
	const position = $derived(scrub ?? player.position);
</script>


<div class="scrub" class:clockLabels class:stacked>
	{#if clockLabels}<span>{clock(position)}</span>{/if}
	<input aria-label="Playback position" type="range" min="0" max={player.duration || 1} step="0.01"
		value={Math.min(position, player.duration)}
		style:--fill={`${player.duration ? Math.min(100, position / player.duration * 100) : 0}%`}
		disabled={!player.duration || !player.canSeek}
		oninput={event => { scrub = event.currentTarget.valueAsNumber; }}
		onchange={event => { player.seek(event.currentTarget.valueAsNumber); scrub = undefined; }}
		onblur={() => { scrub = undefined; }} />
	{#if preview !== undefined && player.duration}<span class="ghost" aria-hidden="true" style:left={`${Math.min(100, preview / player.duration * 100)}%`}></span>{/if}
	{#if stacked}{#if chapters[chapter]}<ChapterWheel {chapters} current={chapter} seek={player.canSeek ? seconds => player.seek(seconds) : undefined} bind:preview />{:else}<span></span>{/if}{/if}
	{#if clockLabels}<span>{stacked && player.duration ? `−${clock(Math.max(0, player.duration - position))}` : clock(player.duration)}</span>{/if}
</div>

<style>
	.scrub { display: flex; align-items: center; gap: 0.6rem; min-width: 0; }
	.stacked { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 0.15rem 0.5rem; }
	.stacked input { grid-area: 1 / 1 / 2 / 4; min-height: 2rem; }
	.scrub { position: relative; }
	.ghost { position: absolute; top: 0.4rem; width: 2px; height: 1.2rem; margin-left: -1px; border-radius: 1px; background: var(--text); opacity: 0.75; pointer-events: none; }
	.stacked .ghost { grid-area: 1 / 1 / 2 / 4; }
	.stacked span:last-child { justify-self: end; }
	input { margin: 0; }
	span { color: var(--muted); font-size: 0.75rem; font-variant-numeric: tabular-nums; }
</style>
