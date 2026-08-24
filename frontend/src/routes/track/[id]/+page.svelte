<script lang="ts">
	import { fly, scale, slide } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import type { PageData } from './$types';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import { API_URL } from '$lib/config';
	import Header from '$lib/components/Header.svelte';
	import AddToMenu from '$lib/components/AddToMenu.svelte';
	import TrackComments from '$lib/components/TrackComments.svelte';
	import TagEffects from '$lib/components/TagEffects.svelte';
	import SensitiveImage from '$lib/components/SensitiveImage.svelte';
	import LikersTooltip from '$lib/components/LikersTooltip.svelte';
	import { likersSheet } from '$lib/likers-sheet.svelte';
	import LosslessBadge from '$lib/components/LosslessBadge.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import DownloadButton from '$lib/components/DownloadButton.svelte';
	import { requestTrackDownload } from '$lib/downloads';
	import { moderation } from '$lib/moderation.svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { playTrack, guardGatedTrack } from '$lib/playback.svelte';
	import { isAwaitingPlayableRendition } from '$lib/audio-source';
	import { auth } from '$lib/auth.svelte';
	import { preferences } from '$lib/preferences.svelte';
	import { toast } from '$lib/toast.svelte';
	import { trackCoverUrl } from '$lib/track-cover';
	import { loginHref, redirectToLogin } from '$lib/utils/auth-redirect';
	import type { Track } from '$lib/types';


	// receive server-loaded data
	let { data }: { data: PageData } = $props();

	// null when SSR couldn't see it (private track / owner-only); the client
	// refetch below fills it in for the owner, or flips `notFound`.
	let track = $state<Track | null>(data.track);
	let notFound = $state(false);
	let isAdultLabeled = $derived(
		track?.labels?.some((label) => label === 'sexual' || label === 'porn') ?? false
	);
	let isProcessing = $derived(track ? isAwaitingPlayableRendition(track) : false);
	let mayPlayAdultAudio = $derived(
		!isAdultLabeled ||
		preferences.showSensitiveAudio ||
		(auth.user?.did != null && auth.user.did === track?.artist_did)
	);

	// the visible cover and the og:image cascade share the same root rule
	// (track art → album art); the og:image then fans out to the artist
	// avatar and brand logo so social scrapers always get *something* and
	// don't fall back to their own heuristics (favicon, first visible
	// image, stale client cache).
	const OG_FALLBACK_IMAGE = `${APP_CANONICAL_URL}/icons/icon-512.png`;
	const coverUrl = $derived.by(() => {
		const url = track ? trackCoverUrl(track) : undefined;
		return url && !moderation.isSensitive(url) ? url : undefined;
	});
	const previewImage = $derived.by(() => {
		if (coverUrl) return coverUrl;
		if (track?.artist_avatar_url && !moderation.isSensitive(track.artist_avatar_url)) {
			return track.artist_avatar_url;
		}
		return OG_FALLBACK_IMAGE;
	});
	const previewIsTrackArt = $derived(coverUrl !== undefined);

	// reactive check if this track is currently playing
	let isCurrentlyPlaying = $derived(
		track != null && player.currentTrack?.id === track.id && !player.paused
	);

	// mobile detection
	let isMobile = $state(false);

	$effect(() => {
		if (browser) {
			const mq = window.matchMedia('(max-width: 768px)');
			isMobile = mq.matches;
			const handler = (e: MediaQueryListEvent) => (isMobile = e.matches);
			mq.addEventListener('change', handler);
			return () => mq.removeEventListener('change', handler);
		}
	});

	// metadata disclosure panel
	let metadataOpen = $state(false);
	const reduceMotion =
		browser && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	let heartShake = $state(false);

	function nudgeSignIn() {
		heartShake = true;
		setTimeout(() => (heartShake = false), 500);
		toast.info('', 3000, { label: 'sign in to like tracks', href: loginHref() });
	}

	// likers tooltip state
	let showLikersTooltip = $state(false);
	let likersTooltipTimeout: ReturnType<typeof setTimeout> | null = null;

	function handleLikesMouseEnter() {
		if (isMobile) return;
		if (likersTooltipTimeout) {
			clearTimeout(likersTooltipTimeout);
			likersTooltipTimeout = null;
		}
		showLikersTooltip = true;
	}

	function handleLikesMouseLeave() {
		if (isMobile) return;
		likersTooltipTimeout = setTimeout(() => {
			showLikersTooltip = false;
			likersTooltipTimeout = null;
		}, 150);
	}

	function handleLikesClick() {
		if (!track) return;
		if (isMobile && track.like_count) {
			likersSheet.open(track.id, track.like_count);
		}
	}

	function handleLikesKeydown(event: KeyboardEvent) {
		if (!track) return;
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			if (isMobile && track.like_count) {
				likersSheet.open(track.id, track.like_count);
			} else {
				showLikersTooltip = true;
			}
		}
		if (event.key === 'Escape') {
			showLikersTooltip = false;
		}
	}


	async function loadLikedState() {
		if (!track) return;
		try {
			const response = await fetch(`${API_URL}/tracks/${track.id}`, {
				credentials: 'include'
			});

			if (response.ok) {
				track = await response.json();
			}
		} catch (e) {
			console.error('failed to load liked state:', e);
		}
	}

	async function handleLogout() {
		await auth.logout();
		window.location.href = '/';
	}

	async function handlePlay() {
		if (!track) return;
		if (!mayPlayAdultAudio) {
			if (!auth.isAuthenticated) {
				redirectToLogin();
			} else {
				toast.error('enable sensitive audio in settings to listen');
			}
			return;
		}
		if (player.currentTrack?.id === track.id) {
			// this track is already loaded - just toggle play/pause
			queue.togglePlayPause();
		} else {
			// different track or no track - start this one
			// use playTrack for gated content checks
			if (track.gated) {
				await playTrack(track);
			} else {
				queue.playNow(track);
			}
		}
	}

	function addToQueue() {
		if (!track) return;
		if (!mayPlayAdultAudio) {
			toast.error('enable sensitive audio in settings to queue this track');
			return;
		}
		if (!guardGatedTrack(track, auth.isAuthenticated)) return;
		queue.addTracks([track]);
		toast.success(`queued ${track.title}`, 1800);
	}



