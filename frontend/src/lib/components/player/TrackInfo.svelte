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
				const container = artistEl.querySelector('.text-container');
				const span = container?.querySelector('span');
				artistOverflows = span && container ? span.scrollWidth > container.clientWidth : false;
			}
			if (albumEl) {
				const container = albumEl.querySelector('.text-container');
				const span = container?.querySelector('span');
				albumOverflows = span && container ? span.scrollWidth > container.clientWidth : false;
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
		max-width: 300px;
		overflow: hidden;
		min-width: 0;
	}

	.player-title,
	.player-title-link {
		font-size: 0.95rem;
		font-weight: 600;
		color: #e8e8e8;
		margin-bottom: 0.15rem;
		position: relative;
		overflow: hidden;
	}

	.player-title-link {
		text-decoration: none;
	}

	.player-title-link:hover {
		color: var(--accent);
	}

	.player-title.scrolling,
	.player-title-link.scrolling {
		overflow: hidden;
		mask-image: linear-gradient(to right, black 0%, black calc(100% - 20px), transparent 100%);
		-webkit-mask-image: linear-gradient(to right, black 0%, black calc(100% - 20px), transparent 100%);
	}

	.player-title span,
	.player-title-link span {
		display: inline-block;
		white-space: nowrap;
	}

	.player-title.scrolling span,
	.player-title-link.scrolling span {
		padding-right: 2rem;
		animation: scroll-text 10s linear infinite;
	}

	.text-container.scrolling {
		mask-image: linear-gradient(to right, black 0%, black calc(100% - 15px), transparent 100%);
		-webkit-mask-image: linear-gradient(to right, black 0%, black calc(100% - 15px), transparent 100%);
	}

	.text-container span {
		display: inline-block;
		white-space: nowrap;
	}

	.text-container.scrolling span {
		padding-right: 3rem;
		animation: scroll-text 15s linear infinite;
	}

	.player-metadata {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		color: #909090;
		font-size: 0.85rem;
		overflow: hidden;
		min-width: 0;
	}

	.metadata-link {
		display: flex;
		align-items: center;
		color: inherit;
		text-decoration: none;
		transition: color 0.2s;
		width: 100%;
	}

	.metadata-link:hover {
		color: var(--accent);
	}

	.metadata-icon {
		width: 12px;
		height: 12px;
		opacity: 0.7;
		flex-shrink: 0;
		margin-right: 0.35rem;
	}

	.text-container {
		overflow: hidden;
		position: relative;
		min-width: 0;
		flex: 1;
	}

	.metadata-separator {
		display: none;
	}

	@keyframes scroll-text {
		0%, 15% {
			transform: translateX(0);
		}
		85%, 100% {
			transform: translateX(-100%);
		}
	}

	@media (max-width: 768px) {
		.player-track {
			display: contents;
		}

		.player-artwork {
			width: 48px;
			height: 48px;
			grid-row: 1;
			grid-column: 1;
		}

		.player-info {
			grid-row: 1;
			grid-column: 2 / 4;
			min-width: 0;
			overflow: hidden;
			display: flex;
			flex-direction: column;
			gap: 0.25rem;
		}

		.player-title,
		.player-title-link {
			font-size: 0.9rem;
			margin-bottom: 0;
		}

		.player-metadata {
			font-size: 0.8rem;
		}

		.player-title.scrolling,
		.player-title-link.scrolling,
		.metadata-link.scrolling {
			mask-image: linear-gradient(to right, black 0%, black calc(100% - 15px), transparent 100%);
			-webkit-mask-image: linear-gradient(to right, black 0%, black calc(100% - 15px), transparent 100%);
		}
	}
</style>
