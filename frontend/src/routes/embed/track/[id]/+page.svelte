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
		font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Consolas', monospace;
		background: var(--bg-primary);
		color: var(--text-primary);
	}

	/* ===========================================
	   BASE STYLES - Default "wide rail" layout
	   Art on left, content on right
	   =========================================== */
	.embed-container {
		display: flex;
		height: 100%;
		background: var(--bg-tertiary);
		overflow: hidden;
		position: relative;
		container-type: size;

		/* Scale tokens using container query units */
		--pad: clamp(8px, 4cqi, 16px);
		--gap: clamp(8px, 3cqi, 16px);
		--play-size: clamp(32px, 12cqi, 52px);
		--icon-size: clamp(16px, 6cqi, 26px);
		--title-size: clamp(13px, 4.5cqi, 18px);
		--artist-size: clamp(11px, 3.5cqi, 14px);
		--time-size: clamp(10px, 3cqi, 12px);
		--logo-size: clamp(8px, 2.5cqi, 12px);
	}

	/* Background image - hidden by default */
	.bg-image {
		display: none;
		position: absolute;
		inset: 0;
		background-size: cover;
		background-position: center;
		filter: blur(24px);
		transform: scale(1.3);
		z-index: 0;
		pointer-events: none;
	}

	/* Gradient overlay instead of flat color */
	.bg-overlay {
		display: none;
		position: absolute;
		inset: 0;
		background: linear-gradient(
			to bottom,
			rgba(0, 0, 0, 0.4) 0%,
			rgba(0, 0, 0, 0.2) 40%,
			rgba(0, 0, 0, 0.5) 100%
		);
		z-index: 0;
		pointer-events: none;
	}

	/* Art container - percentage based sizing */
	.art-container {
		flex: 0 0 clamp(100px, 35cqi, 320px);
		height: 100%;
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
		font-size: clamp(24px, 10cqi, 48px);
		color: var(--text-muted);
	}

	/* Content area */
	.content {
		flex: 1;
		padding: var(--pad);
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		position: relative;
		min-width: 0;
		z-index: 1;
	}

	/* Header uses CSS grid for proper spacing */
	.header {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: var(--gap);
		align-items: start;
	}

	.play-btn {
		width: var(--play-size);
		height: var(--play-size);
		border-radius: var(--radius-full);
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
		width: var(--icon-size);
		height: var(--icon-size);
	}

	/* Meta fills middle column */
	.meta {
		min-width: 0;
		padding-top: 2px;
	}

	.title {
		display: block;
		font-size: var(--title-size);
		font-weight: 700;
		margin: 0 0 2px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-decoration: none;
		color: var(--text-primary);
		line-height: 1.3;
	}

	.title:hover {
		text-decoration: underline;
	}

	.artist {
		display: block;
		font-size: var(--artist-size);
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-decoration: none;
		line-height: 1.3;
	}

	.artist:hover {
		text-decoration: underline;
	}

	/* Logo in grid column 3 */
	.logo {
		font-size: var(--logo-size);
		font-weight: 700;
		color: var(--border-emphasis);
		text-decoration: none;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		white-space: nowrap;
		padding-top: 4px;
	}

	.logo:hover {
		color: var(--text-muted);
	}

	/* Player controls with flexible gaps */
	.player-controls {
		display: flex;
		align-items: center;
		gap: var(--gap);
	}

	.time {
		font-size: var(--time-size);
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
		min-width: 2.5em;
		text-align: center;
	}

	.progress-bar {
		flex: 1;
		height: clamp(20px, 6cqi, 28px);
		display: flex;
		align-items: center;
		cursor: pointer;
		position: relative;
		min-width: 40px;
	}

	.progress-bg {
		width: 100%;
		height: clamp(3px, 1cqi, 5px);
		background: var(--border-default);
		border-radius: 2px;
	}

	.progress-fill {
		position: absolute;
		left: 0;
		top: 50%;
		transform: translateY(-50%);
		height: clamp(3px, 1cqi, 5px);
		background: var(--text-primary);
		border-radius: 2px;
		pointer-events: none;
	}

	.progress-bar:hover .progress-fill {
		background: var(--accent);
	}

	/* ===========================================
	   MODE: NARROW (width < 280px)
	   Blurred background, compact controls
	   =========================================== */
	@container (max-width: 279px) {
		.bg-image {
			display: block;
		}

		.bg-overlay {
			display: block;
		}

		.art-container {
			display: none;
		}

		.content {
			justify-content: center;
			gap: var(--gap);
		}

		.title,
		.artist {
			color: #fff;
			text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
		}

		.artist {
			color: rgba(255, 255, 255, 0.85);
		}

		.logo {
			color: rgba(255, 255, 255, 0.5);
		}

		.logo:hover {
			color: rgba(255, 255, 255, 0.75);
		}

		.time {
			color: rgba(255, 255, 255, 0.6);
		}

		.progress-bg {
			background: rgba(255, 255, 255, 0.25);
		}

		.progress-fill {
			background: #fff;
		}
	}

	/* ===========================================
	   MODE: MICRO (width < 200px)
	   Hide time labels, minimal UI
	   =========================================== */
	@container (max-width: 199px) {
		.time {
			display: none;
		}

		.header {
			grid-template-columns: auto 1fr;
		}

		.logo {
			display: none;
		}
	}

	/* ===========================================
	   MODE: SQUARE/TALL (aspect-ratio <= 1.2, width >= 200px)
	   Art on top, content below, 2-line title
	   =========================================== */
	@container (aspect-ratio <= 1.2) and (min-width: 200px) and (min-height: 200px) {
		.embed-container {
			flex-direction: column;
		}

		.art-container {
			flex: 1 1 auto;
			width: 100%;
			height: auto;
			min-height: 0;
		}

		.content {
			flex: 0 0 auto;
			justify-content: flex-start;
			gap: clamp(6px, 2cqi, 12px);
		}

		/* Allow 2-line title in tall layouts */
		.title {
			white-space: normal;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			line-clamp: 2;
			-webkit-box-orient: vertical;
			overflow: hidden;
		}
	}

	/* ===========================================
	   MODE: VERY TALL (aspect-ratio <= 0.7)
	   Blurred background, larger art influence
	   =========================================== */
	@container (aspect-ratio <= 0.7) and (min-width: 200px) {
		.bg-image {
			display: block;
		}

		.bg-overlay {
			display: block;
		}

		.art-container {
			display: none;
		}

		.content {
			justify-content: center;
		}

		.title,
		.artist {
			color: #fff;
			text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
		}

		.artist {
			color: rgba(255, 255, 255, 0.85);
		}

		.logo {
			color: rgba(255, 255, 255, 0.5);
		}

		.logo:hover {
			color: rgba(255, 255, 255, 0.75);
		}

		.time {
			color: rgba(255, 255, 255, 0.6);
		}

		.progress-bg {
			background: rgba(255, 255, 255, 0.25);
		}

		.progress-fill {
			background: #fff;
		}
	}

	/* ===========================================
	   MODE: WIDE (width >= 400px)
	   Ensure art doesn't get too small
	   =========================================== */
	@container (min-width: 400px) {
		.art-container {
			flex: 0 0 clamp(140px, 30cqi, 280px);
		}
	}

	/* ===========================================
	   MODE: VERY WIDE (width >= 600px)
	   Larger art, more breathing room
	   =========================================== */
	@container (min-width: 600px) {
		.art-container {
			flex: 0 0 clamp(180px, 28cqi, 320px);
		}

		.content {
			padding: clamp(16px, 4cqi, 24px);
		}
	}
</style>
