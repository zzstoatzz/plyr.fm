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
	let isAdultLabeled = $derived(
		track.labels?.some((label) => label === 'sexual' || label === 'porn') ?? false
	);

	let audio = $state<HTMLAudioElement>();
	let paused = $state(true);
	let currentTime = $state(0);
	let duration = $state(0);
	let showCopied = $state(false);

	async function copyShareLink() {
		const url = `https://plyr.fm/track/${track.id}`;
		try {
			await navigator.clipboard.writeText(url);
		} catch {
			if (navigator.share) {
				try {
					await navigator.share({ url });
				} catch {
					/* dismissed */
				}
			}
			return;
		}
		showCopied = true;
		setTimeout(() => {
			showCopied = false;
		}, 2000);
	}

	function togglePlay() {
		if (isAdultLabeled || !audio) return;
		if (audio.paused) {
			audio.play().catch(() => {
				paused = true;
			});
		} else {
			audio.pause();
		}
	}

	function formatTime(seconds: number) {
		if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function handleSeek(event: Event & { currentTarget: HTMLInputElement }): void {
		if (audio && Number.isFinite(duration) && duration > 0) {
			audio.currentTime = event.currentTarget.valueAsNumber;
		}
	}

	onMount(() => {
		const autoplay = $page.url.searchParams.get('autoplay') === '1';
		if (autoplay && !isAdultLabeled) {
			audio?.play().catch(() => {
				// Autoplay policy might block this
				paused = true;
			});
		}

		// route OS-level lock-screen / system-media controls. single-track
		// embed has no next/previous, so we explicitly null those handlers
		// — that tells the OS to grey them out instead of inheriting a
		// stale handler from a prior page.
		setMediaSessionActionHandlers({
			play: () => {
				audio?.play().catch(() => {});
			},
			pause: () => {
				audio?.pause();
			},
			previoustrack: null,
			nexttrack: null,
			seekto: (details) => {
				if (audio && details.seekTime !== undefined) {
					audio.currentTime = details.seekTime;
				}
			},
			seekbackward: (details) => {
				if (!audio) return;
				audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset ?? 10));
			},
			seekforward: (details) => {
				if (!audio) return;
				audio.currentTime = Math.min(duration, audio.currentTime + (details.seekOffset ?? 10));
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
	<div class="art-container">
		{#if coverUrl}
			<SensitiveImage src={coverUrl} respectPreference={false}>
				<img src={coverUrl} alt={track.title} class="art" />
			</SensitiveImage>
		{:else}
			<div class="art-placeholder">♪</div>
		{/if}
	</div>

	<div class="content">
		<div class="header">
			<button
				class="play-btn"
				onclick={togglePlay}
				disabled={isAdultLabeled}
				aria-label={isAdultLabeled ? 'Adult content hidden' : paused ? 'Play' : 'Pause'}
			>
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
				<a
					href="https://plyr.fm/track/{track.id}"
					target="_blank"
					rel="noopener noreferrer"
					class="title"
				>
					{track.title}
				</a>
				<a
					href="https://plyr.fm/u/{track.artist_handle}"
					target="_blank"
					rel="noopener noreferrer"
					class="artist">{track.artist}</a
				>
			</div>

			<div class="actions">
				<button class="share-btn" onclick={copyShareLink} title="copy link">
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						class="share-icon"
					>
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
			<input
				class="seek-bar"
				type="range"
				aria-label="Seek"
				min="0"
				max={Number.isFinite(duration) && duration > 0 ? duration : 1}
				step="0.1"
				value={Number.isFinite(currentTime) ? currentTime : 0}
				disabled={!Number.isFinite(duration) || duration <= 0}
				style={`--progress: ${duration > 0 ? (currentTime / duration) * 100 : 0}%`}
				oninput={handleSeek}
			/>
			<div class="time">{formatTime(duration)}</div>
		</div>
	</div>

	{#if !isAdultLabeled}
		<audio
			bind:this={audio}
			src={track.r2_url}
			bind:paused
			bind:currentTime
			bind:duration
			onended={() => (paused = true)}
		></audio>
	{/if}
</div>

<style>
	.embed-container {
		display: flex;
		height: 100%;
		padding: var(--embed-space);
		gap: var(--embed-space);
		background: var(--bg-secondary);
		color: var(--text-primary);
		overflow: hidden;
	}
	.art-container {
		flex: 0 0 auto;
		width: min(28vw, 200px, calc(100vh - 2 * var(--embed-space)));
		aspect-ratio: 1;
		align-self: center;
		position: relative;
	}
	.art {
		width: 100%;
		height: 100%;
		object-fit: contain;
		border-radius: var(--radius-md);
	}
	.art-placeholder {
		width: 100%;
		height: 100%;
		background: var(--bg-tertiary);
		display: grid;
		place-items: center;
		border-radius: var(--radius-md);
		font-size: var(--text-3xl);
		color: var(--text-tertiary);
	}
	.content {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: var(--embed-gap);
	}
	.meta {
		min-width: 0;
	}
	.title {
		display: block;
		font-size: var(--text-lg);
		font-weight: 650;
		line-height: 1.4;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-decoration: none;
	}
	.artist {
		display: block;
		font-size: var(--text-sm);
		line-height: 1.4;
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-decoration: none;
	}
	.title:hover,
	.artist:hover {
		text-decoration: underline;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}
	.logo {
		color: var(--text-secondary);
		font-size: var(--text-xs);
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
	}
	.logo:hover {
		color: var(--text-primary);
	}
	.share-btn {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border: 0;
		background: none;
		color: var(--text-secondary);
		cursor: pointer;
		position: relative;
	}
	.share-icon {
		width: 16px;
		height: 16px;
	}
	.copied {
		position: absolute;
		right: 0;
		top: 100%;
		padding: 4px 8px;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: var(--text-xs);
		z-index: 2;
	}
	.play-btn {
		display: grid;
		place-items: center;
		width: var(--embed-play);
		height: var(--embed-play);
		flex-shrink: 0;
		border: none;
		border-radius: var(--radius-full);
		background: var(--text-primary);
		color: var(--bg-primary);
		cursor: pointer;
	}
	.play-btn:hover:not(:disabled) {
		background: var(--accent);
	}
	.play-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.icon {
		width: 24px;
		height: 24px;
	}
	.time {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
		min-width: 2.5em;
		text-align: center;
	}
	@media (max-width: 279px) {
		.art-container {
			display: none;
		}
		.logo {
			display: none;
		}
	}
	@media (max-width: 199px) {
		.time,
		.share-btn {
			display: none;
		}
	}

	.content {
		justify-content: center;
	}
	.header {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--embed-gap);
	}
	.header .meta {
		grid-column: 1;
		grid-row: 1;
	}
	.header .play-btn {
		grid-column: 2;
		grid-row: 1 / 3;
	}
	.actions {
		grid-column: 1;
		grid-row: 2;
	}
	.player-controls {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	@media (max-height: 99px) {
		.player-controls,
		.actions {
			display: none;
		}
	}
	@media (min-height: 300px) and (max-aspect-ratio: 1/1) {
		.embed-container {
			flex-direction: column;
		}
		.art-container {
			width: min(100%, calc(100vh - 180px));
			min-height: 0;
		}
		.content {
			flex: 1;
			width: 100%;
		}
	}
</style>
