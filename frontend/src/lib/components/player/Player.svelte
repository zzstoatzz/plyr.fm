<script lang="ts">
	import { untrack } from 'svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { jam } from '$lib/jam.svelte';
	import { nowPlaying } from '$lib/now-playing.svelte';
	import { moderation } from '$lib/moderation.svelte';
	import { preferences } from '$lib/preferences.svelte';
	import { toast } from '$lib/toast.svelte';
	import { API_URL } from '$lib/config';
	import { getCachedAudioUrl } from '$lib/storage';
	import { hasPlayableLossless } from '$lib/audio-support';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import TrackInfo from './TrackInfo.svelte';
	import PlaybackControls from './PlaybackControls.svelte';
	import type { Track } from '$lib/types';

	// atprotofans base URL for supporter CTAs
	const ATPROTOFANS_URL = 'https://atprotofans.com';

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
			queue.play();
		});

		navigator.mediaSession.setActionHandler('pause', () => {
			queue.pause();
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
			if (details.seekTime !== undefined) {
				queue.seek(details.seekTime * 1000);
			}
		});

		navigator.mediaSession.setActionHandler('seekbackward', (details) => {
			if (player.audioElement) {
				const skipTime = details.seekOffset ?? 10;
				const newTime = Math.max(0, player.audioElement.currentTime - skipTime);
				queue.seek(newTime * 1000);
			}
		});

		navigator.mediaSession.setActionHandler('seekforward', (details) => {
			if (player.audioElement) {
				const skipTime = details.seekOffset ?? 10;
				const newTime = Math.min(player.duration, player.audioElement.currentTime + skipTime);
				queue.seek(newTime * 1000);
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

	// sync playback position to queue for persistence (skip in jam mode — server owns position)
	$effect(() => {
		if (!jam.active) {
			queue.progressMs = Math.round(player.currentTime * 1000);
		}
	});

	// track play count when threshold is reached
	$effect(() => { player.incrementPlayCount(); });

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

	// gated content error types
	interface GatedError {
		type: 'gated';
		artistDid: string;
		artistHandle: string;
		requiresAuth: boolean;
	}

	// get audio source URL - checks local cache first, falls back to network
	// throws GatedError if the track requires supporter access
	async function getAudioSource(file_id: string, track: Track): Promise<string> {
		try {
			const cachedUrl = await getCachedAudioUrl(file_id);
			if (cachedUrl) {
				return cachedUrl;
			}
		} catch (err) {
			console.error('failed to check audio cache:', err);
		}

		// for gated tracks, check authorization first
		if (track.gated) {
			const response = await fetch(`${API_URL}/audio/${file_id}`, {
				method: 'HEAD',
				credentials: 'include'
			});

			if (response.status === 401) {
				throw {
					type: 'gated',
					artistDid: track.artist_did,
					artistHandle: track.artist_handle,
					requiresAuth: true
				} as GatedError;
			}

			if (response.status === 402) {
				throw {
					type: 'gated',
					artistDid: track.artist_did,
					artistHandle: track.artist_handle,
					requiresAuth: false
				} as GatedError;
			}
		}

		return `${API_URL}/audio/${file_id}`;
	}

	// track whether we've restored saved position on initial hydration
	let positionRestored = false;

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

	// store previous playback state for restoration on gated errors
	let savedPlaybackState = $state<{
		track: Track;
		src: string;
		currentTime: number;
		paused: boolean;
	} | null>(null);

	$effect(() => {
		if (!player.currentTrack || !player.audioElement) return;

		// only load new track if it actually changed
		if (player.currentTrack.id !== previousTrackId) {
			const trackToLoad = player.currentTrack;
			const audioElement = player.audioElement;

			// save current playback state BEFORE changing anything
			// (only if we have a playing/paused track to restore to)
			if (previousTrackId !== null && audioElement.src && !audioElement.src.startsWith('blob:')) {
				const prevTrack = queue.tracks.find((t) => t.id === previousTrackId);
				if (prevTrack) {
					savedPlaybackState = {
						track: prevTrack,
						src: audioElement.src,
						currentTime: audioElement.currentTime,
						paused: audioElement.paused
					};
				}
			}

			// update tracking state
			previousTrackId = trackToLoad.id;
			player.resetPlayCount();
			isLoadingTrack = true;

			// cleanup previous blob URL before loading new track
			cleanupBlobUrl();

			// use lossless original if browser supports it, otherwise transcoded
			const fileId = (trackToLoad.original_file_id && hasPlayableLossless(trackToLoad.original_file_type)) ? trackToLoad.original_file_id : trackToLoad.file_id;
			getAudioSource(fileId, trackToLoad)
				.then((src) => {
					// check if track is still current (user may have changed tracks during await)
					if (player.currentTrack?.id !== trackToLoad.id || !player.audioElement) {
						// track changed, cleanup if we created a blob URL
						if (src.startsWith('blob:')) {
							URL.revokeObjectURL(src);
						}
						return;
					}

					// successfully got source - clear saved state
					savedPlaybackState = null;

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
							// restore position on initial hydration only
							if (!positionRestored && queue.progressMs > 0 && player.audioElement) {
								const positionSec = queue.progressMs / 1000;
								// don't restore if near the end (within 5s of duration)
								if (player.duration === 0 || positionSec < player.duration - 5) {
									player.audioElement.currentTime = positionSec;
								}
								positionRestored = true;
							}
							isLoadingTrack = false;
						},
						{ once: true }
					);
				})
				.catch((err) => {
					isLoadingTrack = false;

					// handle gated content errors with supporter CTA
					if (err && err.type === 'gated') {
						const gatedErr = err as GatedError;

						if (gatedErr.requiresAuth) {
							toast.info('sign in to play supporter-only tracks');
						} else {
							// show toast with supporter CTA
							const supportUrl = gatedErr.artistDid
								? `${ATPROTOFANS_URL}/${gatedErr.artistDid}`
								: `${ATPROTOFANS_URL}/${gatedErr.artistHandle}`;

							toast.info('this track is for supporters only', 5000, {
								label: 'become a supporter',
								href: supportUrl
							});
						}

						// restore previous playback if we had something playing
						if (savedPlaybackState && player.audioElement) {
							player.currentTrack = savedPlaybackState.track;
							previousTrackId = savedPlaybackState.track.id;
							player.audioElement.src = savedPlaybackState.src;
							player.audioElement.currentTime = savedPlaybackState.currentTime;
							if (!savedPlaybackState.paused) {
								player.audioElement.play().catch(() => {});
							}
							savedPlaybackState = null;
							return;
						}

						// no previous state to restore - skip to next or stop
						if (queue.hasNext) {
							queue.next();
						} else {
							player.currentTrack = null;
							player.paused = true;
						}
						return;
					}

					console.error('failed to load audio:', err);
				});
		}
	});

	// sync paused state with audio element (output device only — non-output stays silent)
	$effect(() => {
		if (!player.audioElement || isLoadingTrack) return;

		// non-output jam clients: always pause audio (handles output transfer)
		if (jam.active && !jam.isOutputDevice) {
			player.audioElement.pause();
			return;
		}

		if (player.paused) {
			player.audioElement.pause();
		} else {
			player.audioElement.play().catch((err) => {
				console.error('[player] playback failed:', err.name, err.message);
				player.paused = true;
			});
		}
	});

	// sync queue.currentTrack with player
	let previousQueueIndex = $state<number>(-1);
	let shouldAutoPlay = $state(false);

	$effect(() => {
		// in jam mode, jam state drives the player directly
		if (jam.active && jam.currentTrack) {
			const trackChanged = jam.currentTrack.id !== player.currentTrack?.id;
			if (trackChanged) {
				player.currentTrack = jam.currentTrack;
				shouldAutoPlay = jam.isPlaying && jam.isOutputDevice;
			}
			return;
		}

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
			// if jam paused while track was loading, respect that
			if (jam.active && !jam.isPlaying) {
				shouldAutoPlay = false;
				return;
			}
			player.paused = false;
			shouldAutoPlay = false;
		}
	});

	// sync play/pause from jam state (all participants — UI reflects jam state)
	// audio element gating is handled separately above
	// NOTE: isLoadingTrack must be tracked (outside untrack) so this re-runs after loading
	$effect(() => {
		if (!jam.active) return;
		const jamPlaying = jam.isPlaying;
		const jamTrackId = jam.currentTrack?.id;
		const loading = isLoadingTrack;
		untrack(() => {
			// if paused while loading, cancel pending auto-play so it doesn't override
			if (!jamPlaying) shouldAutoPlay = false;
			if (loading) return;
			if (!jamTrackId || jamTrackId !== player.currentTrack?.id) return;
			player.paused = !jamPlaying;
		});
	});

	// jam drift correction: seek if >2s off from server (output device only)
	// only runs when jam state changes (progressMs/serverTimeMs from WS), not every frame
	$effect(() => {
		if (!jam.active) return;
		if (!jam.isOutputDevice) return;
		// track jam state as dependencies (these change on WS messages)
		const serverPos = jam.interpolatedProgressMs / 1000;
		const jamTrackId = jam.currentTrack?.id;
		// read player state without tracking to avoid running every frame
		untrack(() => {
			if (!player.audioElement || !player.duration) return;
			if (!jamTrackId || jamTrackId !== player.currentTrack?.id) return;
			const drift = Math.abs(player.currentTime - serverPos);
			if (drift > 2) {
				player.audioElement.currentTime = serverPos;
			}
		});
	});

	// non-output jam clients: sync progress bar from jam state
	// seeks the (paused, silent) audio element so PlaybackControls' rAF picks it up
	$effect(() => {
		if (!jam.active || jam.isOutputDevice) return;
		if (!player.audioElement) return;
		// snap position on state changes (pause, seek, track change)
		const pos = jam.interpolatedProgressMs / 1000;
		if (player.audioElement.readyState >= 1) {
			player.audioElement.currentTime = pos;
		}
		if (!jam.isPlaying) return;
		// while playing, smoothly interpolate between state updates
		const interval = window.setInterval(() => {
			if (player.audioElement && player.audioElement.readyState >= 1) {
				player.audioElement.currentTime = jam.interpolatedProgressMs / 1000;
			}
		}, 250);
		return () => window.clearInterval(interval);
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
	<div class="player" class:jam-active={jam.active} class:is-playing={!player.paused}>
		<audio
			bind:this={player.audioElement}
			bind:currentTime={player.currentTime}
			bind:duration={player.duration}
			bind:volume={player.volume}
			onplay={() => { if (!jam.active) player.paused = false; }}
			onpause={() => { if (!jam.active) player.paused = true; }}
			onended={handleTrackEnded}
		></audio>

		{#if jam.active}
			<div class="jam-stripe-label">
				<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>{#if jam.isOutputDevice}<path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>{/if}</svg>
				{#if jam.outputMode === 'everyone'}
					<span class="muted">everyone plays</span>
				{:else if jam.isOutputDevice}
					playing here
				{:else}
					playing elsewhere
					<button class="play-here-pill" onclick={() => jam.setOutput()}>play here</button>
				{/if}
			</div>
		{/if}

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
		--top-bar-color: var(--accent);
	}

	.player::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: var(--top-bar-color); opacity: 0.32; filter: saturate(0.9) brightness(0.75); box-shadow: 0 0 0 transparent; transition: opacity 0.15s ease-out, filter 0.15s ease-out, box-shadow 0.2s ease-out; pointer-events: none; z-index: 2; }
	.player.is-playing::before { opacity: 0.95; filter: saturate(1.25) brightness(1.28); box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 65%, transparent), 0 0 14px color-mix(in srgb, var(--accent) 45%, transparent); }

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

	.player.jam-active { --top-bar-color: linear-gradient(90deg, #ff6b6b, #ffd93d, #6bcb77, #4d96ff, #9b59b6, #ff6b6b); }

	.jam-stripe-label {
		position: absolute;
		top: 0;
		left: 50%;
		transform: translate(-50%, -50%);
		background: color-mix(in srgb, var(--bg-tertiary) 95%, transparent);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-full);
		padding: 0.1rem 0.5rem;
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		white-space: nowrap;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		z-index: 3;
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}

	.jam-stripe-label .muted {
		color: var(--text-muted);
	}

	.play-here-pill {
		padding: 0 0.375rem;
		font-size: var(--text-xs);
		font-family: inherit;
		background: transparent;
		border: none;
		border-left: 1px solid var(--border-subtle);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: color 0.15s ease;
		margin-left: 0.125rem;
		padding-left: 0.375rem;
	}

	.play-here-pill:hover {
		color: var(--accent);
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
