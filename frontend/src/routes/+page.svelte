<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import TrackItem from '$lib/components/TrackItem.svelte';
	import Header from '$lib/components/Header.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import HiddenTagsFilter from '$lib/components/HiddenTagsFilter.svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { tracksCache } from '$lib/tracks.svelte';
	import { auth } from '$lib/auth.svelte';
	import { APP_NAME, APP_TAGLINE, APP_CANONICAL_URL } from '$lib/branding';

	// use cached tracks
	let tracks = $derived(tracksCache.tracks);
	let loadingTracks = $derived(tracksCache.loading);
	let hasTracks = $derived(tracks.length > 0);
	let initialLoad = $state(true);

	// show loading during initial load or when actively loading with no cached data
	let showLoading = $derived((initialLoad && !hasTracks) || (loadingTracks && !hasTracks));

	// track which track ID we've already auto-played to prevent infinite loops
	let autoPlayedTrackId = $state<string | null>(null);

	onMount(async () => {
		// fetch tracks from cache (will use cached data if recent)
		await tracksCache.fetch();
		initialLoad = false;
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
			<HiddenTagsFilter />
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
		{/if}
	</section>
</main>

<style>
	.loading-container {
		display: flex;
		justify-content: center;
		padding: 3rem 2rem;
	}

	main {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 1rem calc(var(--player-height, 120px) + env(safe-area-inset-bottom, 0px));
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.tracks h2 {
		font-size: var(--text-page-heading);
		margin: 0;
		color: var(--text-primary);
	}

	.clickable-heading {
		background: transparent;
		border: none;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
		transition: color 0.2s;
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
</style>
