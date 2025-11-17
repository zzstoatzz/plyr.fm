<script lang="ts">
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { API_URL } from '$lib/config';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	let formattedCurrentTime = $derived(formatTime(player.currentTime));
	let formattedDuration = $derived(formatTime(player.duration));

	// check if we're on the current track's detail page
	let isOnTrackDetailPage = $derived(
		player.currentTrack && $page.url.pathname === `/track/${player.currentTrack.id}`
	);

	// compute progress percentage for seek bar styling
	let progressPercent = $derived.by(() => {
		if (!player.duration || player.duration === 0) return 0;
		return (player.currentTime / player.duration) * 100;
	});

	// volume state indicators
	let volumeState = $derived.by(() => {
		if (player.volume === 0) return 'muted';
		if (player.volume >= 0.99) return 'max';
		return 'normal';
	});

	// overflow detection for text scrolling
	let titleEl = $state<HTMLElement | null>(null);
	let artistEl = $state<HTMLElement | null>(null);
	let albumEl = $state<HTMLElement | null>(null);
	let titleOverflows = $state(false);
	let artistOverflows = $state(false);
	let albumOverflows = $state(false);

	function checkOverflows() {
		// SSR safety: skip if running on server
		if (typeof window === 'undefined') return;

		// check if text overflows container (with small delay to ensure layout is complete)
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

	$effect(() => {
		// re-check on track change
		if (player.currentTrack) {
			checkOverflows();
		}
	});


	function formatTime(seconds: number): string {
		if (!isFinite(seconds)) return '0:00';
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	// track play count when threshold is reached
	$effect(() => {
		player.incrementPlayCount();
	});

	onMount(() => {
		// restore volume from localStorage if available
		const savedVolume = localStorage.getItem('player_volume');
		if (savedVolume) {
			player.volume = parseFloat(savedVolume);
		}

		// update player height css variable for dynamic positioning
		function updatePlayerHeight() {
			const playerEl = document.querySelector('.player') as HTMLElement | null;
			if (playerEl) {
				const height = playerEl.offsetHeight;
				document.documentElement.style.setProperty('--player-height', `${height}px`);
			} else {
				document.documentElement.style.setProperty('--player-height', '0px');
			}
		}

		function updateViewportOffset() {
			const viewport = window.visualViewport;

			if (viewport) {
				// use visual viewport API when available (Safari, modern Chrome)
				const visualBottom = viewport.height + viewport.offsetTop;
				const layoutHeight = window.innerHeight;
				const offset = Math.max(0, visualBottom - layoutHeight);
				document.documentElement.style.setProperty('--visual-viewport-offset', `${offset}px`);
			} else {
				// fallback for Chrome PWA or browsers without visual viewport API
				// use scrollHeight to detect keyboard presence (scrollHeight > innerHeight when keyboard is visible)
				const layoutHeight = window.innerHeight;
				const documentHeight = document.documentElement.scrollHeight;
				const offset = Math.max(0, layoutHeight - documentHeight);
				document.documentElement.style.setProperty('--visual-viewport-offset', `${offset}px`);
			}
		}

		function handleVisibilityChange() {
			// recalculate when app resumes from background (fixes stale measurements)
			if (document.visibilityState === 'visible') {
				updatePlayerHeight();
				updateViewportOffset();
				checkOverflows();
			}
		}

		function handleResize() {
			updatePlayerHeight();
			updateViewportOffset();
			checkOverflows();
		}

		// update on mount and resize
		updatePlayerHeight();
		updateViewportOffset();
		checkOverflows();
		window.addEventListener('resize', handleResize);

		// listen to geometrychange for visual viewport (Safari + Chrome)
		window.visualViewport?.addEventListener('resize', updateViewportOffset);
		window.visualViewport?.addEventListener('scroll', updateViewportOffset);
		// geometrychange fires when viewport geometry changes (e.g., mobile keyboard shows/hides)
		window.visualViewport?.addEventListener('geometrychange', updateViewportOffset);

		// recalculate on app resume (fixes Chrome PWA stale offset)
		document.addEventListener('visibilitychange', handleVisibilityChange);

		// also update when player visibility changes
		const observer = new MutationObserver(updatePlayerHeight);
		observer.observe(document.body, { childList: true, subtree: true });

		return () => {
			window.removeEventListener('resize', handleResize);
			window.visualViewport?.removeEventListener('resize', updateViewportOffset);
			window.visualViewport?.removeEventListener('scroll', updateViewportOffset);
			window.visualViewport?.removeEventListener('geometrychange', updateViewportOffset);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			observer.disconnect();
			document.documentElement.style.setProperty('--visual-viewport-offset', '0px');
		};
	});

	// save volume to localStorage when it changes
	$effect(() => {
		localStorage.setItem('player_volume', player.volume.toString());
	});

	// handle track changes - load new audio when track changes
	let previousTrackId = $state<number | null>(null);
	let isLoadingTrack = $state(false);

	$effect(() => {
		if (!player.currentTrack || !player.audioElement) return;

		// only load new track if it actually changed
		if (player.currentTrack.id !== previousTrackId) {
			previousTrackId = player.currentTrack.id;
			player.playCountedForTrack = null;
			isLoadingTrack = true;

			player.audioElement.src = `${API_URL}/audio/${player.currentTrack.file_id}`;
			player.audioElement.load();

			// wait for audio to be ready before allowing playback
			player.audioElement.addEventListener('loadeddata', () => {
				isLoadingTrack = false;
			}, { once: true });
		}
	});

	// sync paused state with audio element
	$effect(() => {
		if (!player.audioElement || isLoadingTrack) return;

		if (player.paused) {
			player.audioElement.pause();
		} else {
			player.audioElement.play().catch(err => {
				console.error('playback failed:', err);
				player.paused = true;
			});
		}
	});

	// sync queue.currentTrack with player
	let previousQueueIndex = $state<number>(-1);
	let shouldAutoPlay = $state(false);

	$effect(() => {
		if (queue.currentTrack) {
			const trackChanged = queue.currentTrack.id !== player.currentTrack?.id;
			const indexChanged = queue.currentIndex !== previousQueueIndex;

			if (trackChanged) {
				// always update the current track in player
				player.currentTrack = queue.currentTrack;
				previousQueueIndex = queue.currentIndex;

				// only set shouldAutoPlay if this was a local update (not from another tab's broadcast)
				if (queue.lastUpdateWasLocal) {
					shouldAutoPlay = true;
				}
			} else if (indexChanged) {
				player.currentTime = 0;
				// only auto-play if this was a local update
				if (queue.lastUpdateWasLocal) {
					player.paused = false;
				}
				previousQueueIndex = queue.currentIndex;
			}
		}
	});

	// auto-play when track finishes loading
	$effect(() => {
		if (shouldAutoPlay && !isLoadingTrack) {
			player.paused = false;
			shouldAutoPlay = false;
		}
	});

	function handleTrackEnded() {
		if (!queue.autoAdvance) {
			player.reset();
			return;
		}

		if (queue.hasNext) {
			shouldAutoPlay = true;
			queue.next();
		} else {
			player.reset();
		}
	}

	function handlePrevious() {
		// smart back button logic:
		// - if we're more than 1 second into the song, restart it
		// - if we're within the first 1 second and there's a previous track, go to previous track
		// - otherwise restart the current song
		const RESTART_THRESHOLD = 1;

		if (player.currentTime > RESTART_THRESHOLD) {
			// restart current song
			player.currentTime = 0;
			if (player.paused) {
				player.paused = false;
			}
		} else if (queue.hasPrevious) {
			// go to previous track
			queue.previous();
		} else {
			// no previous track - restart current song
			player.currentTime = 0;
			if (player.paused) {
				player.paused = false;
			}
		}
	}
</script>

{#if player.currentTrack}
	<div class="player">
		<audio
			bind:this={player.audioElement}
			bind:currentTime={player.currentTime}
			bind:duration={player.duration}
			bind:volume={player.volume}
			onplay={() => {
				player.paused = false;
			}}
			onpause={() => {
				player.paused = true;
			}}
			onended={handleTrackEnded}
		></audio>

		<div class="player-content">
			<a href="/track/{player.currentTrack.id}" class="player-artwork">
				{#if player.currentTrack.image_url}
					<img src={player.currentTrack.image_url} alt="{player.currentTrack.title} artwork" />
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
						<span>{player.currentTrack.title}</span>
					</div>
				{:else}
					<a
						href="/track/{player.currentTrack.id}"
						class="player-title-link"
						class:scrolling={titleOverflows}
						bind:this={titleEl}
					>
						<span>{player.currentTrack.title}</span>
					</a>
				{/if}
				<div class="player-metadata">
					<a
						href="/u/{player.currentTrack.artist_handle}"
						class="player-artist-link"
						class:scrolling={artistOverflows}
						bind:this={artistEl}
					>
						<svg class="metadata-icon artist-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
							<circle cx="8" cy="5" r="3" stroke="currentColor" stroke-width="1.5" fill="none"/>
							<path d="M3 14c0-2.5 2-4.5 5-4.5s5 2 5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
						</svg>
						<span>{player.currentTrack.artist}</span>
					</a>
					{#if player.currentTrack.album}
						<span class="metadata-separator">•</span>
						<a
							href="/u/{player.currentTrack.artist_handle}/album/{player.currentTrack.album.slug}"
							class="player-album-link"
							class:scrolling={albumOverflows}
							bind:this={albumEl}
						>
							<svg class="metadata-icon album-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
								<rect x="2" y="2" width="12" height="12" stroke="currentColor" stroke-width="1.5" fill="none"/>
								<circle cx="8" cy="8" r="2.5" fill="currentColor"/>
							</svg>
							<span>{player.currentTrack.album.title}</span>
						</a>
					{/if}
				</div>
			</div>

			<div class="player-controls">
				<button
					class="control-btn"
					onclick={handlePrevious}
					title="previous track / restart"
				>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
						<path d="M6 4h2v16H6V4zm12 0l-10 8 10 8V4z"></path>
					</svg>
				</button>

				<button
					class="control-btn play-pause"
					onclick={() => player.togglePlayPause()}
					title={player.paused ? 'play' : 'pause'}
				>
					{#if !player.paused}
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
							<rect x="6" y="4" width="4" height="16" rx="1"></rect>
							<rect x="14" y="4" width="4" height="16" rx="1"></rect>
						</svg>
					{:else}
						<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
							<path d="M8 5v14l11-7z"></path>
						</svg>
					{/if}
				</button>

				<button
					class="control-btn"
					class:disabled={!queue.hasNext}
					onclick={() => queue.next()}
					title="next track"
					disabled={!queue.hasNext}
				>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
						<path d="M16 4h2v16h-2V4zM6 4l10 8-10 8V4z"></path>
					</svg>
				</button>

				<div class="playback-options">
					<button
						class="option-btn"
						class:active={queue.shuffle}
						onclick={() => queue.toggleShuffle()}
						title={queue.shuffle ? 'disable shuffle' : 'enable shuffle'}
					>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<polyline points="16 3 21 3 21 8"></polyline>
							<line x1="4" y1="20" x2="21" y2="3"></line>
							<polyline points="21 16 21 21 16 21"></polyline>
							<line x1="15" y1="15" x2="21" y2="21"></line>
							<line x1="4" y1="4" x2="9" y2="9"></line>
						</svg>
					</button>
				</div>

				<div class="time-control">
					<span class="time">{formattedCurrentTime}</span>
					<input
						type="range"
						class="seek-bar"
						min="0"
						max={player.duration || 0}
						bind:value={player.currentTime}
						style="--progress: {progressPercent}%"
					/>
					<span class="time">{formattedDuration}</span>
				</div>

				<div class="volume-control">
					<div class="volume-icon" class:muted={volumeState === 'muted'}>
						{#if volumeState === 'muted'}
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
								<line x1="23" y1="9" x2="17" y2="15"></line>
								<line x1="17" y1="9" x2="23" y2="15"></line>
							</svg>
						{:else if volumeState === 'max'}
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="max-volume">
								<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
								<path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
								<path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
							</svg>
						{:else}
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
								<path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
							</svg>
						{/if}
					</div>
					<input
						type="range"
						class="volume-bar"
						class:muted={volumeState === 'muted'}
						class:max={volumeState === 'max'}
						min="0"
						max="1"
						step="0.01"
						bind:value={player.volume}
					/>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.player {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		background: #1a1a1a;
		border-top: 1px solid #333;
		padding: 0.75rem 2rem;
		padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
		z-index: 100;
		/* stay glued to the live visual viewport (iOS bottom bar hides) */
		transform: translate3d(0, var(--visual-viewport-offset, 0px), 0);
		-webkit-transform: translate3d(0, var(--visual-viewport-offset, 0px), 0);
		will-change: transform;
	}

	.player-content {
		max-width: 1200px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: 1.5rem;
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
		min-width: 0; /* critical for text overflow in flex/grid */
	}

	.player-title {
		font-weight: 600;
		color: #e8e8e8;
		margin-bottom: 0.15rem;
		font-size: 0.95rem;
		overflow: hidden;
		position: relative;
	}

	.player-title.scrolling {
		/* keep overflow hidden to constrain within grid */
		overflow: hidden;
		mask-image: linear-gradient(to right, black 0%, black calc(100% - 20px), transparent 100%);
		-webkit-mask-image: linear-gradient(to right, black 0%, black calc(100% - 20px), transparent 100%);
	}

	.player-title span {
		display: inline-block;
		white-space: nowrap;
	}

	.player-title.scrolling span {
		padding-right: 2rem;
		animation: scroll-text 10s linear infinite;
	}

	.player-title-link {
		font-weight: 600;
		color: #e8e8e8;
		margin-bottom: 0.15rem;
		font-size: 0.95rem;
		overflow: hidden;
		position: relative;
		text-decoration: none;
		transition: color 0.2s;
		display: block;
	}

	.player-title-link:hover {
		color: var(--accent);
	}

	.player-title-link.scrolling {
		overflow: hidden;
		mask-image: linear-gradient(to right, black 0%, black calc(100% - 20px), transparent 100%);
		-webkit-mask-image: linear-gradient(to right, black 0%, black calc(100% - 20px), transparent 100%);
	}

	.player-title-link span {
		display: inline-block;
		white-space: nowrap;
	}

	.player-title-link.scrolling span {
		padding-right: 2rem;
		animation: scroll-text 10s linear infinite;
	}

	@keyframes scroll-text {
		0%, 15% {
			transform: translateX(0); /* pause at start */
		}
		85%, 100% {
			transform: translateX(-100%); /* pause at end */
		}
	}

	.player-metadata {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		color: #909090;
		font-size: 0.85rem;
		overflow: hidden;
		min-width: 0; /* critical for text overflow */
	}

	.metadata-icon {
		width: 12px;
		height: 12px;
		opacity: 0.7;
		flex-shrink: 0;
		margin-right: 0.35rem;
	}

	.player-artist-link {
		color: #909090;
		text-decoration: none;
		transition: color 0.2s;
		white-space: nowrap;
		overflow: hidden;
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
	}

	.player-artist-link.scrolling {
		overflow: hidden;
		mask-image: linear-gradient(to right, black 0%, black calc(100% - 15px), transparent 100%);
		-webkit-mask-image: linear-gradient(to right, black 0%, black calc(100% - 15px), transparent 100%);
	}

	.player-artist-link span {
		display: inline-block;
		white-space: nowrap;
	}

	.player-artist-link.scrolling span {
		padding-right: 1.5rem;
		animation: scroll-text 8s linear infinite;
	}

	.player-artist-link:hover {
		color: var(--accent);
	}

	.metadata-separator {
		display: none; /* hidden in vertical layout */
	}

	.player-album-link {
		color: #808080;
		text-decoration: none;
		transition: color 0.2s;
		white-space: nowrap;
		overflow: hidden;
		position: relative;
		min-width: 0;
		display: flex;
		align-items: center;
		width: 100%;
	}

	.player-album-link:hover {
		color: var(--accent);
	}

	.player-album-link.scrolling {
		overflow: hidden;
		mask-image: linear-gradient(to right, black 0%, black calc(100% - 15px), transparent 100%);
		-webkit-mask-image: linear-gradient(to right, black 0%, black calc(100% - 15px), transparent 100%);
	}

	.player-album-link span {
		display: inline-block;
		white-space: nowrap;
	}

	.player-album-link.scrolling span {
		padding-right: 1.5rem;
		animation: scroll-text 8s linear infinite;
	}

	.player-controls {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.playback-options {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.option-btn {
		background: transparent;
		border: 1px solid var(--border-default);
		color: var(--text-secondary);
		cursor: pointer;
		width: 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		transition: all 0.2s;
		position: relative;
	}

	.option-btn svg {
		width: 20px;
		height: 20px;
	}

	.option-btn:hover {
		color: var(--text-primary);
		border-color: var(--accent);
	}

	.option-btn.active {
		color: var(--accent);
		border-color: var(--accent);
	}

	.control-btn {
		background: transparent;
		border: none;
		color: #e8e8e8;
		cursor: pointer;
		padding: 0.6rem;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
		border-radius: 50%;
	}

	.control-btn svg {
		width: 24px;
		height: 24px;
	}

	.control-btn:hover {
		color: var(--accent);
		background: rgba(106, 159, 255, 0.1);
	}

	.control-btn.play-pause:active {
		transform: scale(0.95);
	}

	.time-control {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.time {
		font-size: 0.85rem;
		color: #909090;
		min-width: 45px;
		font-variant-numeric: tabular-nums;
	}

	.seek-bar,
	.volume-bar {
		flex: 1;
	}

	.volume-control {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: #909090;
		min-width: 140px;
		position: relative;
	}

	.volume-icon {
		display: flex;
		align-items: center;
		transition: all 0.3s;
	}

	.volume-icon.muted {
		color: #ff6b6b;
		animation: shake 0.5s ease-in-out;
	}

	.volume-icon .max-volume {
		color: var(--accent);
		animation: pulse 0.5s ease-in-out;
	}

	@keyframes shake {
		0%, 100% { transform: translateX(0); }
		25% { transform: translateX(-3px); }
		75% { transform: translateX(3px); }
	}

	@keyframes pulse {
		0%, 100% { transform: scale(1); }
		50% { transform: scale(1.15); }
	}

	input[type="range"] {
		-webkit-appearance: none;
		appearance: none;
		background: transparent;
		cursor: pointer;
	}

	input[type="range"]::-webkit-slider-runnable-track {
		background: linear-gradient(
			to right,
			color-mix(in srgb, var(--accent) 60%, transparent) 0%,
			color-mix(in srgb, var(--accent) 60%, transparent) var(--progress, 0%),
			color-mix(in srgb, var(--accent) 20%, transparent) var(--progress, 0%),
			color-mix(in srgb, var(--accent) 20%, transparent) 100%
		);
		height: 4px;
		border-radius: 2px;
	}

	input[type="range"]::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		background: var(--accent);
		height: 14px;
		width: 14px;
		border-radius: 50%;
		margin-top: -5px;
		transition: all 0.2s;
		/* increase interaction area without changing visual size */
		box-shadow: 0 0 0 8px transparent;
		cursor: pointer;
	}

	input[type="range"]::-webkit-slider-thumb:hover {
		background: var(--accent-hover);
		transform: scale(1.2);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 20%, transparent);
	}

	input[type="range"].muted::-webkit-slider-thumb {
		background: #ff6b6b;
	}

	input[type="range"].max::-webkit-slider-thumb {
		background: var(--accent);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	input[type="range"]::-moz-range-track {
		background: color-mix(in srgb, var(--accent) 20%, transparent);
		height: 4px;
		border-radius: 2px;
	}

	input[type="range"]::-moz-range-progress {
		background: color-mix(in srgb, var(--accent) 60%, transparent);
		height: 4px;
		border-radius: 2px;
	}

	input[type="range"]::-moz-range-thumb {
		background: var(--accent);
		height: 14px;
		width: 14px;
		border-radius: 50%;
		border: none;
		transition: all 0.2s;
		/* increase interaction area without changing visual size */
		box-shadow: 0 0 0 8px transparent;
		cursor: pointer;
	}

	input[type="range"]::-moz-range-thumb:hover {
		background: var(--accent-hover);
		transform: scale(1.2);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 20%, transparent);
	}

	input[type="range"].muted::-moz-range-thumb {
		background: #ff6b6b;
	}

	input[type="range"].max::-moz-range-thumb {
		background: var(--accent);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	@media (max-width: 768px) {
		.player {
			padding: 0.5rem 1rem;
			padding-bottom: max(0.5rem, env(safe-area-inset-bottom));
		}

		.player-content {
			flex-direction: column;
			gap: 0.75rem;
		}

		/* top row: artwork + info + prev/play/next */
		.player-artwork,
		.player-info,
		.player-controls {
			display: contents;
		}

		.player-artwork {
			width: 48px;
			height: 48px;
			align-self: center;
		}

		.player-info {
			min-width: 0;
			max-width: none;
			text-align: left;
			flex: 1;
			align-self: center;
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

		/* enable scrolling animation on mobile */
		.player-title.scrolling,
		.player-title-link.scrolling,
		.player-artist-link.scrolling,
		.player-album-link.scrolling {
			mask-image: linear-gradient(to right, black 0%, black calc(100% - 15px), transparent 100%);
			-webkit-mask-image: linear-gradient(to right, black 0%, black calc(100% - 15px), transparent 100%);
		}

		/* rearrange controls for compact mobile layout */
		.player-content {
			display: grid;
			grid-template-columns: 48px 1fr auto auto auto auto;
			grid-template-rows: auto auto;
			gap: 0.5rem 0.75rem;
			align-items: center;
		}

		.player-artwork {
			grid-row: 1;
			grid-column: 1;
		}

		.player-info {
			grid-row: 1;
			grid-column: 2 / 4;
			min-width: 0; /* critical for text overflow in grid */
			overflow: hidden;
		}

		.control-btn {
			grid-row: 1;
			padding: 0.5rem;
		}

		.control-btn:nth-of-type(1) {
			grid-column: 4;
		}

		.control-btn.play-pause {
			grid-column: 5;
		}

		.control-btn:nth-of-type(3) {
			grid-column: 6;
		}

		.control-btn svg {
			width: 28px;
			height: 28px;
		}

		.control-btn.play-pause svg {
			width: 32px;
			height: 32px;
		}

		.playback-options {
			grid-row: 2;
			grid-column: 1;
		}

		.option-btn {
			width: 36px;
			height: 36px;
		}

		.option-btn svg {
			width: 18px;
			height: 18px;
		}

		.time-control {
			grid-row: 2;
			grid-column: 2 / 7;
		}

		.time {
			font-size: 0.75rem;
			min-width: 38px;
		}

		/* hide volume control on mobile - use device volume */
		.volume-control {
			display: none;
		}
	}
</style>
