<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import TrackItem from '$lib/components/TrackItem.svelte';
	import TrackCard from '$lib/components/TrackCard.svelte';
	import ActivityCard from '$lib/components/ActivityCard.svelte';
	import Header from '$lib/components/Header.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import HiddenTagsFilter from '$lib/components/HiddenTagsFilter.svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { tracksCache, fetchTopTracks } from '$lib/tracks.svelte';
	import { networkArtistsCache } from '$lib/network-artists.svelte';
	import { dismissedSections } from '$lib/dismissed-sections.svelte';
	import { API_URL } from '$lib/config';
	import type { Track, ActivityEvent } from '$lib/types';
	import { auth } from '$lib/auth.svelte';
	import { fade } from 'svelte/transition';
	import { APP_NAME, APP_TAGLINE, APP_CANONICAL_URL } from '$lib/branding';
	import {
		getRefreshedAvatar,
		triggerAvatarRefresh,
		hasAttemptedRefresh
	} from '$lib/avatar-refresh.svelte';

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

	// recent activity
	let activityEvents = $state<ActivityEvent[]>([]);
	let loadingActivity = $state(true);
	let hasActivity = $derived(activityEvents.length > 0);

	// network artists (people you follow on bluesky who have music here)
	let networkArtists = $derived(networkArtistsCache.artists);
	let hasNetworkArtists = $derived(networkArtistsCache.hasArtists);

	// show loading during initial load or when actively loading with no cached data
	let showLoading = $derived((initialLoad && !hasTracks) || (loadingTracks && !hasTracks));

	// track which track ID we've already auto-played to prevent infinite loops
	let autoPlayedTrackId = $state<string | null>(null);

	// infinite scroll sentinel element
	let sentinelElement = $state<HTMLDivElement | null>(null);

	onMount(async () => {
		const [topResult, , activityResult] = await Promise.all([
			fetchTopTracks(10),
			tracksCache.fetch(),
			fetchActivity()
		]);
		topTracks = topResult;
		loadingTopTracks = false;
		activityEvents = activityResult;
		loadingActivity = false;
		initialLoad = false;
	});

	async function fetchActivity(): Promise<ActivityEvent[]> {
		try {
			const res = await fetch(`${API_URL}/activity/?limit=10`);
			if (!res.ok) return [];
			return (await res.json()).events ?? [];
		} catch {
			return [];
		}
	}

	// fetch network artists reactively — auth.isAuthenticated is false on
	// initial load and flips to true after the async /auth/me call resolves
	$effect(() => {
		if (auth.isAuthenticated) {
			networkArtistsCache.fetch();
		}
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
	<meta name="description" content={APP_TAGLINE} />

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
	<!-- top tracks section -->
	{#if !dismissedSections.has('top-tracks')}
		{#key loadingTopTracks}
			{#if loadingTopTracks}
				<section class="shelf" transition:fade={{ duration: 200 }}>
					<div class="shelf-header">
						<h2>top tracks</h2>
						<button
							class="dismiss-btn"
							onclick={() => dismissedSections.dismiss('top-tracks')}
							aria-label="hide top tracks"
							title="hide this section"
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
						</button>
					</div>
					<div class="loading-container compact">
						<WaveLoading size="sm" message="loading..." />
					</div>
				</section>
			{:else if hasTopTracks}
				<section class="shelf" transition:fade={{ duration: 200 }}>
					<div class="shelf-header">
						<h2>top tracks</h2>
						<button
							class="dismiss-btn"
							onclick={() => dismissedSections.dismiss('top-tracks')}
							aria-label="hide top tracks"
							title="hide this section"
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
						</button>
					</div>
					<div class="shelf-grid">
						{#each topTracks as track, i}
							<TrackCard
								{track}
								index={i}
								isPlaying={player.currentTrack?.id === track.id}
								onPlay={(t) => queue.playNow(t)}
							/>
						{/each}
					</div>
				</section>
			{/if}
		{/key}
	{/if}

	<!-- artists from your bluesky network -->
	{#if hasNetworkArtists && !dismissedSections.has('network-artists')}
		<section class="shelf" transition:fade={{ duration: 200 }}>
			<div class="shelf-header">
				<h2>artists you know</h2>
				<button
					class="dismiss-btn"
					onclick={() => dismissedSections.dismiss('network-artists')}
					aria-label="hide artists you know"
					title="hide this section"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
				</button>
			</div>
			<div class="shelf-grid">
				{#each networkArtists as artist}
					{@const refreshedUrl = getRefreshedAvatar(artist.did)}
					{@const displayUrl = refreshedUrl ?? artist.avatar_url}
					<a href="/u/{artist.handle}" class="artist-card">
						{#if displayUrl}
							<img
								src={displayUrl}
								alt={artist.display_name}
								class="artist-avatar"
								onerror={() => {
									if (!hasAttemptedRefresh(artist.did)) {
										triggerAvatarRefresh(artist.did);
									}
								}}
							/>
						{:else}
							<div class="artist-avatar placeholder"></div>
						{/if}
						<div class="artist-info">
							<span class="artist-name">{artist.display_name}</span>
							<span class="artist-meta">{artist.track_count} {artist.track_count === 1 ? 'track' : 'tracks'}</span>
						</div>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	<!-- recent activity -->
	{#if !dismissedSections.has('activity')}
		{#if loadingActivity}
			<section class="shelf" transition:fade={{ duration: 200 }}>
				<div class="shelf-header">
					<h2>recent activity</h2>
					<div class="shelf-actions">
						<a href="/activity" class="see-all">see all</a>
						<button
							class="dismiss-btn"
							onclick={() => dismissedSections.dismiss('activity')}
							aria-label="hide recent activity"
							title="hide this section"
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
						</button>
					</div>
				</div>
				<div class="loading-container compact">
					<WaveLoading size="sm" message="loading..." />
				</div>
			</section>
		{:else if hasActivity}
			<section class="shelf" transition:fade={{ duration: 200 }}>
				<div class="shelf-header">
					<h2>recent activity</h2>
					<div class="shelf-actions">
						<a href="/activity" class="see-all">see all</a>
						<button
							class="dismiss-btn"
							onclick={() => dismissedSections.dismiss('activity')}
							aria-label="hide recent activity"
							title="hide this section"
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
						</button>
					</div>
				</div>
				<div class="shelf-grid">
					{#each activityEvents as event (event.created_at + event.actor.did + event.type)}
						<ActivityCard {event} />
					{/each}
				</div>
			</section>
		{/if}
	{/if}

	<!-- restore dismissed sections -->
	{#if dismissedSections.hasDismissed}
		<button
			class="restore-btn"
			onclick={() => dismissedSections.restoreAll()}
		>
			show all sections
		</button>
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

	/* shared shelf layout for horizontal scroll sections */
	.shelf {
		margin-bottom: 2.5rem;
	}

	.shelf-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.shelf-header h2 {
		font-size: var(--text-page-heading);
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}

	.shelf-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.see-all {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		text-decoration: none;
		transition: color 0.15s;
	}

	.see-all:hover {
		color: var(--accent);
	}

	.dismiss-btn {
		background: none;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		padding: 0.2rem;
		border-radius: var(--radius-sm);
		opacity: 0;
		transition: opacity 0.15s, color 0.15s;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.shelf-header:hover .dismiss-btn {
		opacity: 1;
	}

	.dismiss-btn:hover {
		color: var(--text-primary);
	}

	.shelf-grid {
		display: flex;
		gap: 0.75rem;
		overflow-x: auto;
		padding-bottom: 0.5rem;
		scrollbar-width: none;
		scroll-snap-type: x proximity;
		scroll-padding-inline: 1rem;
	}

	.shelf-grid::-webkit-scrollbar {
		display: none;
	}

	.restore-btn {
		display: block;
		margin: 0 auto 1.5rem;
		background: none;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-full);
		color: var(--text-tertiary);
		font-size: var(--text-xs);
		padding: 0.3rem 0.75rem;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}

	.restore-btn:hover {
		color: var(--text-primary);
		border-color: var(--border-default);
	}

	.artist-card {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		border-radius: var(--radius-md);
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		text-decoration: none;
		color: inherit;
		min-width: 200px;
		max-width: 200px;
		transition: border-color 0.15s, background 0.15s;
		scroll-snap-align: start;
	}

	.artist-card:hover {
		border-color: var(--accent);
		background: var(--bg-hover);
	}

	.artist-avatar {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}

	.artist-avatar.placeholder {
		background: var(--bg-tertiary);
	}

	.artist-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.artist-name {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.artist-meta {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
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

		.shelf-header h2,
		.section-header h2 {
			font-size: var(--text-2xl);
		}

		/* always show dismiss on mobile (no hover) */
		.dismiss-btn {
			opacity: 0.5;
		}
	}
</style>