// track which track we've loaded data for to detect navigation
let loadedForTrackId = $state<number | null>(null);
// track if we've loaded liked state for this track (separate from general load)
let likedStateLoadedForTrackId = $state<number | null>(null);

// pending seek time from ?t= URL param (milliseconds)
let pendingSeekMs = $state<number | null>(null);

// reload data when navigating between track pages
// watch data.track.id (from server) not track.id (local state)
$effect(() => {
	const currentId = data.track?.id;
	if (!currentId || !browser) return;

	// check if we navigated to a different track
	if (loadedForTrackId !== currentId) {
		// reset state for new track (comments reset themselves — the
		// TrackComments component reloads on track.id change)
		likedStateLoadedForTrackId = null; // reset liked state tracking
		pendingSeekMs = null; // reset pending seek

		// sync track from server data
		track = data.track;

		// mark as loaded for this track
		loadedForTrackId = currentId;

	}
});

// separate effect to load liked state when auth becomes available
$effect(() => {
	const currentId = data.track?.id;
	if (!currentId || !browser) return;

	// load liked state when authenticated and haven't loaded for this track yet
	if (auth.isAuthenticated && likedStateLoadedForTrackId !== currentId) {
		likedStateLoadedForTrackId = currentId;
		void loadLikedState();
	}
});

// SSR loads anonymously, so a private (owner-only) track arrives as null. retry
// once on the client WITH the session cookie — an owner can read their own
// private track; anyone else (or logged-out) gets a real 404 → notFound.
let triedClientFetch = $state(false);
$effect(() => {
	if (track || triedClientFetch || !browser) return;
	triedClientFetch = true;
	void (async () => {
		try {
			const r = await fetch(`${API_URL}/tracks/${$page.params.id}`, {
				credentials: 'include'
			});
			if (r.ok) {
				track = await r.json();
			} else {
				notFound = true;
			}
		} catch {
			notFound = true;
		}
	})();
});

