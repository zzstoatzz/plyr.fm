<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import SensitiveImage from '$lib/components/SensitiveImage.svelte';
	import {
		clearMediaSessionMetadata,
		setMediaSessionActionHandlers,
		setMediaSessionMetadata,
		setMediaSessionPlaybackState,
		setMediaSessionPositionState
	} from '$lib/media-session';
	import { trackCoverUrl } from '$lib/track-cover';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let track = $derived(data.track);
	let coverUrl = $derived(trackCoverUrl(track));

	let audio: HTMLAudioElement;
	let paused = $state(true);
	let currentTime = $state(0);
	let duration = $state(0);
	let showCopied = $state(false);

	async function copyShareLink() {
		const url = `https://plyr.fm/track/${track.id}`;
		try { await navigator.clipboard.writeText(url); }
		catch { if (navigator.share) { try { await navigator.share({ url }); } catch { /* dismissed */ } } return; }
		showCopied = true;
		setTimeout(() => { showCopied = false; }, 2000);
	}

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

		// route OS-level lock-screen / system-media controls. single-track
		// embed has no next/previous, so we explicitly null those handlers
		// — that tells the OS to grey them out instead of inheriting a
		// stale handler from a prior page.
		setMediaSessionActionHandlers({
			play: () => { audio?.play().catch(() => {}); },
			pause: () => { audio?.pause(); },
			previoustrack: null,
			nexttrack: null,
			seekto: (details) => {
				if (audio && details.seekTime !== undefined) {
					audio.currentTime = details.seekTime;
				}
			},
			seekbackward: (details) => {
				if (!audio) return;
				audio.currentTime = Math.max(
					0,
					audio.currentTime - (details.seekOffset ?? 10)
				);
			},
			seekforward: (details) => {
				if (!audio) return;
				audio.currentTime = Math.min(
					duration,
					audio.currentTime + (details.seekOffset ?? 10)
				);
			}
		});

		return () => {
			clearMediaSessionMetadata();
			setMediaSessionPlaybackState('none');
			setMediaSessionActionHandlers({
				play: null,
				pause: null,
				seekto: null,
				seekbackward: null,
				seekforward: null
			});
		};
	});

	$effect(() => {
		if (!track) return;
		setMediaSessionMetadata({
			title: track.title,
			artist: track.artist,
			album: track.album?.title,
			artworkUrl: coverUrl
		});
	});

	$effect(() => {
		setMediaSessionPlaybackState(paused ? 'paused' : 'playing');
	});

	$effect(() => {
		setMediaSessionPositionState({ duration, position: currentTime });
	});
</script>

