<script lang="ts">
	import type { Track } from '$lib/types';
	import { onMount } from 'svelte';

	interface Props {
		track: Track;
		isOnTrackDetailPage: boolean;
	}

	let { track, isOnTrackDetailPage }: Props = $props();

	let titleEl = $state<HTMLElement | null>(null);
	let artistEl = $state<HTMLElement | null>(null);
	let albumEl = $state<HTMLElement | null>(null);
	let titleOverflows = $state(false);
	let artistOverflows = $state(false);
	let albumOverflows = $state(false);

	function checkOverflows() {
		if (typeof window === 'undefined') return;

		window.requestAnimationFrame(() => {
			if (titleEl) {
				const span = titleEl.querySelector('span');
				titleOverflows = span ? span.scrollWidth > titleEl.clientWidth : false;
			}
			if (artistEl) {
				const span = artistEl.querySelector('span');
				artistOverflows = span ? span.scrollWidth > artistEl.clientWidth : false;
			}
			if (albumEl) {
				const span = albumEl.querySelector('span');
				albumOverflows = span ? span.scrollWidth > albumEl.clientWidth : false;
			}
		});
	}

	export function recalcOverflow() {
		checkOverflows();
	}

	$effect(() => {
		if (track) {
			checkOverflows();
		}
	});

	onMount(() => {
		const handleResize = () => checkOverflows();
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	});
</script>

<div class="player-track">
	<a href="/track/{track.id}" class="player-artwork" aria-label={`view ${track.title}`}>
		{#if track.image_url}
			<img src={track.image_url} alt="{track.title} artwork" />
		{:else}
			<div class="player-artwork-placeholder">
				<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
					<path d="M9 18V5l12-2v13"></path>
					<circle cx="6" cy="18" r="3"></circle>
					<circle cx="18" cy="16" r="3"></circle>
				</svg>
			</div>
		{/if}
	</a>
	<div class="player-info">
		{#if isOnTrackDetailPage}
			<div class="player-title" class:scrolling={titleOverflows} bind:this={titleEl}>
				<span>{track.title}</span>
			</div>
		{:else}
			<a
				href="/track/{track.id}"
				class="player-title-link"
				class:scrolling={titleOverflows}
				bind:this={titleEl}
			>
				<span>{track.title}</span>
			</a>
		{/if}
		<div class="player-metadata">
			<a href="/u/{track.artist_handle}" class="metadata-link" bind:this={artistEl}>
				<svg class="metadata-icon artist-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
					<circle cx="8" cy="5" r="3" stroke="currentColor" stroke-width="1.5" fill="none" />
					<path d="M3 14c0-2.5 2-4.5 5-4.5s5 2 5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
				</svg>
				<div class="text-container" class:scrolling={artistOverflows}>
					<span>{track.artist}</span>
				</div>
			</a>
			{#if track.album}
				<span class="metadata-separator">•</span>
				<a
					href="/u/{track.artist_handle}/album/{track.album.slug}"
					class="metadata-link"
					bind:this={albumEl}
				>
					<svg class="metadata-icon album-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
						<rect x="2" y="2" width="12" height="12" stroke="currentColor" stroke-width="1.5" fill="none" />
						<circle cx="8" cy="8" r="2.5" fill="currentColor" />
					</svg>
					<div class="text-container" class:scrolling={albumOverflows}>
						<span>{track.album.title}</span>
					</div>
				</a>
			{/if}
		</div>
	</div>
</div>

<style>
	.player-track {
		display: flex;
		align-items: center;
		gap: 1rem;
		min-width: 0;
	}

	.player-artwork {
		flex-shrink: 0;
		width: 56px;
		height: 56px;
		border-radius: 4px;
		overflow: hidden;
		background: #1a1a1a;
		border: 1px solid #333;
		display: block;
		text-decoration: none;
		transition: transform 0.2s, border-color 0.2s;
	}

	.player-artwork:hover {
		transform: scale(1.05);
		border-color: var(--accent);
	}

	.player-artwork img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.player-artwork-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #666;
	}

	.player-info {
		min-width: 200px;
		max-width: 320px;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		line-height: 1.2;
	}

	.player-title,
	.player-title-link {
		font-size: 1rem;
		font-weight: 600;
		color: #f5f5f5;
		text-transform: lowercase;
		margin-bottom: 0.15rem;
		position: relative;
	}

	.player-title-link {
		text-decoration: none;
	}

	.player-title-link:hover {
		color: var(--accent);
	}

	.player-title.scrolling span,
	.player-title-link.scrolling span,
	.text-container.scrolling span {
		animation: scrollText 12s linear infinite;
		padding-right: 2rem;
		display: inline-block;
	}

	.player-title.scrolling,
	.player-title-link.scrolling,
	.text-container.scrolling {
		mask-image: linear-gradient(to right, black 0%, black calc(100% - 15px), transparent 100%);
		-webkit-mask-image: linear-gradient(to right, black 0%, black calc(100% - 15px), transparent 100%);
	}

	.player-metadata {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: #a0a0a0;
		min-width: 0;
	}

	.metadata-link {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		color: inherit;
		text-decoration: none;
		min-width: 0;
	}

	.metadata-link:hover {
		color: var(--accent);
	}

	.metadata-icon {
		width: 16px;
		height: 16px;
	}

	.text-container {
		overflow: hidden;
		max-width: 180px;
	}

	.metadata-separator {
		color: #555;
	}

	@keyframes scrollText {
		0% {
			transform: translateX(0);
		}
		100% {
			transform: translateX(-50%);
		}
	}

	@media (max-width: 768px) {
		.player-track {
			width: 100%;
		}

		.player-artwork {
			width: 48px;
			height: 48px;
		}

		.player-info {
			min-width: 0;
			max-width: none;
		}

		.player-title,
		.player-title-link {
			font-size: 0.9rem;
		}

		.player-metadata {
			font-size: 0.8rem;
			flex-wrap: wrap;
		}

		.metadata-link {
			max-width: 100%;
		}

		.text-container {
			max-width: 140px;
		}
	}
</style>
