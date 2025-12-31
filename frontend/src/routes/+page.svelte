<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import TrackItem from '$lib/components/TrackItem.svelte';
	import Header from '$lib/components/Header.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import HiddenTagsFilter from '$lib/components/HiddenTagsFilter.svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { tracksCache, fetchTopTracks } from '$lib/tracks.svelte';
	import type { Track } from '$lib/types';
	import { auth } from '$lib/auth.svelte';
	import { APP_NAME, APP_TAGLINE, APP_CANONICAL_URL } from '$lib/branding';

	// use cached tracks
	let tracks = $derived(tracksCache.tracks);
	let loadingTracks = $derived(tracksCache.loading);
	let loadingMore = $derived(tracksCache.loadingMore);
	let hasMore = $derived(tracksCache.hasMore);
	let hasTracks = $derived(tracks.length > 0);
	let initialLoad = $state(true);

	// top tracks (most liked)
	let topTracks = $state<Track[]>([]);
	let loadingTopTracks = $state(true);
	let hasTopTracks = $derived(topTracks.length > 0);

	// show loading during initial load or when actively loading with no cached data
	let showLoading = $derived((initialLoad && !hasTracks) || (loadingTracks && !hasTracks));

	// track which track ID we've already auto-played to prevent infinite loops
	let autoPlayedTrackId = $state<string | null>(null);

	// infinite scroll sentinel element
	let sentinelElement = $state<HTMLDivElement | null>(null);

	onMount(async () => {
		// fetch top tracks and latest tracks concurrently
		const [topResult] = await Promise.all([
			fetchTopTracks(10),
			tracksCache.fetch()
		]);
		topTracks = topResult;
		loadingTopTracks = false;
		initialLoad = false;
	});

	// set up IntersectionObserver for infinite scroll
	$effect(() => {
		if (!sentinelElement) return;

		const observer = new IntersectionObserver(
			(entries) => {
				const entry = entries[0];
				if (entry.isIntersecting && hasMore && !loadingMore && !loadingTracks) {
					tracksCache.fetchMore();
				}
			},
			{
				rootMargin: '200px' // trigger 200px before reaching the end
			}
		);

		observer.observe(sentinelElement);

		return () => {
			observer.disconnect();
		};
	});

	// reactive effect to auto-play track from URL query param
	$effect(() => {
		const trackId = $page.url.searchParams.get('track');
		// only auto-play if we have a track ID, tracks are loaded, and we haven't already played this track
		if (trackId && tracks.length > 0 && trackId !== autoPlayedTrackId) {
			const track = tracks.find(t => t.id === parseInt(trackId));
			if (track) {
				queue.playNow(track);
				autoPlayedTrackId = trackId; // mark as played to prevent re-triggering
			}
		}
	});

	async function logout() {
		await auth.logout();
		window.location.href = '/';
	}

	async function refreshTracks() {
		await tracksCache.fetch(true); // force refresh
	}
</script>

<svelte:head>
	<title>{APP_NAME} - {APP_TAGLINE}</title>
	<meta name="description" content="discover and stream music on the atproto network" />

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="website" />
	<meta property="og:title" content={APP_NAME} />
	<meta property="og:description" content={APP_TAGLINE} />
	<meta property="og:url" content={APP_CANONICAL_URL} />
	<meta property="og:site_name" content={APP_NAME} />

	<!-- Twitter -->
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={APP_NAME} />
	<meta name="twitter:description" content={APP_TAGLINE} />
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={logout} />

<main>
	<!-- most liked section -->
	{#if loadingTopTracks}
		<section class="top-tracks">
			<h2>top tracks</h2>
			<div class="loading-container compact">
				<WaveLoading size="sm" message="loading..." />
			</div>
		</section>
	{:else if hasTopTracks}
		<section class="top-tracks">
			<h2>top tracks</h2>
			<div class="track-list">
				{#each topTracks as track, i}
					<TrackItem
						{track}
						index={i}
						isPlaying={player.currentTrack?.id === track.id}
						onPlay={(t) => queue.playNow(t)}
						isAuthenticated={auth.isAuthenticated}
					/>
				{/each}
			</div>
		</section>
	{/if}

	<section class="tracks">
		<div class="section-header">
			<h2>
				<button
					type="button"
					class="clickable-heading"
					onclick={refreshTracks}
					onkeydown={(event) => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault();
							refreshTracks();
						}
					}}
					title="click to refresh"
				>
					latest tracks
				</button>
			</h2>
			<div class="header-actions">
				<HiddenTagsFilter />
			</div>
		</div>
		{#if showLoading}
			<div class="loading-container">
				<WaveLoading size="lg" message="loading tracks..." />
			</div>
		{:else if !hasTracks}
			<p class="empty">no tracks yet</p>
		{:else}
			<div class="track-list">
				{#each tracks as track, i}
					<TrackItem
						{track}
						index={i}
						isPlaying={player.currentTrack?.id === track.id}
						onPlay={(t) => queue.playNow(t)}
						isAuthenticated={auth.isAuthenticated}
					/>
				{/each}
			</div>
			<!-- infinite scroll sentinel -->
			{#if hasMore}
				<div bind:this={sentinelElement} class="scroll-sentinel">
					{#if loadingMore}
						<WaveLoading size="sm" message="loading more..." />
					{/if}
				</div>
			{/if}
		{/if}
	</section>
</main>

<style>
	.loading-container {
		display: flex;
		justify-content: center;
		padding: 3rem 2rem;
	}

	.loading-container.compact {
		padding: 1.5rem 1rem;
	}

	.top-tracks {
		margin-bottom: 2.5rem;
	}

	.top-tracks h2 {
		font-size: var(--text-page-heading);
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 1.5rem 0;
	}

	main {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 1rem calc(var(--player-height, 0px) + 2rem + env(safe-area-inset-bottom, 0px));
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.section-header h2 {
		font-size: var(--text-page-heading);
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.clickable-heading {
		background: transparent;
		border: none;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
		transition: color 0.15s;
		user-select: none;
	}

	.clickable-heading:hover {
		color: var(--accent);
	}

	.empty {
		color: var(--text-tertiary);
		padding: 2rem;
		text-align: center;
	}

	.track-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.scroll-sentinel {
		display: flex;
		justify-content: center;
		padding: 2rem 0;
		min-height: 60px;
	}

	@media (max-width: 768px) {
		main {
			padding: 0 0.75rem calc(var(--player-height, 0px) + 1.25rem + env(safe-area-inset-bottom, 0px));
		}

		.section-header h2,
		.top-tracks h2 {
			font-size: var(--text-2xl);
		}
	}
</style>
