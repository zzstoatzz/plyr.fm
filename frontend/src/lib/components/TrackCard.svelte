<script lang="ts">
	import SensitiveImage from './SensitiveImage.svelte';
	import LikersTooltip from './LikersTooltip.svelte';
	import type { Track } from '$lib/types';

	interface Props {
		track: Track;
		isPlaying?: boolean;
		onPlay: (track: Track) => void;
		index?: number;
	}

	let { track, isPlaying = false, onPlay, index = 0 }: Props = $props();

	let imageLoading = $derived(index < 3 ? 'eager' as const : 'lazy' as const);
	let likeCount = $derived(track.like_count || 0);

	let showLikersTooltip = $state(false);
	let likersTooltipTimeout: ReturnType<typeof setTimeout> | null = null;

	function openLikers() {
		if (likersTooltipTimeout) {
			clearTimeout(likersTooltipTimeout);
			likersTooltipTimeout = null;
		}
		showLikersTooltip = true;
	}

	function closeLikers() {
		likersTooltipTimeout = setTimeout(() => {
			showLikersTooltip = false;
			likersTooltipTimeout = null;
		}, 150);
	}

	function handleLikesMouseEnter(e: Event) {
		e.stopPropagation();
		openLikers();
	}

	function handleLikesMouseLeave(e: Event) {
		e.stopPropagation();
		closeLikers();
	}
</script>

<button
	class="track-card"
	class:playing={isPlaying}
	class:tooltip-open={showLikersTooltip}
	onclick={() => onPlay(track)}
>
	<div class="artwork" class:gated={track.gated}>
		{#if track.image_url}
			<SensitiveImage src={track.image_url}>
				<img
					src={track.image_url}
					alt="{track.title} artwork"
					loading={imageLoading}
				/>
			</SensitiveImage>
		{:else if track.artist_avatar_url}
			<SensitiveImage src={track.artist_avatar_url}>
				<img
					src={track.artist_avatar_url}
					alt={track.artist}
					loading={imageLoading}
					class="avatar"
				/>
			</SensitiveImage>
		{:else}
			<div class="placeholder">
				<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg">
					<circle cx="8" cy="5" r="3" fill="none" />
					<path d="M3 14c0-2.5 2-4.5 5-4.5s5 2 5 4.5" stroke-linecap="round" />
				</svg>
			</div>
		{/if}
		{#if track.gated}
			<div class="gated-badge" title="supporters only">
				<svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
				</svg>
			</div>
		{/if}
	</div>
	<div class="info">
		<span class="title" title={track.title}>{track.title}</span>
		<a
			href="/u/{track.artist_handle}"
			class="artist"
			onclick={(e) => e.stopPropagation()}
		>
			{track.artist}
		</a>
		<div class="meta">
			<span>{track.play_count} {track.play_count === 1 ? 'play' : 'plays'}</span>
			{#if likeCount > 0}
				<span class="meta-sep">&middot;</span>
				<span
					class="likes"
					role="button"
					tabindex="0"
					aria-label="{likeCount} {likeCount === 1 ? 'like' : 'likes'}"
					aria-expanded={showLikersTooltip}
					onmouseenter={handleLikesMouseEnter}
					onmouseleave={handleLikesMouseLeave}
					onfocus={handleLikesMouseEnter}
					onblur={handleLikesMouseLeave}
				>
					{likeCount} {likeCount === 1 ? 'like' : 'likes'}
					{#if showLikersTooltip}
						<LikersTooltip
							trackId={track.id}
							{likeCount}
							onMouseEnter={openLikers}
							onMouseLeave={closeLikers}
						/>
					{/if}
				</span>
			{/if}
		</div>
	</div>
</button>

<style>
	/* horizontal card: artwork left, text right */
	.track-card {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.625rem;
		min-width: 240px;
		max-width: 240px;
		padding: 0.5rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		color: inherit;
		transition: border-color 0.15s, background 0.15s;
		position: relative;
	}

	.track-card:hover {
		border-color: var(--accent);
		background: var(--bg-hover);
	}

	.track-card.playing {
		background: color-mix(in srgb, var(--accent) 10%, var(--bg-secondary));
		border-color: color-mix(in srgb, var(--accent) 25%, var(--border-subtle));
	}

	.track-card.tooltip-open {
		z-index: 60;
	}

	/* artwork — small square thumbnail */
	.artwork {
		position: relative;
		width: 48px;
		height: 48px;
		flex-shrink: 0;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--bg-tertiary);
	}

	.artwork img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.artwork img.avatar {
		border-radius: var(--radius-full);
		border: 1.5px solid var(--border-default);
	}

	.artwork.gated::after {
		content: '';
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.3);
		pointer-events: none;
	}

	.placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}

	.gated-badge {
		position: absolute;
		bottom: -3px;
		right: -3px;
		width: 16px;
		height: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--accent);
		border: 2px solid var(--bg-secondary);
		border-radius: var(--radius-full);
		color: white;
		z-index: 1;
	}

	/* text content — stacked vertically */
	.info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.3;
	}

	.artist {
		font-size: var(--text-xs);
		color: var(--text-muted);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color 0.15s;
	}

	.artist:hover {
		color: var(--accent);
	}

	/* meta row — no overflow hidden so tooltip escapes */
	.meta {
		display: flex;
		align-items: center;
		gap: 0.25em;
		font-size: var(--text-xs);
		color: var(--text-tertiary);
	}

	.meta-sep {
		color: var(--text-muted);
	}

	.likes {
		position: relative;
		cursor: help;
		transition: color 0.15s;
	}

	.likes:hover {
		color: var(--accent);
	}
</style>
