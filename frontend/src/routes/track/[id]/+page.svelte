<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import { API_URL } from '$lib/config';
	import Header from '$lib/components/Header.svelte';
	import LikeButton from '$lib/components/LikeButton.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { auth } from '$lib/auth.svelte';
	import type { Track } from '$lib/types';

	// receive server-loaded data
	let { data }: { data: PageData } = $props();

	let track = $state<Track>(data.track);

	// reactive check if this track is currently playing
	let isCurrentlyPlaying = $derived(
		player.currentTrack?.id === track.id && !player.paused
	);

	async function loadLikedState() {
		const sessionId = auth.getSessionId();
		if (!sessionId) return;

		try {
			const response = await fetch(`${API_URL}/tracks/${track.id}`, {
				headers: {
					'Authorization': `Bearer ${sessionId}`
				}
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

	function handlePlay() {
		if (isCurrentlyPlaying) {
			player.togglePlayPause();
		} else {
			queue.playNow(track);
		}
	}

	function addToQueue() {
		queue.addTracks([track]);
	}

onMount(async () => {
	if (auth.isAuthenticated) {
		await loadLikedState();
	}
});

let shareUrl = '';

$effect(() => {
	if (typeof window !== 'undefined') {
		shareUrl = `${window.location.origin}/track/${track.id}`;
	}
});
</script>

<svelte:head>
	<title>{track.title} - {track.artist}{track.album ? ` • ${track.album.title}` : ''}</title>
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
	{#if track.image_url}
		<meta property="og:image" content="{track.image_url}" />
		<meta property="og:image:secure_url" content="{track.image_url}" />
		<meta property="og:image:width" content="1200" />
		<meta property="og:image:height" content="1200" />
		<meta property="og:image:alt" content="{track.title} by {track.artist}" />
	{/if}
	{#if track.r2_url}
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
	{#if track.image_url}
		<meta name="twitter:image" content="{track.image_url}" />
	{/if}
</svelte:head>

<div class="page-container">
	<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

	<main>
		<div class="track-detail">
			<!-- cover art -->
			<div class="cover-art-container">
				{#if track.image_url}
					<img src={track.image_url} alt="{track.title} artwork" class="cover-art" />
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

			<!-- track info wrapper -->
			<div class="track-info-wrapper">
				<div class="side-button-left">
					{#if auth.isAuthenticated}
						<LikeButton trackId={track.id} trackTitle={track.title} initialLiked={track.is_liked || false} />
					{/if}
				</div>

				<div class="track-info">
					<h1 class="track-title">{track.title}</h1>
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

					<div class="track-stats">
						<span class="plays">{track.play_count} {track.play_count === 1 ? 'play' : 'plays'}</span>
						{#if track.like_count && track.like_count > 0}
							<span class="separator">•</span>
							<span class="likes">{track.like_count} {track.like_count === 1 ? 'like' : 'likes'}</span>
						{/if}
					</div>

					<div class="mobile-side-buttons">
						{#if auth.isAuthenticated}
							<LikeButton trackId={track.id} trackTitle={track.title} initialLiked={track.is_liked || false} />
						{/if}
						<ShareButton url={shareUrl} />
					</div>

					<!-- actions -->
					<div class="track-actions">
						<button class="btn-play" class:playing={isCurrentlyPlaying} onclick={handlePlay}>
							{#if isCurrentlyPlaying}
								<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
									<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>
								</svg>
								pause
							{:else}
								<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
									<path d="M8 5v14l11-7z"/>
								</svg>
								play
							{/if}
						</button>
						<button class="btn-queue" onclick={addToQueue}>
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<line x1="5" y1="15" x2="5" y2="21"></line>
								<line x1="2" y1="18" x2="8" y2="18"></line>
								<line x1="9" y1="6" x2="21" y2="6"></line>
								<line x1="9" y1="12" x2="21" y2="12"></line>
								<line x1="9" y1="18" x2="21" y2="18"></line>
							</svg>
							add to queue
						</button>
					</div>
				</div>

				<div class="side-button-right">
					<ShareButton url={shareUrl} />
				</div>
			</div>
		</div>
	</main>
</div>

<style>
	.page-container {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	main {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		padding-bottom: 8rem;
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
		max-width: 300px;
		aspect-ratio: 1;
		border-radius: 8px;
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
		background: #1a1a1a;
		border: 1px solid #282828;
		color: #606060;
	}

	.track-info-wrapper {
		width: 100%;
		max-width: 600px;
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		justify-content: center;
	}

	.side-button-left,
	.side-button-right {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding-top: 0.5rem;
	}

	.track-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		text-align: center;
	}

	.track-title {
		font-size: 2rem;
		font-weight: 700;
		color: #e8e8e8;
		margin: 0;
		line-height: 1.2;
		text-align: center;
	}

	.track-metadata {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		color: #b0b0b0;
		font-size: 1.1rem;
	}

	.separator {
		color: #555;
		font-size: 0.8rem;
	}

	.artist-link {
		color: #b0b0b0;
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
		color: #8ab3ff;
		font-weight: 500;
	}

	.feature-link {
		color: #8ab3ff;
		text-decoration: none;
		font-weight: 500;
		transition: color 0.2s;
	}

	.feature-link:hover {
		color: var(--accent);
		text-decoration: underline;
	}

	.feature-separator {
		color: #8ab3ff;
	}

	.album {
		color: #909090;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		max-width: fit-content;
	}

	.album-link {
		text-decoration: none;
		color: #909090;
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
		color: #808080;
		font-size: 0.95rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: center;
	}

	.track-stats .separator {
		font-size: 0.7rem;
	}

	.mobile-side-buttons {
		display: none;
		gap: 0.75rem;
		justify-content: center;
		align-items: center;
	}

	.track-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: center;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 0.5rem;
	}

	.btn-play {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		background: var(--accent);
		color: #000;
		border: none;
		border-radius: 24px;
		font-size: 0.95rem;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-play:hover {
		transform: scale(1.05);
		box-shadow: 0 4px 16px rgba(138, 179, 255, 0.4);
	}

	.btn-play.playing {
		opacity: 0.8;
	}

	.btn-queue {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		background: transparent;
		color: #e8e8e8;
		border: 1px solid #404040;
		border-radius: 24px;
		font-size: 0.95rem;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-queue:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: rgba(138, 179, 255, 0.1);
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

		.cover-art-container {
			max-width: 60%;
			margin: 0 auto;
		}

		.track-info-wrapper {
			flex-direction: column;
			align-items: center;
			gap: 0.75rem;
		}

		.side-button-left,
		.side-button-right {
			display: none;
		}

		.mobile-side-buttons {
			display: flex;
		}

		.track-info {
			gap: 0.75rem;
			width: 100%;
		}

		.track-title {
			font-size: 1.5rem;
		}

		.track-metadata {
			font-size: 0.9rem;
			gap: 0.5rem;
		}

		.track-stats {
			font-size: 0.85rem;
		}

		.track-actions {
			flex-direction: row;
			flex-wrap: wrap;
			width: 100%;
			gap: 0.5rem;
			margin-top: 0.25rem;
			justify-content: center;
		}

		.btn-play {
			flex: 1;
			min-width: calc(50% - 0.25rem);
			justify-content: center;
			padding: 0.6rem 1rem;
			font-size: 0.9rem;
		}

		.btn-play svg {
			width: 20px;
			height: 20px;
		}

		.btn-queue {
			flex: 1;
			min-width: calc(50% - 0.25rem);
			justify-content: center;
			padding: 0.6rem 1rem;
			font-size: 0.9rem;
		}

		.btn-queue svg {
			width: 18px;
			height: 18px;
		}
	}
</style>
