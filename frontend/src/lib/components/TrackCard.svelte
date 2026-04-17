<script lang="ts">
	import { browser } from '$app/environment';
	import SensitiveImage from './SensitiveImage.svelte';
	import LikersTooltip from './LikersTooltip.svelte';
	import { likersSheet } from '$lib/likers-sheet.svelte';
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

	let isMobile = $state(false);

	$effect(() => {
		if (browser) {
			const mq = window.matchMedia('(max-width: 768px)');
			isMobile = mq.matches;
			const handler = (e: MediaQueryListEvent) => (isMobile = e.matches);
			mq.addEventListener('change', handler);
			return () => mq.removeEventListener('change', handler);
		}
	});

	// desktop tooltip state
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

	function handleLikesClick(e: Event) {
		e.stopPropagation();
		if (isMobile) {
			likersSheet.open(track.id, likeCount);
		}
	}

	function handleLikesKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.stopPropagation();
			if (isMobile) {
				likersSheet.open(track.id, likeCount);
			}
		}
	}

	function handleLikesMouseEnter(e: Event) {
		if (isMobile) return;
		e.stopPropagation();
		openLikers();
	}

	function handleLikesMouseLeave(e: Event) {
		if (isMobile) return;
		e.stopPropagation();
		closeLikers();
	}
</script>

<button
	class="track-card"
	class:playing={isPlaying}
	class:tooltip-open={showLikersTooltip}
	onclick={(e) => {
		if (e.target instanceof HTMLAnchorElement || (e.target as HTMLElement).closest('a')) return;
		onPlay(track);
	}}
>
	<div class="artwork" class:gated={track.gated} class:avatar-fallback={!track.image_url && track.artist_avatar_url}>
		{#if track.image_url}
			<SensitiveImage src={track.thumbnail_url ?? track.image_url}>
				<img
					src={track.thumbnail_url ?? track.image_url}
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
		<a href="/track/{track.id}" class="title" title={track.title}>{track.title}</a>
		<a
			href="/u/{track.artist_handle}"
			class="artist"
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
					onclick={handleLikesClick}
					onkeydown={handleLikesKeydown}
					onmouseenter={handleLikesMouseEnter}
					onmouseleave={handleLikesMouseLeave}
					onfocus={handleLikesMouseEnter}
					onblur={handleLikesMouseLeave}
				>
					{likeCount} {likeCount === 1 ? 'like' : 'likes'}
					{#if showLikersTooltip && !isMobile}
						<LikersTooltip
							trackId={track.id}
							{likeCount}
							onMouseEnter={openLikers}
							onMouseLeave={closeLikers}
							forceBelow
						/>
					{/if}
				</span>
			{/if}
		</div>
	</div>
</button>

<style>
	.track-card {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		min-width: 220px;
		max-width: 220px;
		padding: 0.5rem;
		background: var(--track-bg, var(--bg-secondary));
		border: 1px solid var(--track-border, var(--border-subtle));
		border-radius: var(--radius-md);
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		color: inherit;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
		transition: box-shadow 0.2s ease-out, background 0.15s ease-out, border-color 0.15s ease-out;
		position: relative;
		scroll-snap-align: start;
	}

	.track-card:hover {
		border-color: color-mix(in srgb, var(--accent) 15%, var(--track-border-hover, var(--border-default)));
		background: var(--track-bg-hover, var(--bg-tertiary));
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 0 8px color-mix(in srgb, var(--accent) 8%, transparent);
	}

	.track-card.playing {
		background: color-mix(in srgb, var(--accent) 10%, var(--track-bg-playing, var(--bg-tertiary)));
		border-color: color-mix(in srgb, var(--accent) 20%, var(--track-border, var(--border-subtle)));
	}

	.track-card.tooltip-open {
		z-index: 60;
	}

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

	.artwork.avatar-fallback {
		border-radius: var(--radius-full);
		border: 1.5px solid var(--border-default);
	}

	.artwork.avatar-fallback img {
		border-radius: var(--radius-full);
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
		border: 2px solid var(--track-bg, var(--bg-secondary));
		border-radius: var(--radius-full);
		color: white;
		z-index: 1;
	}

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
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.3;
		transition: color 0.15s;
		width: fit-content;
		max-width: 100%;
	}

	.title:hover {
		color: var(--accent);
	}

	.artist {
		font-size: var(--text-xs);
		color: var(--text-muted);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color 0.15s;
		width: fit-content;
		max-width: 100%;
	}

	.artist:hover {
		color: var(--accent);
	}

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

	@media (max-width: 768px) {
		.likes {
			cursor: pointer;
		}
	}
</style>
