<script lang="ts">
	import { untrack } from 'svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { jam } from '$lib/jam.svelte';
	import { nowPlaying } from '$lib/now-playing.svelte';
	import { moderation } from '$lib/moderation.svelte';
	import { preferences } from '$lib/preferences.svelte';
	import { toast } from '$lib/toast.svelte';
	import {
		gatedErrorFromResolution,
		pickFileIdForTrack,
		resolveAudioSource,
		type GatedError,
		type ResolvedSource
	} from '$lib/audio-source';
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
	// also tracked so an in-place audio replace (same track id, new file_id)
	// triggers a fresh load — see PUT /tracks/{id}/audio in the portal edit form.
	let previousFileId = $state<string | null>(null);
	let isLoadingTrack = $state(false);

	// Source-of-truth for what's actually wired to the audio element.
	// Distinct from `previousTrackId` (used by the loader's
	// trackChanged/fileChanged check) because the synchronous fast path
	// needs the loader to recognize "audio is already attached, don't
	// reload" without going through the full reactivity dance first.
	let attachedTrackId: number | null = null;
	let attachedFileId: string | null = null;

	// Pre-resolved source for the next track that natural end-of-track
	// continuation will attempt. The locked-screen autoplay grace
	// requires that `audio.src = …; audio.play()` happens in the same
	// tick as the `ended` event — we cannot afford an `await` inside
	// `handleTrackEnded`. So we do the resolution opportunistically
	// while the current track is still playing.
	let preloadedNext = $state<ResolvedSource | null>(null);

	function discardPreload() {
		const cached = preloadedNext;
		if (cached && cached.kind === 'ready' && cached.ownsBlob) {
			URL.revokeObjectURL(cached.src);
		}
		preloadedNext = null;
	}

	function preloadIsFreshFor(track: Track): boolean {
		const cached = preloadedNext;
		if (!cached) return false;
		if (cached.trackId !== track.id) return false;
		if (cached.kind === 'ready' && cached.fileIdUsed !== pickFileIdForTrack(track)) {
			return false;
		}
		return true;
	}

	// kick off resolution for the upcoming continuation track. tracked
	// reads (queue.autoAdvanceTrack, jam.active) wake this up; the
	// preloadedNext write goes through `untrack` so we don't self-trigger.
	$effect(() => {
		const next = queue.autoAdvanceTrack;
		const jamActive = jam.active;

		untrack(() => {
			if (!next || jamActive) {
				discardPreload();
				return;
			}
			if (preloadIsFreshFor(next)) return;

			// the existing entry is for a different track or stale file —
			// drop it before fetching the new one.
			discardPreload();

			const fileIdUsed = pickFileIdForTrack(next);
			void resolveAudioSource(next, fileIdUsed).then((resolved) => {
				// the queue may have advanced or jam toggled while we awaited.
				// if so, this resolution is for a track we no longer care
				// about; throw away any blob it owns rather than caching it.
				const stillWanted =
					queue.autoAdvanceTrack?.id === next.id && !jam.active;
				if (!stillWanted) {
					if (resolved.kind === 'ready' && resolved.ownsBlob) {
						URL.revokeObjectURL(resolved.src);
					}
					return;
				}
				preloadedNext = resolved;
			});
		});
	});

	// Wire `resolved` (cached or freshly fetched) to the audio element.
	// Shared between the reactive loader (slow path) and `handleTrackEnded`
	// (fast path) so the loadeddata wiring, blob ownership, and play-count
	// unlock all live in exactly one place.
	function attachResolvedSource(
		audio: HTMLAudioElement,
		resolved: Extract<ResolvedSource, { kind: 'ready' }>
	): void {
		// the new src may be the same blob we already own, or a new one.
		// only revoke when we'd be replacing it with something else.
		if (currentBlobUrl && currentBlobUrl !== resolved.src) {
			URL.revokeObjectURL(currentBlobUrl);
			currentBlobUrl = null;
		}
		if (resolved.ownsBlob) {
			currentBlobUrl = resolved.src;
		}

		attachedTrackId = resolved.trackId;
		attachedFileId = resolved.fileIdUsed;

		// attach listener BEFORE load() to avoid race with cached audio.
		audio.addEventListener(
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
				// unlock play counting now that new audio is ready
				// (prevents spurious fires from stale currentTime during transitions)
				player.unlockPlayCount();
			},
			{ once: true }
		);

		audio.src = resolved.src;
		audio.load();
	}

	function handleGatedDenial(err: GatedError): void {
		if (err.requiresAuth) {
			toast.info('sign in to play supporter-only tracks');
		} else {
			const supportUrl = err.artistDid
				? `${ATPROTOFANS_URL}/${err.artistDid}`
				: `${ATPROTOFANS_URL}/${err.artistHandle}`;
			toast.info('this track is for supporters only', 5000, {
				label: 'become a supporter',
				href: supportUrl
			});
		}

		// skip to next playable (non-gated) track in queue. always intend to
		// auto-play the skipped-to track: whether the user clicked a gated
		// track or natural auto-advance landed on one, the user wants the
		// next playable track to start. matches pre-fast-path behavior.
		let nextPlayable = -1;
		for (let i = queue.currentIndex + 1; i < queue.tracks.length; i++) {
			if (!queue.tracks[i].gated) {
				nextPlayable = i;
				break;
			}
		}
		if (nextPlayable >= 0) {
			shouldAutoPlay = true;
			queue.goTo(nextPlayable);
		} else {
			player.paused = true;
		}
	}

	$effect(() => {
		if (!player.currentTrack || !player.audioElement) return;

		// reload when either the track id changes (navigation/queue advance) or
		// the file_id changes for the same track (audio replaced from edit form).
		const trackChanged = player.currentTrack.id !== previousTrackId;
		const fileChanged = player.currentTrack.file_id !== previousFileId;
		if (!trackChanged && !fileChanged) return;

		const trackToLoad = player.currentTrack;

		// the synchronous fast path may have already attached this exact
		// track+file to the audio element. when it has, the loader's job
		// is just to rebase its bookkeeping — re-running the async fetch
		// would trample the in-flight playback.
		if (
			attachedTrackId === trackToLoad.id &&
			attachedFileId === trackToLoad.file_id
		) {
			previousTrackId = trackToLoad.id;
			previousFileId = trackToLoad.file_id;
			return;
		}

		// update tracking state
		previousTrackId = trackToLoad.id;
		previousFileId = trackToLoad.file_id;
		player.resetPlayCount();
		isLoadingTrack = true;

		const fileIdUsed = pickFileIdForTrack(trackToLoad);

		// if the prefetcher already resolved this exact track, reuse it
		// — the resolution result came from `resolveAudioSource`, the
		// same function the slow path would call, so reusing is safe.
		const cached = preloadedNext;
		if (cached && cached.trackId === trackToLoad.id) {
			preloadedNext = null;
			if (cached.kind === 'ready' && cached.fileIdUsed === fileIdUsed) {
				cleanupBlobUrl();
				attachResolvedSource(player.audioElement, cached);
				return;
			}
			if (cached.kind === 'gated-denied') {
				isLoadingTrack = false;
				handleGatedDenial(gatedErrorFromResolution(cached));
				return;
			}
			// stale fileId or `failed` → fall through to fresh fetch below
		}

		cleanupBlobUrl();
		void resolveAudioSource(trackToLoad, fileIdUsed).then((resolved) => {
			// check if track is still current (user may have changed tracks during await)
			if (player.currentTrack?.id !== trackToLoad.id || !player.audioElement) {
				if (resolved.kind === 'ready' && resolved.ownsBlob) {
					URL.revokeObjectURL(resolved.src);
				}
				return;
			}

			if (resolved.kind === 'ready') {
				attachResolvedSource(player.audioElement, resolved);
				return;
			}

			isLoadingTrack = false;
			if (resolved.kind === 'gated-denied') {
				handleGatedDenial(gatedErrorFromResolution(resolved));
				return;
			}
			console.error('failed to load audio:', resolved.error);
		});
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
			player.audioElement.play().catch((err: unknown) => {
				const e = err as { name?: string; message?: string };
				console.error('[player] playback failed:', e?.name, e?.message);
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

		const next = queue.autoAdvanceTrack;
		if (!next) {
			player.reset();
			nowPlaying.clear();
			return;
		}

		// Fast path: if the prefetcher already has a ready source for the
		// track we want to advance to, swap `audio.src` and call `play()`
		// synchronously here — same tick as the `ended` event. The locked-
		// screen autoplay grace on Android requires zero `await`s between
		// the natural-end signal and the next play() call; the reactive
		// chain (queue.next() → effect → effect → fetch → load → effect →
		// play) takes too many ticks and the browser drops the implicit
		// playback permission, blocking the next play() with NotAllowed.
		const audio = player.audioElement;
		const cached = preloadedNext;
		const canFastPath =
			!jam.active &&
			audio !== null &&
			cached !== null &&
			cached.kind === 'ready' &&
			cached.trackId === next.id;

		if (canFastPath) {
			// We've already set canFastPath using a discriminant on cached.kind,
			// but TypeScript narrowing through `&&` in a const doesn't reach the
			// access below — re-narrow explicitly.
			if (cached?.kind !== 'ready' || !audio) return;
			advanceToPreloadedSynchronously(audio, cached, next);
			return;
		}

		// Slow path: either no preload, jam active, or some race made the
		// preload stale. Defer to the reactive chain — it works on
		// foregrounded tabs and on most desktop browsers; the lock-screen
		// case is the one that needs the fast path above. If the eventual
		// `audio.play()` from the slow path rejects (e.g. on locked Android
		// when this fast-path-skip happened because the preload was stale),
		// the paused-sync effect's `play().catch(...)` will record the
		// rejection with `fastPath: false` so dashboards can compare paths.
		shouldAutoPlay = true;
		queue.next();
	}

	function advanceToPreloadedSynchronously(
		audio: HTMLAudioElement,
		preloaded: Extract<ResolvedSource, { kind: 'ready' }>,
		next: Track
	): void {
		// Reset play counting BEFORE the swap so a stale (currentTime
		// near duration) reading from the just-ended track can't fire a
		// spurious increment between here and `loadeddata` unlocking.
		player.resetPlayCount();
		isLoadingTrack = true;

		// Sync ALL bookkeeping that downstream effects key off so they
		// recognize "no work to do" once they wake. Without this,
		// `queue.next()` below would trigger the queue→player sync
		// effect's `indexChanged` branch, which would slam
		// `player.currentTime = 0` and seek the just-started audio
		// back to the start.
		previousTrackId = next.id;
		previousFileId = next.file_id;
		previousQueueIndex = queue.currentIndex + 1;
		preloadedNext = null;

		// Wire the new src to the audio element. `attachResolvedSource`
		// also takes ownership of any blob URL on the resolved object,
		// revoking the previous blob if this isn't the same one.
		attachResolvedSource(audio, preloaded);

		// THE critical call: synchronous, same-tick play() to preserve
		// the implicit-playback grace from the `ended` event. Anything
		// that yields between here and play() costs us the autoplay
		// permission on locked Android.
		const playPromise = audio.play();
		if (playPromise && typeof playPromise.catch === 'function') {
			playPromise.catch((err: unknown) => {
				const e = err as { name?: string; message?: string };
				console.error('[player] fast-path play failed:', e?.name, e?.message);
				player.paused = true;
			});
		}

		// Now let reactivity catch up. Setting player.currentTrack first
		// (and pre-incrementing previousQueueIndex above) keeps every
		// downstream effect a no-op except for media-session metadata
		// + now-playing reporting, which we DO want to refresh.
		//
		// THESE TWO LINES MUST STAY ADJACENT in the same synchronous
		// tick. Between `player.currentTrack = next` and `queue.next()`,
		// the queue→player sync effect would observe a stale
		// queue.currentTrack !== player.currentTrack and try to roll
		// player.currentTrack back to the old track. Svelte batches
		// effect flushes until the synchronous frame ends, so as long
		// as nothing here yields (no await, no setTimeout) the effect
		// only runs after both writes land and sees a consistent state.
		// A future refactor that introduces any yield between these two
		// statements will reintroduce that race.
		player.currentTrack = next;
		queue.next();
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
