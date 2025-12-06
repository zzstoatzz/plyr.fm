<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import SensitiveImage from '$lib/components/SensitiveImage.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let track = $derived(data.track);

	let audio: HTMLAudioElement;
	let paused = $state(true);
	let currentTime = $state(0);
	let duration = $state(0);

	function togglePlay() {
		if (audio.paused) {
			audio.play();
		} else {
			audio.pause();
		}
	}

	function formatTime(seconds: number) {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function handleSeek(e: MouseEvent) {
		const bar = e.currentTarget as HTMLElement;
		const rect = bar.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const pct = x / rect.width;
		audio.currentTime = pct * duration;
	}

	onMount(() => {
		const autoplay = $page.url.searchParams.get('autoplay') === '1';
		if (autoplay) {
			audio.play().catch(() => {
				// Autoplay policy might block this
				paused = true;
			});
		}
	});
</script>

<div class="embed-container">
	<!-- background image for mobile layout -->
	{#if track.image_url}
		<SensitiveImage src={track.image_url}>
			<div class="bg-image" style="background-image: url({track.image_url})"></div>
		</SensitiveImage>
	{/if}
	<div class="bg-overlay"></div>

	<!-- desktop: side art -->
	<div class="art-container">
		{#if track.image_url}
			<SensitiveImage src={track.image_url}>
				<img src={track.image_url} alt={track.title} class="art" />
			</SensitiveImage>
		{:else}
			<div class="art-placeholder">♪</div>
		{/if}
	</div>

	<div class="content">
		<div class="header">
			<button class="play-btn" onclick={togglePlay} aria-label={paused ? 'Play' : 'Pause'}>
				{#if paused}
					<svg viewBox="0 0 24 24" fill="currentColor" class="icon">
						<path d="M8 5v14l11-7z" />
					</svg>
				{:else}
					<svg viewBox="0 0 24 24" fill="currentColor" class="icon">
						<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
					</svg>
				{/if}
			</button>

			<div class="meta">
				<a href="https://plyr.fm/track/{track.id}" target="_blank" rel="noopener noreferrer" class="title">
					{track.title}
				</a>
				<a href="https://plyr.fm/u/{track.artist_handle}" target="_blank" rel="noopener noreferrer" class="artist">{track.artist}</a>
			</div>

			<a href="https://plyr.fm" target="_blank" rel="noopener noreferrer" class="logo">
				plyr.fm
			</a>
		</div>

		<div class="player-controls">
			<div class="time">{formatTime(currentTime)}</div>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="progress-bar" onclick={handleSeek}>
				<div class="progress-bg"></div>
				<div class="progress-fill" style="width: {(currentTime / (duration || 1)) * 100}%"></div>
			</div>
			<div class="time">{formatTime(duration)}</div>
		</div>
	</div>

	<audio
		bind:this={audio}
		src={track.r2_url}
		bind:paused
		bind:currentTime
		bind:duration
		onended={() => (paused = true)}
	></audio>
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
		font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Consolas', monospace;
		background: var(--bg-primary);
		color: var(--text-primary);
	}

	.embed-container {
		display: flex;
		height: 165px;
		background: var(--bg-tertiary);
		overflow: hidden;
		position: relative;
	}

	/* background image - hidden on desktop */
	.bg-image {
		display: none;
	}

	.bg-overlay {
		display: none;
	}

	.art-container {
		width: 165px;
		height: 165px;
		flex-shrink: 0;
		position: relative;
	}

	.art {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.art-placeholder {
		width: 100%;
		height: 100%;
		background: var(--border-default);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 48px;
		color: var(--text-muted);
	}

	.content {
		flex: 1;
		padding: 16px;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		position: relative;
		min-width: 0;
		z-index: 1;
	}

	.header {
		display: flex;
		align-items: flex-start;
		gap: 16px;
	}

	.play-btn {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: #fff;
		color: #000;
		border: none;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		flex-shrink: 0;
		transition: transform 0.1s;
	}

	.play-btn:active {
		transform: scale(0.95);
	}

	.icon {
		width: 24px;
		height: 24px;
	}

	.meta {
		flex: 1;
		min-width: 0;
		padding-top: 4px;
		padding-right: 60px; /* leave room for logo */
	}

	.title {
		display: block;
		font-size: 18px;
		font-weight: 700;
		margin: 0 0 4px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-decoration: none;
		color: var(--text-primary);
	}

	.title:hover {
		text-decoration: underline;
	}

	.artist {
		display: block;
		font-size: 14px;
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-decoration: none;
	}

	.artist:hover {
		text-decoration: underline;
	}

	.logo {
		position: absolute;
		top: 16px;
		right: 16px;
		font-size: 12px;
		font-weight: 700;
		color: var(--border-emphasis);
		text-decoration: none;
		text-transform: uppercase;
		letter-spacing: 1px;
	}

	.logo:hover {
		color: var(--text-muted);
	}

	.player-controls {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 4px;
	}

	.time {
		font-size: 12px;
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
		width: 35px;
		text-align: center;
	}

	.progress-bar {
		flex: 1;
		height: 24px; /* larger hit area */
		display: flex;
		align-items: center;
		cursor: pointer;
		position: relative;
	}

	.progress-bg {
		width: 100%;
		height: 4px;
		background: var(--border-default);
		border-radius: 2px;
	}

	.progress-fill {
		position: absolute;
		left: 0;
		top: 10px; /* (24 - 4) / 2 */
		height: 4px;
		background: var(--text-primary);
		border-radius: 2px;
		pointer-events: none;
	}

	.progress-bar:hover .progress-fill {
		background: var(--accent);
	}

	/* mobile: background image layout */
	@media (max-width: 400px) {
		.embed-container {
			height: 165px; /* match bluesky iframe height */
			flex-direction: column;
		}

		/* show blurred background */
		.bg-image {
			display: block;
			position: absolute;
			inset: 0;
			background-size: cover;
			background-position: center;
			filter: blur(20px);
			transform: scale(1.2); /* prevent blur edges */
			z-index: 0;
			pointer-events: none;
		}

		.bg-overlay {
			display: block;
			position: absolute;
			inset: 0;
			background: rgba(0, 0, 0, 0.2);
			z-index: 0;
			pointer-events: none;
		}

		/* hide side art */
		.art-container {
			display: none;
		}

		.content {
			flex: 1;
			padding: 16px;
			justify-content: space-between;
		}

		.header {
			gap: 12px;
		}

		.play-btn {
			width: 44px;
			height: 44px;
		}

		.icon {
			width: 22px;
			height: 22px;
		}

		.meta {
			padding-right: 55px;
		}

		.title {
			font-size: 16px;
			color: #fff;
			text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
		}

		.artist {
			font-size: 13px;
			color: rgba(255, 255, 255, 0.8);
			text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
		}

		.logo {
			top: 16px;
			right: 16px;
			font-size: 10px;
			color: rgba(255, 255, 255, 0.5);
			z-index: 2;
		}

		.logo:hover {
			color: rgba(255, 255, 255, 0.7);
		}

		.player-controls {
			gap: 10px;
		}

		.time {
			font-size: 11px;
			color: rgba(255, 255, 255, 0.6);
			width: 32px;
		}

		.progress-bg {
			background: rgba(255, 255, 255, 0.2);
		}

		.progress-fill {
			background: #fff;
		}
	}
</style>