let shareUrl = $derived(`${browser ? window.location.origin : ''}/track/${track?.id ?? $page.params.id}`);

// handle ?t= timestamp param for deep linking (youtube-style)
// handle ?ref= param for share link tracking
onMount(() => {
	// deep-link seek + share-ref attribution only apply to a track we already
	// have (public tracks render server-side); private tracks are owner-only and
	// don't carry these affordances.
	if (!track) return;
	const t = $page.url.searchParams.get('t');
	if (t) {
		const seconds = parseInt(t, 10);
		if (!isNaN(seconds) && seconds >= 0) {
			pendingSeekMs = seconds * 1000;
			// load the track without auto-playing (browser blocks autoplay without interaction)
			if (track.gated) {
				void playTrack(track);
			} else {
				queue.playNow(track, false);
			}
		}
	}

	// capture ref for share link tracking
	const ref = $page.url.searchParams.get('ref');
	if (ref) {
		// store ref in player state for attribution on play
		player.setRef(ref, track.id);

		// record click event (fire-and-forget)
		fetch(`${API_URL}/tracks/${track.id}/ref/${ref}/click`, {
			method: 'POST',
			credentials: 'include'
		}).catch(() => {
			// silently ignore errors - tracking is best-effort
		});
	}
});

// perform pending seek once track is loaded and ready
$effect(() => {
	if (
		pendingSeekMs !== null &&
		track != null &&
		player.currentTrack?.id === track.id &&
		player.audioElement &&
		player.audioElement.readyState >= 1
	) {
		const seekMs = pendingSeekMs;
		pendingSeekMs = null;
		queue.seek(seekMs);
		// don't auto-play - browser policy blocks it without user interaction
		// user will click play themselves
	}
});
</script>

