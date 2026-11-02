<script lang="ts">
	import type { Track } from './api';
	import LikeButton from './LikeButton.svelte';
	import { formatDuration, player } from './player.svelte';

	let { tracks, index, rank }: { tracks: Track[]; index: number; rank?: number } = $props();
	const track = $derived(tracks[index]);
	const active = $derived(player.current?.id === track.id);
</script>

<li class="row" class:active>
	<button class="play" onclick={() => player.play(tracks, index)} aria-label="play {track.metadata.title}">
		{#if rank}<span class="rank">{rank}</span>{/if}
		{#if track.media.artwork?.url}
			<img src={track.media.artwork.url} alt="" loading="lazy" />
		{:else}
			<span class="art-fallback" aria-hidden="true">♪</span>
		{/if}
	</button>
	<div class="meta">
		<a class="title" href="/track/{track.id}">{track.metadata.title}</a>
		<a class="artist" href="/u/{track.artist.profile.handle}">
			{track.artist.profile.display_name || track.artist.profile.handle}
		</a>
	</div>
	<span class="stat">{track.metrics.play_count} plays</span>
	<span class="stat">{formatDuration(track.metadata.duration_seconds)}</span>
	<LikeButton {track} />
</li>

<style>
	.row {
		display: grid;
		grid-template-columns: auto 1fr auto auto auto;
		gap: 0.75rem;
		align-items: center;
		padding: 0.5rem;
		border-radius: 8px;
	}
	.row:hover,
	.row.active {
		background: var(--surface-2);
	}
	.play {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		color: inherit;
	}
	.rank {
		width: 1.5rem;
		text-align: right;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	img,
	.art-fallback {
		width: 44px;
		height: 44px;
		border-radius: 6px;
		object-fit: cover;
		background: var(--surface-3);
		display: grid;
		place-items: center;
	}
	.meta {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.title,
	.artist {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-decoration: none;
	}
	.title {
		color: var(--text);
		font-weight: 600;
	}
	.artist {
		color: var(--muted);
		font-size: 0.875rem;
	}
	.stat {
		color: var(--muted);
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
	}
	@media (max-width: 600px) {
		.row {
			grid-template-columns: auto 1fr auto;
		}
		.stat {
			display: none;
		}
	}
</style>
