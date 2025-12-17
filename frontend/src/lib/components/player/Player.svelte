<script lang="ts">
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { nowPlaying } from '$lib/now-playing.svelte';
	import { moderation } from '$lib/moderation.svelte';
	import { preferences } from '$lib/preferences.svelte';
	import { API_URL } from '$lib/config';
	import { getCachedAudioUrl } from '$lib/storage';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import TrackInfo from './TrackInfo.svelte';
	import PlaybackControls from './PlaybackControls.svelte';
	import type { Track } from '$lib/types';

	// check if artwork should be shown in media session (respects sensitive content settings)
	function shouldShowArtwork(url: string | null | undefined): boolean {
		if (!url) return false;
		if (!moderation.isSensitive(url)) return true;
		return preferences.showSensitiveArtwork;
	}

	// update media session metadata for system media controls (CarPlay, lock screen, etc.)
	function updateMediaSessionMetadata(track: Track) {
		if (!('mediaSession' in navigator)) return;

		// build artwork array, respecting sensitive content settings
		const artwork: MediaImage[] = [];
		if (shouldShowArtwork(track.image_url)) {
			artwork.push({ src: track.image_url!, sizes: '512x512', type: 'image/jpeg' });
		} else if (shouldShowArtwork(track.album?.image_url)) {
			// fall back to album artwork if no track artwork (or track artwork is sensitive)
			artwork.push({ src: track.album!.image_url!, sizes: '512x512', type: 'image/jpeg' });
		} else if (shouldShowArtwork(track.artist_avatar_url)) {
			// fall back to artist avatar if no album artwork (or album artwork is sensitive)
			artwork.push({ src: track.artist_avatar_url!, sizes: '256x256', type: 'image/jpeg' });
		}

		navigator.mediaSession.metadata = new MediaMetadata({
			title: track.title,
			artist: track.artist,
			album: track.album?.title ?? '',
			artwork
		});
	}

	// set up media session action handlers
	function setupMediaSessionHandlers() {
		if (!('mediaSession' in navigator)) return;

		navigator.mediaSession.setActionHandler('play', () => {
			player.paused = false;
		});

		navigator.mediaSession.setActionHandler('pause', () => {
			player.paused = true;
		});

		navigator.mediaSession.setActionHandler('previoustrack', () => {
			if (queue.hasPrevious) {
				queue.previous();
			}
		});

		navigator.mediaSession.setActionHandler('nexttrack', () => {
			if (queue.hasNext) {
				queue.next();
			}
		});

		navigator.mediaSession.setActionHandler('seekto', (details) => {
			if (details.seekTime !== undefined && player.audioElement) {
				player.audioElement.currentTime = details.seekTime;
			}
		});

		navigator.mediaSession.setActionHandler('seekbackward', (details) => {
			if (player.audioElement) {
				const skipTime = details.seekOffset ?? 10;
				player.audioElement.currentTime = Math.max(0, player.audioElement.currentTime - skipTime);
			}
		});

		navigator.mediaSession.setActionHandler('seekforward', (details) => {
			if (player.audioElement) {
				const skipTime = details.seekOffset ?? 10;
				player.audioElement.currentTime = Math.min(
					player.duration,
					player.audioElement.currentTime + skipTime
				);
			}
		});
	}

	// check if we're on the current track's detail page
	let isOnTrackDetailPage = $derived(
		player.currentTrack && $page.url.pathname === `/track/${player.currentTrack.id}`
	);

	let trackInfoRef = $state<{ recalcOverflow: () => void } | null>(null);

	$effect(() => {
		if (player.currentTrack) {
			trackInfoRef?.recalcOverflow();
		}
	});

	// track play count when threshold is reached
	$effect(() => {
		player.incrementPlayCount();
	});

	onMount(() => {
		// set up media session handlers for system controls (CarPlay, lock screen, etc.)
		setupMediaSessionHandlers();

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
				// limited effectiveness: only detects document growth (e.g., dynamic content)
				// relies on visibilitychange handler for browser chrome changes
				const layoutHeight = window.innerHeight;
				const documentHeight = document.documentElement.scrollHeight;
				const offset = Math.max(0, documentHeight - layoutHeight);
				document.documentElement.style.setProperty('--visual-viewport-offset', `${offset}px`);
			}
		}

		function handleVisibilityChange() {
			// recalculate when app resumes from background (fixes stale measurements)
			if (document.visibilityState === 'visible') {
				updatePlayerHeight();
				updateViewportOffset();
				trackInfoRef?.recalcOverflow();
			}
		}

		function handleResize() {
			updatePlayerHeight();
			updateViewportOffset();
			trackInfoRef?.recalcOverflow();
		}

		// update on mount and resize
		updatePlayerHeight();
		updateViewportOffset();
		trackInfoRef?.recalcOverflow();
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

	// update media session metadata when track changes
	$effect(() => {
		if (player.currentTrack) {
			updateMediaSessionMetadata(player.currentTrack);
		}
	});

	// update media session playback state when paused changes
	$effect(() => {
		if (!('mediaSession' in navigator)) return;
		navigator.mediaSession.playbackState = player.paused ? 'paused' : 'playing';
	});

	// update media session position state when time/duration changes
	$effect(() => {
		if (!('mediaSession' in navigator) || !player.duration || player.duration <= 0) return;
		try {
			navigator.mediaSession.setPositionState({
				duration: player.duration,
				playbackRate: 1,
				position: Math.min(player.currentTime, player.duration)
			});
		} catch {
			// ignore errors from invalid position state
		}
	});

	// report now-playing state for external integrations (teal.fm/Piper)
	$effect(() => {
		if (!player.currentTrack || !player.duration) return;

		nowPlaying.report(
			player.currentTrack,
			!player.paused,
			player.currentTime * 1000, // convert to ms
			player.duration * 1000
		);
	});

	// get audio source URL - checks local cache first, falls back to network
	async function getAudioSource(file_id: string): Promise<string> {
		try {
			const cachedUrl = await getCachedAudioUrl(file_id);
			if (cachedUrl) {
				return cachedUrl;
			}
		} catch (err) {
			console.error('failed to check audio cache:', err);
		}
		return `${API_URL}/audio/${file_id}`;
	}

	// track blob URLs we've created so we can revoke them
	let currentBlobUrl: string | null = null;

	function cleanupBlobUrl() {
		if (currentBlobUrl) {
			URL.revokeObjectURL(currentBlobUrl);
			currentBlobUrl = null;
		}
	}

	// handle track changes - load new audio when track changes
	let previousTrackId = $state<number | null>(null);
	let isLoadingTrack = $state(false);

	$effect(() => {
		if (!player.currentTrack || !player.audioElement) return;

		// only load new track if it actually changed
		if (player.currentTrack.id !== previousTrackId) {
			const trackToLoad = player.currentTrack;
			previousTrackId = trackToLoad.id;
			player.resetPlayCount();
			isLoadingTrack = true;

			// cleanup previous blob URL before loading new track
			cleanupBlobUrl();

			// async: get audio source (cached or network)
			getAudioSource(trackToLoad.file_id).then((src) => {
				// check if track is still current (user may have changed tracks during await)
				if (player.currentTrack?.id !== trackToLoad.id || !player.audioElement) {
					// track changed, cleanup if we created a blob URL
					if (src.startsWith('blob:')) {
						URL.revokeObjectURL(src);
					}
					return;
				}

				// track if this is a blob URL so we can revoke it later
				if (src.startsWith('blob:')) {
					currentBlobUrl = src;
				}

				player.audioElement.src = src;
				player.audioElement.load();

				// wait for audio to be ready before allowing playback
				player.audioElement.addEventListener(
					'loadeddata',
					() => {
						isLoadingTrack = false;
					},
					{ once: true }
				);
			});
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
			nowPlaying.clear();
			return;
		}

		if (queue.hasNext) {
			shouldAutoPlay = true;
			queue.next();
		} else {
			player.reset();
			nowPlaying.clear();
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
			onplay={() => player.paused = false}
			onpause={() => player.paused = true}
			onended={handleTrackEnded}
		></audio>

		<div class="player-content">
			<TrackInfo
				track={player.currentTrack}
				isOnTrackDetailPage={Boolean(isOnTrackDetailPage)}
				bind:this={trackInfoRef}
			/>
			<PlaybackControls />
		</div>
	</div>
{/if}

<style>
	.player {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		background: var(--glass-bg, var(--bg-tertiary));
		backdrop-filter: var(--glass-blur, none);
		-webkit-backdrop-filter: var(--glass-blur, none);
		border-top: 1px solid var(--glass-border, var(--border-default));
		padding: 0.75rem 2rem;
		padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
		z-index: 100;
		transform: translate3d(0, var(--visual-viewport-offset, 0px), 0);
		-webkit-transform: translate3d(0, var(--visual-viewport-offset, 0px), 0);
		will-change: transform;
	}

	.player-content {
		width: 100%;
		margin: 0;
		display: grid;
		grid-template-columns: minmax(200px, 420px) minmax(0, 1fr);
		align-items: center;
		gap: 1.5rem;
	}

	@media (max-width: 1100px) {
		.player-content {
			grid-template-columns: minmax(160px, 360px) minmax(0, 1fr);
			gap: 1rem;
		}
	}

	@media (max-width: 768px) {
		.player {
			padding: 0.5rem 1rem;
			padding-bottom: max(0.5rem, env(safe-area-inset-bottom));
		}

		.player-content {
			grid-template-columns: 48px 1fr auto auto auto auto;
			grid-template-rows: auto auto;
			gap: 0.5rem 0.75rem;
		}
	}
</style>
