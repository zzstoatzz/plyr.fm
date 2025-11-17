<script lang="ts">
	import { goto } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';
	import TrackItem from '$lib/components/TrackItem.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { toast } from '$lib/toast.svelte';
	import { auth } from '$lib/auth.svelte';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const album = $derived(data.album);
	const isAuthenticated = $derived(auth.isAuthenticated);

	function playTrack(track: typeof album.tracks[0]) {
		queue.playNow(track);
	}

	function playNow() {
		if (album.tracks.length > 0) {
			queue.setQueue(album.tracks);
			queue.playNow(album.tracks[0]);
			toast.success(`playing ${album.metadata.title}`, 1800);
		}
	}

	function addToQueue() {
		if (album.tracks.length > 0) {
			queue.addTracks(album.tracks);
			toast.success(`added ${album.metadata.title} to queue`, 1800);
		}
	}

	let shareUrl = $state('');

	$effect(() => {
		if (typeof window !== 'undefined') {
			shareUrl = `${window.location.origin}/u/${album.metadata.artist_handle}/album/${album.metadata.slug}`;
		}
	});
</script>

<svelte:head>
	<title>{album.metadata.title} by {album.metadata.artist} - plyr.fm</title>
	<meta name="description" content="{album.metadata.title} by {album.metadata.artist} - {album.metadata.track_count} tracks on plyr.fm" />

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="music.album" />
	<meta property="og:title" content="{album.metadata.title} by {album.metadata.artist}" />
	<meta property="og:description" content="{album.metadata.track_count} tracks • {album.metadata.total_plays} plays" />
	<meta property="og:url" content="{APP_CANONICAL_URL}/u/{album.metadata.artist_handle}/album/{album.metadata.slug}" />
	<meta property="og:site_name" content={APP_NAME} />
	<meta property="music:musician" content="{album.metadata.artist_handle}" />
	{#if album.metadata.image_url}
		<meta property="og:image" content="{album.metadata.image_url}" />
		<meta property="og:image:secure_url" content="{album.metadata.image_url}" />
		<meta property="og:image:width" content="1200" />
		<meta property="og:image:height" content="1200" />
		<meta property="og:image:alt" content="{album.metadata.title} by {album.metadata.artist}" />
	{/if}

	<!-- Twitter -->
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content="{album.metadata.title} by {album.metadata.artist}" />
	<meta name="twitter:description" content="{album.metadata.track_count} tracks • {album.metadata.total_plays} plays" />
	{#if album.metadata.image_url}
		<meta name="twitter:image" content="{album.metadata.image_url}" />
	{/if}
</svelte:head>

<div class="container">
	<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={() => goto('/login')} />
	<main>
		<div class="album-hero">
			{#if album.metadata.image_url}
				<img src={album.metadata.image_url} alt="{album.metadata.title} artwork" class="album-art" />
			{:else}
				<div class="album-art-placeholder">
					<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<rect x="3" y="3" width="18" height="18" stroke="currentColor" stroke-width="1.5" fill="none"/>
						<circle cx="12" cy="12" r="4" fill="currentColor"/>
					</svg>
				</div>
			{/if}
			<div class="album-info-wrapper">
				<div class="album-info">
					<p class="album-type">album</p>
					<h1 class="album-title">{album.metadata.title}</h1>
					<div class="album-meta">
						<a href="/u/{album.metadata.artist_handle}" class="artist-link">
							{album.metadata.artist}
						</a>
						<span class="meta-separator">•</span>
						<span>{album.metadata.track_count} {album.metadata.track_count === 1 ? 'track' : 'tracks'}</span>
						<span class="meta-separator">•</span>
						<span>{album.metadata.total_plays} {album.metadata.total_plays === 1 ? 'play' : 'plays'}</span>
					</div>
				</div>

				<div class="side-button-right">
					<ShareButton url={shareUrl} title="share album" />
				</div>
			</div>
		</div>

		<div class="album-actions">
			<button class="play-button" onclick={playNow}>
				<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
					<path d="M8 5v14l11-7z"/>
				</svg>
				play now
			</button>
			<button class="queue-button" onclick={addToQueue}>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					<line x1="5" y1="15" x2="5" y2="21"></line>
					<line x1="2" y1="18" x2="8" y2="18"></line>
					<line x1="9" y1="6" x2="21" y2="6"></line>
					<line x1="9" y1="12" x2="21" y2="12"></line>
					<line x1="9" y1="18" x2="21" y2="18"></line>
				</svg>
				add to queue
			</button>
			<div class="mobile-share-button">
				<ShareButton url={shareUrl} title="share album" />
			</div>
		</div>

		<div class="tracks-section">
			<h2 class="section-heading">tracks</h2>
			<div class="tracks-list">
				{#each album.tracks as track, i}
					<TrackItem
						{track}
						index={i}
						isPlaying={player.currentTrack?.id === track.id}
						onPlay={playTrack}
						{isAuthenticated}
						hideAlbum={true}
						hideArtist={true}
					/>
				{/each}
			</div>
		</div>
	</main>
</div>

<style>
	.container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 1rem calc(var(--player-height, 120px) + 2rem + env(safe-area-inset-bottom, 0px)) 1rem;
	}

	.tracks-section {
		padding-bottom: calc(var(--player-height, 120px) + env(safe-area-inset-bottom, 0px));
	}

	main {
		margin-top: 2rem;
	}

	.album-hero {
		display: flex;
		gap: 2rem;
		margin-bottom: 2rem;
		align-items: flex-end;
	}

	.album-art {
		width: 200px;
		height: 200px;
		border-radius: 8px;
		object-fit: cover;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	.album-art-placeholder {
		width: 200px;
		height: 200px;
		border-radius: 8px;
		background: #1a1a1a;
		border: 1px solid #282828;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #606060;
	}

	.album-info-wrapper {
		flex: 1;
		display: flex;
		align-items: flex-end;
		gap: 1rem;
	}

	.album-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.side-button-right {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding-bottom: 0.5rem;
	}

	.mobile-share-button {
		display: none;
	}

	.album-type {
		text-transform: uppercase;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		color: #808080;
		margin: 0;
	}

	.album-title {
		font-size: 3rem;
		font-weight: 700;
		margin: 0;
		color: #ffffff;
		line-height: 1.1;
		word-wrap: break-word;
		overflow-wrap: break-word;
		hyphens: auto;
	}

	.album-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.95rem;
		color: #b0b0b0;
	}

	.artist-link {
		color: #b0b0b0;
		text-decoration: none;
		font-weight: 600;
		transition: color 0.2s;
	}

	.artist-link:hover {
		color: var(--accent);
	}

	.meta-separator {
		color: #555;
		font-size: 0.7rem;
	}

	.album-actions {
		display: flex;
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.play-button,
	.queue-button {
		padding: 0.75rem 1.5rem;
		border-radius: 24px;
		font-weight: 600;
		font-size: 0.95rem;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border: none;
	}

	.play-button {
		background: var(--accent);
		color: #000;
	}

	.play-button:hover {
		transform: scale(1.05);
	}

	.queue-button {
		background: transparent;
		color: #e8e8e8;
		border: 1px solid #333;
	}

	.queue-button:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.tracks-section {
		margin-top: 2rem;
	}

	.section-heading {
		font-size: 1.25rem;
		font-weight: 600;
		color: #e8e8e8;
		margin-bottom: 1rem;
		text-transform: lowercase;
	}

	.tracks-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	@media (max-width: 768px) {
		.album-hero {
			flex-direction: column;
			align-items: flex-start;
			gap: 1.5rem;
		}

		.album-art,
		.album-art-placeholder {
			width: 160px;
			height: 160px;
		}

		.album-info-wrapper {
			flex-direction: column;
			align-items: flex-start;
			width: 100%;
		}

		.side-button-right {
			display: none;
		}

		.mobile-share-button {
			display: flex;
			width: 100%;
			justify-content: center;
		}

		.album-title {
			font-size: 2rem;
		}

		.album-meta {
			font-size: 0.85rem;
		}

		.album-actions {
			flex-direction: column;
			gap: 0.75rem;
			width: 100%;
		}

		.play-button,
		.queue-button {
			width: 100%;
			justify-content: center;
		}
	}

	@media (max-width: 480px) {
		.container {
			padding: 0 0.75rem 6rem 0.75rem;
		}

		.album-art,
		.album-art-placeholder {
			width: 140px;
			height: 140px;
		}

		.album-title {
			font-size: 1.75rem;
		}

		.album-meta {
			font-size: 0.8rem;
			flex-wrap: wrap;
		}
	}
</style>