<div class="embed-container" class:is-playing={!paused}>
	<!-- background image for mobile layout -->
	{#if coverUrl}
		<SensitiveImage src={coverUrl}>
			<div class="bg-image" style="background-image: url({coverUrl})"></div>
		</SensitiveImage>
	{/if}
	<div class="bg-overlay"></div>

	<!-- desktop: side art -->
	<div class="art-container">
		{#if coverUrl}
			<SensitiveImage src={coverUrl}>
				<img src={coverUrl} alt={track.title} class="art" />
			</SensitiveImage>
		{:else}
			<div class="art-placeholder">♪</div>
		{/if}
	</div>

	<div class="content">
		<div class="art-card">
			{#if coverUrl}
				<SensitiveImage src={coverUrl}>
					<img src={coverUrl} alt={track.title} class="art-card-img" />
				</SensitiveImage>
			{:else}
				<div class="art-card-placeholder">♪</div>
			{/if}
		</div>
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

			<div class="actions">
				<button class="share-btn" onclick={copyShareLink} title="copy link">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="share-icon">
						<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
						<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
					</svg>
					{#if showCopied}<span class="copied">copied!</span>{/if}
				</button>
				<a href="https://plyr.fm" target="_blank" rel="noopener noreferrer" class="logo">plyr.fm</a>
			</div>
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

	/* --- BASE STYLES: wide rail (art left, content right) --- */
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

	.embed-container::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: #6a9fff; opacity: 0.32; filter: saturate(0.9) brightness(0.75); box-shadow: 0 0 0 transparent; transition: opacity 0.15s ease-out, filter 0.15s ease-out, box-shadow 0.2s ease-out; pointer-events: none; z-index: 2; }
	.embed-container.is-playing::before { opacity: 0.95; filter: saturate(1.25) brightness(1.28); box-shadow: 0 0 6px color-mix(in srgb, #6a9fff 65%, transparent), 0 0 14px color-mix(in srgb, #6a9fff 45%, transparent); }

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

	.actions { display: flex; align-items: center; gap: clamp(4px, 1.5cqi, 8px); flex-shrink: 0; }
	.share-btn { background: none; border: none; color: var(--text-tertiary); cursor: pointer; padding: 2px; display: flex; align-items: center; position: relative; }
	.share-btn:hover { color: var(--text-primary); }
	.share-icon { width: var(--logo-size); height: var(--logo-size); }
	.copied { position: absolute; top: -1.5rem; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.8); color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 10px; white-space: nowrap; pointer-events: none; animation: fadeIn 0.15s ease-in; }
	@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

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

	.art-card {
		display: none;
	}

	.art-card-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: var(--radius-lg, 12px);
	}

	.art-card-placeholder {
		width: 100%;
		height: 100%;
		background: rgba(255, 255, 255, 0.1);
		border-radius: var(--radius-lg, 12px);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: clamp(24px, 10cqi, 48px);
		color: rgba(255, 255, 255, 0.5);
	}

	/* --- SHORT (height < 100px): hide progress bar --- */
	@container (max-height: 99px) {
		.player-controls { display: none; }
		.content { justify-content: center; }
	}

	/* --- NARROW (width < 280px): blurred bg, compact controls --- */
	@container (max-width: 279px) {
		.bg-image,
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

		.share-btn { color: rgba(255, 255, 255, 0.5); }
		.share-btn:hover { color: rgba(255, 255, 255, 0.75); }

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

	/* --- MICRO (width < 200px): hide time labels, minimal UI --- */
	@container (max-width: 199px) {
		.time, .share-btn {
			display: none;
		}

		.header {
			grid-template-columns: auto 1fr;
		}

		.logo {
			display: none;
		}
	}

	/* --- SQUARE/TALL (aspect-ratio <= 1.2): blurred bg, centered art card --- */
	@container (aspect-ratio <= 1.2) and (min-width: 200px) and (min-height: 200px) {
		.bg-image,
		.bg-overlay {
			display: block;
		}

		.art-container {
			display: none;
		}

		.art-card {
			display: block;
			width: clamp(80px, 45cqi, 220px);
			aspect-ratio: 1;
			margin: 0 auto;
			flex-shrink: 0;
		}

		.content {
			justify-content: center;
			align-items: center;
			gap: clamp(8px, 3cqi, 16px);
		}

		.header {
			width: 100%;
		}

		.title,
		.artist {
			color: #fff;
			text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
		}

		.title {
			white-space: normal;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			line-clamp: 2;
			-webkit-box-orient: vertical;
			overflow: hidden;
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

		.share-btn { color: rgba(255, 255, 255, 0.5); }
		.share-btn:hover { color: rgba(255, 255, 255, 0.75); }

		.time {
			color: rgba(255, 255, 255, 0.6);
		}

		.progress-bg {
			background: rgba(255, 255, 255, 0.25);
		}

		.progress-fill {
			background: #fff;
		}

		.player-controls {
			width: 100%;
		}
	}

	/* --- WIDE (width >= 400px, landscape only) --- */
	@container (min-width: 400px) and (aspect-ratio > 1.2) {
		.art-container {
			flex: 0 0 clamp(140px, 30cqi, 280px);
		}
	}

	/* --- VERY WIDE (width >= 600px, landscape only) --- */
	@container (min-width: 600px) and (aspect-ratio > 1.2) {
		.art-container {
			flex: 0 0 clamp(180px, 28cqi, 320px);
		}

		.content {
			padding: clamp(16px, 4cqi, 24px);
		}
	}
</style>
