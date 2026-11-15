<script lang="ts">
	import { player } from './player.svelte';
	import { artistName, clock } from './tracks';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';
	let { close }: { close?: () => void } = $props();
</script>

<section aria-label="Queue" class="queue">
	<header>
		<h1>queue</h1>
		{#if close}<button class="icon-button" type="button" aria-label="Close queue" onclick={close}><Icon name="x" /></button>{/if}
	</header>
	{#if player.liveStation}
		<p class="state">you’re tuned to {player.liveStation.label} radio.</p>
		<button class="text-button" onclick={() => player.stopRadio()}>leave radio</button>
	{:else if player.current}
		<h2>now playing</h2>
		{@render row(player.current, player.index, true)}
		<div class="queue-head">
			<h2>up next</h2>
			{#if player.index + 1 < player.queue.length}
				<button class="text-button" type="button" onclick={() => player.clear()}>clear</button>
			{/if}
		</div>
		{#each player.queue.slice(player.index + 1) as track, offset}
			{@render row(track, player.index + offset + 1, false)}
		{:else}
			<p class="state">add a track to hear it next.</p>
		{/each}
	{:else}
		<p class="state">your queue is empty.</p>
		<a href="/">browse tracks</a>
	{/if}
	{#if !player.localMode && player.snapshot.queueError}<p class="state" role="status">{player.snapshot.queueError}</p>{/if}
</section>

{#snippet row(track: NonNullable<typeof player.current>, index: number, current: boolean)}
	<div class="row">
		<button class="cover" type="button" aria-label={`${current && player.playing ? 'Pause' : 'Play'} ${track.metadata.title}`} onclick={() => current ? player.toggle() : player.jump(index)}>
			<Artwork src={trackArtwork(track)} size={40} eager={index - player.index < 8} />
		</button>
		<div class="labels">
			{#if player.privateMode}<span class="truncate">{track.metadata.title}</span>{:else}<a class="truncate" href={`/track/${track.id}`}>{track.metadata.title}</a>{/if}
			<span class="subtle truncate">{artistName(track)}</span>
		</div>
		<span class="subtle time">{clock(track.metadata.duration_seconds)}</span>
		{#if !current}
			<button class="icon-button" aria-label={`Move ${track.metadata.title} up`} disabled={index === player.index + 1} onclick={() => player.move(index, index - 1)}>↑</button>
			<button class="icon-button" aria-label={`Remove ${track.metadata.title}`} onclick={() => player.remove(index)}><Icon name="x" size={16} /></button>
		{/if}
	</div>
{/snippet}

<style>
	.queue { padding: 1rem; }
	header, .queue-head { display: flex; justify-content: space-between; align-items: center; }
	h1 { font-size: 1.35rem; }
	h2 { color: var(--muted); font-size: 0.82rem; font-weight: 550; margin: 0.8rem 0 0.5rem; }
	.row { display: flex; align-items: center; gap: 0.45rem; min-width: 0; min-height: 3.1rem; }
	.cover { border: 0; padding: 0; width: 2.5rem; flex: none; border-radius: 0.35rem; background: none; }
	.labels { min-width: 0; flex: 1; display: grid; font-size: 0.87rem; }
	.labels span, .time { font-size: 0.75rem; }
	.time { font-variant-numeric: tabular-nums; }
</style>
