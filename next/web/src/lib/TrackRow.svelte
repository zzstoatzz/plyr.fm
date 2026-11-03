<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Track } from './api';
	import { menus } from './menus.svelte';
	import { artistName, formatDuration, player } from './player.svelte';
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';

	let {
		tracks,
		index,
		rank,
		actions
	}: { tracks: Track[]; index: number; rank?: number; actions?: Snippet } = $props();
	const track = $derived(tracks[index]);
	const active = $derived(player.current?.id === track.id);
</script>

<li class="row" class:active>
	{#if rank}<span class="rank">{rank}</span>{/if}
	<!-- the whole row plays (a big, easy target); details and the artist live in the … menu -->
	<button
		class="hit"
		onclick={() => (active ? player.toggle() : player.play(tracks, index))}
		aria-label="{active && player.playing ? 'pause' : 'play'} {track.metadata.title} by {artistName(track)}"
	>
		<span class="art">
			<Artwork src={track.media.artwork?.url} seed={track.metadata.title} size="clamp(2.5rem, 14vw, 3rem)" />
			{#if active}
				<span class="eq" class:paused={!player.playing} aria-hidden="true"><i></i><i></i><i></i></span>
			{/if}
		</span>
		<span class="meta">
			<span class="title ellipsis">{track.metadata.title}</span>
			<span class="sub ellipsis">
				{artistName(track)}{#if track.metadata.duration_seconds}{' · '}{formatDuration(track.metadata.duration_seconds)}{/if}
			</span>
		</span>
	</button>
	{#if actions}{@render actions()}{/if}
	<button class="btn ghost icon" onclick={() => (menus.track = track)} aria-label="more for {track.metadata.title}">
		<Icon name="more" stroke={3} />
	</button>
</li>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: var(--s-md);
		padding: var(--s-sm) var(--s-sm) var(--s-sm) var(--s-lg);
	}
	@media (hover: hover) {
		.row:hover {
			background: var(--c-25);
		}
	}
	.rank {
		min-width: 1ch;
		text-align: right;
		font-size: var(--t-sm);
		font-weight: 600;
		color: var(--c-600);
		font-variant-numeric: tabular-nums;
	}
	.hit {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: var(--s-md);
		padding: 0;
		border: 0;
		background: none;
		text-align: left;
		cursor: pointer;
		border-radius: var(--r-sm);
	}
	.art {
		position: relative;
		display: block;
	}
	.meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.title {
		font-weight: 600;
	}
	.active .title {
		color: var(--accent-text);
	}
	.sub {
		font-size: var(--t-sm);
		color: var(--c-600);
	}
	.eq {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		gap: 2px;
		padding-bottom: 0.75rem;
		background: rgb(0 0 0 / 0.45);
		border-radius: var(--r-sm);
	}
	.eq i {
		width: 3px;
		height: 0.875rem;
		background: #fff;
		border-radius: 1px;
		animation: bounce 0.9s ease-in-out infinite;
		transform-origin: bottom;
	}
	.eq i:nth-child(2) {
		animation-delay: -0.3s;
	}
	.eq i:nth-child(3) {
		animation-delay: -0.6s;
	}
	.eq.paused i {
		animation-play-state: paused;
	}
	@keyframes bounce {
		50% {
			transform: scaleY(0.3);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.eq i {
			animation: none;
		}
	}
</style>