<svelte:head>
	{#if !track}
		<title>{APP_NAME}</title>
	{:else}
	{#if !player.currentTrack || player.currentTrack.id === track.id}
		<title>{track.title} - {track.artist}{track.album ? ` • ${track.album.title}` : ''}</title>
	{/if}
	<meta
		name="description"
		content="{track.title} by {track.artist}{track.album ? ` from ${track.album.title}` : ''} - listen on {APP_NAME}"
	/>

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="music.song" />
	<meta property="og:title" content="{track.title} - {track.artist}" />
	<meta
		property="og:description"
		content="{track.artist}{track.album ? ` • ${track.album.title}` : ''}"
	/>
	<meta
		property="og:url"
		content={`${APP_CANONICAL_URL}/track/${track.id}`}
	/>
	<meta property="og:site_name" content={APP_NAME} />
	<meta property="music:musician" content="{track.artist_handle}" />
	{#if track.album}
		<meta property="music:album" content="{track.album.title}" />
	{/if}
	<!--
		og:image cascade — track art → album art → artist avatar → brand logo.
		always emit SOMETHING so scrapers don't fall back to their own heuristics
		(favicon, first visible image, or whatever the posting client had cached).
		see: https://github.com/zzstoatzz/plyr.fm/pull/1257
	-->
	<meta property="og:image" content={previewImage} />
	<meta property="og:image:secure_url" content={previewImage} />
	{#if previewIsTrackArt}
		<meta property="og:image:width" content="1200" />
		<meta property="og:image:height" content="1200" />
	{/if}
	<meta property="og:image:alt" content="{track.title} by {track.artist}" />
	{#if track.r2_url && !isAdultLabeled}
		<meta property="og:audio" content="{track.r2_url}" />
		<meta property="og:audio:type" content="audio/{track.file_type}" />
	{/if}

	<!-- Twitter -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="{track.title}" />
	<meta
		name="twitter:description"
		content="{track.artist}{track.album ? ` • ${track.album.title}` : ''}"
	/>
	<meta name="twitter:image" content={previewImage} />

	<!-- oEmbed discovery for embed services like iframely -->
	<link
		rel="alternate"
		type="application/json+oembed"
		href="{API_URL}/oembed?url={encodeURIComponent(`${APP_CANONICAL_URL}/track/${track.id}`)}"
		title="{track.title} - {track.artist}"
	/>

	<!-- at-tags: map this page to its atproto records (https://tangled.org/chrisshank.com/at-tags/) -->
	{#if track.atproto_record_uri}
		<meta name="at:canonical" content={track.atproto_record_uri} />
	{/if}
	{#if track.artist_did}
		<meta name="at:author" content="at://{track.artist_did}" />
	{/if}
	{/if}
</svelte:head>

<div class="page-container">
	{#if !track}
		<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />
		<main>
			<div class="track-detail">
			{#if isAdultLabeled && !mayPlayAdultAudio}
				<div class="adult-content-warning" role="note">
					<strong>adult content</strong>
					<span>this audio has been labeled as sexually explicit and is hidden by default.</span>
					{#if auth.isAuthenticated}
						<a href="/settings">enable sensitive audio in settings</a>
					{:else}
						<button type="button" onclick={() => redirectToLogin()}>sign in to change this setting</button>
					{/if}
				</div>
			{/if}
				{#if notFound}
					<p class="track-missing">track not found</p>
				{:else}
					<p class="track-missing">loading…</p>
				{/if}
			</div>
		</main>
	{:else}
	{#if track.tags && track.tags.length > 0}
		<TagEffects tags={track.tags} trackTitle={track.title} />
	{/if}
	<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

	<main>
		<div class="track-detail">
			<!-- cover art (inherits from album when no per-track image is set) -->
			<SensitiveImage src={coverUrl} tooltipPosition="center">
				<div class="cover-art-container">
					{#if coverUrl}
						<img src={coverUrl} alt="{track.title} artwork" class="cover-art" />
					{:else}
						<div class="cover-art-placeholder">
							<svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
								<path d="M9 18V5l12-2v13"></path>
								<circle cx="6" cy="18" r="3"></circle>
								<circle cx="18" cy="16" r="3"></circle>
							</svg>
						</div>
					{/if}
				</div>
			</SensitiveImage>

			<!-- track info wrapper -->
			<div class="track-info-wrapper">
				<div class="track-info">
					<h1 class="track-title">
						{track.title}
						{#if isProcessing}
							<span class="processing-badge" title="still processing — playable shortly">processing</span>
						{/if}
						{#if track.gated}
							<span class="gated-badge" title="supporters only">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
									<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
								</svg>
							</span>
						{/if}
					</h1>
					<div class="track-metadata">
						<a href="/u/{track.artist_handle}" class="artist-link">
							{track.artist}
						</a>
						{#if track.features && track.features.length > 0}
							<span class="separator">•</span>
							<span class="features">
								<span class="features-label">feat.</span>
								{#each track.features as feature, i}
									{#if i > 0}<span class="feature-separator">, </span>{/if}
									<a href="/u/{feature.handle}" class="feature-link">
										{feature.display_name}
									</a>
								{/each}
							</span>
						{/if}
						{#if track.album}
							<span class="separator">•</span>
							<a href="/u/{track.artist_handle}/album/{track.album.slug}" class="album album-link">
								<svg class="album-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
									<rect x="2" y="2" width="12" height="12" stroke="currentColor" stroke-width="1.5" fill="none"/>
									<circle cx="8" cy="8" r="2.5" fill="currentColor"/>
								</svg>
								<span class="album-title-text">{track.album.title}</span>
							</a>
						{/if}
					</div>

					{#if track.tags && track.tags.length > 0}
						<div class="track-tags">
							{#each track.tags as tag}
								<a href="/tag/{encodeURIComponent(tag)}" class="tag-badge">{tag}</a>
							{/each}
						</div>
					{/if}

					<!-- controls: like · play · queue (nate's sketch, 2026-08) -->
					<div class="track-actions">
						<div class="like-chip">
							{#if auth.isAuthenticated}
								<AddToMenu
									trackId={track.id}
									trackTitle={track.title}
									trackUri={track.atproto_record_uri}
									trackCid={track.atproto_record_cid}
									fileId={track.file_id}
									gated={track.gated}
									initialLiked={track.is_liked || false}
									onLikeChange={(liked) => {
										if (track) {
											track.like_count = (track.like_count || 0) + (liked ? 1 : -1);
											track.is_liked = liked;
										}
									}}
								/>
							{:else}
								<button class="heart-static" class:shake={heartShake} onclick={nudgeSignIn} aria-label="sign in to like tracks" title="sign in to like tracks">
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
									</svg>
								</button>
							{/if}
							{#if track.like_count && track.like_count > 0}
							<span
								in:scale={{ start: 0.5, duration: reduceMotion ? 0 : 260, easing: backOut }}
								class="likes"
								role="button"
								tabindex="0"
								aria-label={`${track.like_count} ${track.like_count === 1 ? 'like' : 'likes'} (focus to view users)`}
								aria-expanded={showLikersTooltip}
								onclick={handleLikesClick}
								onmouseenter={handleLikesMouseEnter}
								onmouseleave={handleLikesMouseLeave}
								onfocus={handleLikesMouseEnter}
								onblur={handleLikesMouseLeave}
								onkeydown={handleLikesKeydown}
							>
								{#key track.like_count}
									<span class="likes-num" in:fly={{ y: 9, duration: reduceMotion ? 0 : 220 }}>{track.like_count}</span>
								{/key}
								{#if showLikersTooltip && !isMobile}
									<LikersTooltip
										trackId={track.id}
										likeCount={track.like_count}
										onMouseEnter={handleLikesMouseEnter}
										onMouseLeave={handleLikesMouseLeave}
									/>
								{/if}
							</span>
						{/if}
						</div>
						<button class="btn-play" class:playing={isCurrentlyPlaying} disabled={isProcessing} onclick={handlePlay} aria-label={isProcessing ? 'still processing — playable shortly' : isCurrentlyPlaying ? 'pause' : 'play'} title={isProcessing ? 'still processing — playable shortly' : isCurrentlyPlaying ? 'pause' : 'play'}>
							{#if isCurrentlyPlaying}
								<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
									<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>
								</svg>
							{:else}
								<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
									<path d="M8 5v14l11-7z"/>
								</svg>
							{/if}
						</button>
						<button class="btn-queue" onclick={addToQueue} aria-label="add to queue" title="add to queue">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<line x1="5" y1="15" x2="5" y2="21"></line>
								<line x1="2" y1="18" x2="8" y2="18"></line>
								<line x1="9" y1="6" x2="21" y2="6"></line>
								<line x1="9" y1="12" x2="21" y2="12"></line>
								<line x1="9" y1="18" x2="21" y2="18"></line>
							</svg>
						</button>
					</div>

					<div class="track-stats">
						<span class="plays">{track.play_count} {track.play_count === 1 ? 'listen' : 'listens'}</span>
						<LosslessBadge originalFileType={track.original_file_type} fileType={track.file_type} withSeparator separatorClass="separator" />
						{#if track.description}
							<span class="separator">•</span>
							<button
								class="metadata-toggle"
								class:open={metadataOpen}
								onclick={() => metadataOpen = !metadataOpen}
								aria-label={metadataOpen ? 'hide details' : 'show details'}
								aria-expanded={metadataOpen}
							>i</button>
						{/if}
					</div>

					{#if track.description && metadataOpen}
						<div class="metadata-panel" transition:slide={{ duration: 200 }}>
							<p class="metadata-description"><RichText text={track.description} /></p>
						</div>
					{/if}

					<div class="side-buttons">
						<ShareButton url={shareUrl} title="share track" trackId={track.id} />
						{#if track.downloadable}
							<DownloadButton
								onDownload={() =>
									track &&
									requestTrackDownload(track.file_id, {
										artistName: track.artist,
										artistDid: track.artist_did,
										policy: track.download_policy,
										supportUrl: track.artist_support_url
									})}
							/>
						{/if}
						<TrackComments {track} />
					</div>
				</div>
			</div>
		</div>


	</main>
	{/if}
</div>

<style>
	.track-missing {
		text-align: center;
		color: var(--text-muted);
		padding: 4rem 1rem;
		font-size: var(--text-lg);
	}

	.page-container {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		/* the page is a single composition now (comments live in the panel):
		   center it in the available height rather than top-anchoring it over
		   a void — the apple now-playing posture */
		justify-content: center;
		padding: 2rem;
		padding-bottom: calc(var(--player-height, 0px) + 2rem);
		width: 100%;
	}

	.track-detail {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2rem;
		width: 100%;
		max-width: 1200px;
	}

	.cover-art-container {
		width: 100%;
		/* spare vertical room becomes artwork, not void: scale with viewport
		   height, bounded for short windows and very large screens */
		max-width: clamp(260px, 38dvh, 480px);
		aspect-ratio: 1;
		border-radius: var(--radius-md);
		overflow: hidden;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
	}

	.cover-art {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.cover-art-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		color: var(--text-muted);
	}

	.track-info-wrapper {
		width: 100%;
		max-width: min(900px, 90%);
		display: flex;
		align-items: flex-start;
		justify-content: center;
	}

	.track-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: clamp(1rem, 2vh, 1.5rem);
		text-align: center;
	}

	.track-title {
		font-size: 2rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
		line-height: 1.2;
		text-align: center;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.gated-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--accent);
		opacity: 0.8;
	}

	.gated-badge svg {
		display: block;
	}

	.track-metadata {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		color: var(--text-secondary);
		font-size: var(--text-xl);
	}

	.separator {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.artist-link {
		color: var(--text-secondary);
		text-decoration: none;
		font-weight: 500;
		transition: color 0.2s;
	}

	.artist-link:hover {
		color: var(--accent);
	}

	.features {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
	}

	.features-label {
		color: var(--accent-hover);
		font-weight: 500;
	}

	.feature-link {
		color: var(--accent-hover);
		text-decoration: none;
		font-weight: 500;
		transition: color 0.2s;
	}

	.feature-link:hover {
		color: var(--accent);
		text-decoration: underline;
	}

	.feature-separator {
		color: var(--accent-hover);
	}

	.album {
		color: var(--text-tertiary);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		max-width: fit-content;
	}

	.album-link {
		text-decoration: none;
		color: var(--text-tertiary);
		transition: color 0.2s;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.album-link:hover {
		color: var(--accent);
	}

	.album-title-text {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.album-icon {
		width: 16px;
		height: 16px;
		opacity: 0.7;
		flex-shrink: 0;
	}

	.track-stats {
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: center;
	}

	.track-stats .separator {
		font-size: var(--text-xs);
	}

	.like-chip {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--text-tertiary);
		font-size: var(--text-base);
	}

	.heart-static {
		display: flex;
		align-items: center;
		background: transparent;
		border: none;
		padding: 0;
		color: inherit;
		cursor: pointer;
	}

	.heart-static.shake {
		animation: head-shake 0.5s ease-in-out;
	}

	@keyframes head-shake {
		0%, 100% { transform: translateX(0); }
		20% { transform: translateX(-4px); }
		40% { transform: translateX(4px); }
		60% { transform: translateX(-3px); }
		80% { transform: translateX(3px); }
	}

	@media (prefers-reduced-motion: reduce) {
		.heart-static.shake {
			animation: none;
		}
	}

	/* the AddToMenu trigger is a bordered box on dense surfaces; on this
	   page's controls line it goes quiet like the queue and utility icons */
	.like-chip :global(.trigger-button) {
		width: auto;
		height: auto;
		padding: 0.5rem;
		border: none;
		background: transparent;
		border-radius: var(--radius-full);
	}

	/* one heartbeat when the heart turns liked — a tad, no more */
	.like-chip :global(.trigger-button.liked svg) {
		animation: heart-beat 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	@keyframes heart-beat {
		0% { transform: scale(1); }
		35% { transform: scale(1.35); }
		65% { transform: scale(0.92); }
		100% { transform: scale(1); }
	}

	.likes-num {
		display: inline-block;
		font-variant-numeric: tabular-nums;
	}

	@media (prefers-reduced-motion: reduce) {
		.like-chip :global(.trigger-button.liked svg) {
			animation: none;
		}
	}

	.like-chip :global(.trigger-button:hover),
	.like-chip :global(.trigger-button.menu-open) {
		border: none;
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}

	.like-chip .likes {
		position: relative;
		cursor: pointer;
		padding: 0.125rem 0.25rem;
		margin: -0.125rem -0.25rem;
		border-radius: var(--radius-sm);
		transition: background 0.15s, color 0.15s;
	}

	.like-chip .likes:hover,
	.like-chip .likes:focus {
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		color: var(--accent);
		outline: none;
	}

	.metadata-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 50%;
		border: 1px solid var(--text-tertiary);
		color: var(--text-tertiary);
		font-size: 0.65rem;
		font-weight: 600;
		cursor: pointer;
		background: none;
		font-family: inherit;
		line-height: 1;
		transition: color 0.15s, border-color 0.15s;
		padding: 0;
	}

	.metadata-toggle:hover,
	.metadata-toggle.open {
		color: var(--accent);
		border-color: var(--accent);
	}

	.metadata-panel {
		margin-top: 0.75rem;
		padding: 0.75rem 0;
		border-top: 1px solid var(--border-subtle);
		text-align: left;
	}

	.metadata-description {
		color: var(--text-secondary);
		font-size: var(--text-base);
		line-height: 1.6;
		margin: 0;
		white-space: pre-wrap;
		word-wrap: break-word;
		overflow-wrap: break-word;
	}

	.track-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: center;
	}

	.tag-badge {
		display: inline-block;
		padding: 0.25rem 0.6rem;
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		color: var(--accent-hover);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		font-weight: 500;
		text-decoration: none;
		transition: all 0.15s;
	}

	.tag-badge:hover {
		background: color-mix(in srgb, var(--accent) 25%, transparent);
		color: var(--accent-hover);
	}

	.side-buttons {
		display: flex;
		gap: clamp(0.75rem, 4vw, 1.5rem);
		justify-content: center;
		align-items: center;
	}

	.side-buttons :global(.share-btn),
	.side-buttons :global(.download-btn) {
		width: auto;
		height: auto;
		padding: 0.5rem;
		border: none;
		background: transparent;
		border-radius: var(--radius-full);
	}

	.side-buttons :global(.share-btn:hover),
	.side-buttons :global(.download-btn:hover) {
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}

	.side-buttons :global(.share-btn svg) {
		width: 18px;
		height: 18px;
	}

	.side-buttons :global(.download-btn svg) {
		width: 17px;
		height: 17px;
	}

	.track-actions {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		column-gap: clamp(1.25rem, 6vw, 2.5rem);
		align-items: center;
		/* the zone break between identity and action — deliberately larger
		   than the uniform row gap, and scaling with the viewport */
		margin-top: clamp(0.75rem, 3vh, 2rem);
	}

	.track-actions .like-chip {
		justify-self: end;
	}

	.track-actions .btn-queue {
		justify-self: start;
	}

	.btn-play:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.processing-badge {
		display: inline-block;
		vertical-align: middle;
		margin-left: 0.5rem;
		padding: 0.1rem 0.5rem;
		font-size: 0.7rem;
		font-weight: 500;
		letter-spacing: 0.02em;
		color: var(--text-muted);
		background: var(--bg-tertiary);
		border-radius: var(--radius-full, 999px);
	}

	.btn-play {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 3rem;
		height: 3rem;
		padding: 0;
		background: var(--accent);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-full, 50%);
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-play svg {
		width: 26px;
		height: 26px;
	}

	.btn-play svg {
		margin-left: 2px; /* optically center the triangle */
	}

	.btn-play.playing svg {
		margin-left: 0;
	}

	.btn-play:hover {
		transform: scale(1.05);
		box-shadow: 0 4px 16px rgba(138, 179, 255, 0.4);
	}

	/* press feedback, matching the footer player's play-pause :active */
	.btn-play:active {
		transform: scale(0.94);
		transition-duration: 0.06s;
	}

	@media (prefers-reduced-motion: reduce) {
		.btn-play:hover,
		.btn-play:active {
			transform: none;
		}
	}

	.btn-play.playing {
		animation: ethereal-glow 3s ease-in-out infinite;
	}

	.btn-queue {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		background: transparent;
		color: var(--text-tertiary);
		border: none;
		border-radius: var(--radius-full, 50%);
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-queue svg {
		width: 20px;
		height: 20px;
	}

	.btn-queue:hover {
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}

	@media (max-width: 768px) {
		main {
			padding: 0.75rem;
			padding-bottom: calc(var(--player-height, 10rem) + env(safe-area-inset-bottom, 0px));
			align-items: flex-start;
			justify-content: flex-start;
		}

		.track-detail {
			padding: 0;
			gap: 1rem;
			max-width: 100%;
		}

		/* height-aware like desktop: the artwork gives way before the
		   share/download row falls past the fold */
		.cover-art-container {
			max-width: min(60%, 22dvh);
			margin: 0 auto;
		}

		.track-info-wrapper {
			flex-direction: column;
			align-items: center;
			gap: 0.75rem;
		}

		.track-info {
			gap: 0.75rem;
			width: 100%;
		}

		.track-title {
			font-size: var(--text-3xl);
		}

		.track-metadata {
			font-size: var(--text-base);
			gap: 0.5rem;
		}

		.track-stats {
			font-size: var(--text-sm);
		}

		/* use the width: controls and utilities share one measure and spread
		   across it, columns loosely aligned — the rows read as one grouped
		   control surface instead of a pinched center cluster */
		.track-actions {
			margin-top: 0.25rem;
			width: min(100%, 20rem);
			margin-inline: auto;
		}

		.track-actions .like-chip {
			justify-self: center;
		}

		.track-actions .btn-queue {
			justify-self: center;
		}

		.side-buttons {
			width: min(100%, 20rem);
			margin-inline: auto;
			justify-content: space-evenly;
			gap: 0;
		}

		/* touch-first: every control clears the 44px tap-target floor,
		   and play grows past its desktop size — thumbs, not pointers */
		.btn-play {
			width: 3.5rem;
			height: 3.5rem;
		}

		.btn-play svg {
			width: 28px;
			height: 28px;
		}

		.btn-queue {
			padding: 0.75rem;
		}

		.btn-queue svg {
			width: 22px;
			height: 22px;
		}

		.like-chip :global(.trigger-button) {
			padding: 0.75rem;
		}

		.like-chip :global(.trigger-button svg) {
			width: 20px;
			height: 20px;
		}

		.heart-static {
			padding: 0.75rem;
		}

		.heart-static svg {
			width: 20px;
			height: 20px;
		}

		.like-chip {
			font-size: var(--text-lg);
		}

		.side-buttons :global(.share-btn),
		.side-buttons :global(.download-btn) {
			padding: 0.75rem;
		}

		.side-buttons :global(.share-btn svg) {
			width: 21px;
			height: 21px;
		}

		.side-buttons :global(.download-btn svg) {
			width: 20px;
			height: 20px;
		}
	}

	/* comments section */

	.adult-content-warning {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
		padding: 0.8rem 1rem;
		border: 1px solid var(--border-emphasis);
		border-radius: var(--radius-md);
		background: var(--bg-secondary);
		color: var(--text-secondary);
	}

	.adult-content-warning strong {
		color: var(--text-primary);
		text-transform: lowercase;
	}

	.adult-content-warning a,
	.adult-content-warning button {
		margin-left: auto;
		border: 0;
		background: none;
		color: var(--accent);
		font: inherit;
		cursor: pointer;
		text-decoration: underline;
	}
</style>
