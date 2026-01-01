<script lang="ts">
	import { fade } from 'svelte/transition';
	import { API_URL, getAtprotofansSupportUrl } from '$lib/config';
	import { browser } from '$app/environment';
	import type { Analytics, Track, Playlist } from '$lib/types';
	import { formatDuration } from '$lib/stats.svelte';
	import TrackItem from '$lib/components/TrackItem.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import SensitiveImage from '$lib/components/SensitiveImage.svelte';
	import SupporterBadge from '$lib/components/SupporterBadge.svelte';
	import { checkImageSensitive } from '$lib/moderation.svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { auth } from '$lib/auth.svelte';
	import { fetchLikedTracks, fetchUserLikes } from '$lib/tracks.svelte';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import { getAtprotofansProfile, getAtprotofansSupporters, type Supporter } from '$lib/atprotofans';
	import type { PageData } from './$types';


	// receive server-loaded data
	let { data }: { data: PageData } = $props();

	// SSR-safe sensitive image check using server-loaded data
	function isImageSensitiveSSR(url: string | null | undefined): boolean {
		if (!data.sensitiveImages) return false;
		return checkImageSensitive(url, data.sensitiveImages);
	}

	// use server-loaded data directly
const artist = $derived(data.artist);
let tracks = $state(data.tracks ?? []);
const albums = $derived(data.albums ?? []);
let hasMoreTracks = $state(data.hasMoreTracks ?? false);
let nextCursor = $state<string | null>(data.nextCursor ?? null);
let loadingMoreTracks = $state(false);
let shareUrl = $state('');

// compute support URL - handle 'atprotofans' magic value
const supportUrl = $derived(() => {
	if (!artist?.support_url) return null;
	if (artist.support_url === 'atprotofans') {
		return getAtprotofansSupportUrl(artist.did);
	}
	return artist.support_url;
});

$effect(() => {
	if (!artist?.handle) {
		shareUrl = '';
		return;
	}

	if (typeof window !== 'undefined') {
		shareUrl = `${window.location.origin}/u/${artist.handle}`;
	} else {
		shareUrl = `${APP_CANONICAL_URL}/u/${artist.handle}`;
	}
});

	let analytics: Analytics | null = $state(null);
	let analyticsLoading = $state(false);
	let tracksHydrated = $state(false);
	let tracksLoading = $state(false);

	// liked tracks count (shown if artist has show_liked_on_profile enabled)
	let likedTracksCount = $state<number | null>(null);

	// public playlists for collections section
	let publicPlaylists = $state<Playlist[]>([]);

	// supporter status - true if logged-in viewer supports this artist via atprotofans
	let isSupporter = $state(false);

	// atprotofans data - supporter count and list
	let supporterCount = $state<number | null>(null);
	let supporters = $state<Supporter[]>([]);

	// track which artist we've loaded data for to detect navigation
	let loadedForDid = $state<string | null>(null);

	async function handleLogout() {
		await auth.logout();
		window.location.href = '/';
	}

	async function loadAnalytics() {
		if (!artist?.did) return;

		analyticsLoading = true;
		const startTime = Date.now();
		const minDisplayTime = 300; // minimum 300ms to avoid flicker

		try {
			const response = await fetch(`${API_URL}/artists/${artist.did}/analytics`);
			if (response.ok) {
				analytics = await response.json();
			}
		} catch (_e) {
			console.error('failed to load analytics:', _e);
		} finally {
			// ensure loading state shows for at least minDisplayTime
			const elapsed = Date.now() - startTime;
			const remainingTime = Math.max(0, minDisplayTime - elapsed);

			if (remainingTime > 0) {
				setTimeout(() => {
					analyticsLoading = false;
				}, remainingTime);
			} else {
				analyticsLoading = false;
			}
		}
	}

	async function loadLikedTracksCount() {
		if (!artist?.handle || !artist.show_liked_on_profile || likedTracksCount !== null) return;

		try {
			const response = await fetchUserLikes(artist.handle);
			if (response) {
				likedTracksCount = response.tracks.length;
			}
		} catch (_e) {
			console.error('failed to load liked tracks count:', _e);
		}
	}

	async function loadPublicPlaylists() {
		if (!artist?.did) return;

		try {
			const response = await fetch(`${API_URL}/lists/playlists/by-artist/${artist.did}`);
			if (response.ok) {
				publicPlaylists = await response.json();
			}
		} catch (_e) {
			console.error('failed to load public playlists:', _e);
		}
	}

	/**
	 * load atprotofans profile and supporters for this artist.
	 * only called when artist has atprotofans support enabled.
	 */
	async function loadAtprotofansData() {
		// only load if artist has atprotofans enabled
		if (artist?.support_url !== 'atprotofans' || !artist.did) return;

		try {
			// fetch profile (for supporter count) and supporters list in parallel
			const [profile, supportersData] = await Promise.all([
				getAtprotofansProfile(artist.did),
				getAtprotofansSupporters(artist.did, 12) // show up to 12 supporters
			]);

			if (profile) {
				supporterCount = profile.supporterCount;
			}

			if (supportersData) {
				supporters = supportersData.supporters;
			}
		} catch (_e) {
			console.error('failed to load atprotofans data:', _e);
		}
	}

	/**
	 * check if the logged-in viewer supports this artist via atprotofans.
	 * only called when:
	 * 1. viewer is authenticated
	 * 2. artist has atprotofans support enabled
	 * 3. viewer is not the artist themselves
	 */
	async function checkSupporterStatus() {
		// reset state
		isSupporter = false;

		// only check if viewer is logged in
		if (!auth.isAuthenticated || !auth.user?.did) return;

		// only check if artist has atprotofans enabled
		if (artist?.support_url !== 'atprotofans') return;

		// don't show badge on your own profile
		if (auth.user.did === artist.did) return;

		try {
			const url = new URL('https://atprotofans.com/xrpc/com.atprotofans.validateSupporter');
			url.searchParams.set('supporter', auth.user.did);
			url.searchParams.set('subject', artist.did);
			url.searchParams.set('signer', artist.did);

			const response = await fetch(url.toString());
			if (response.ok) {
				const data = await response.json();
				isSupporter = data.valid === true;
			}
		} catch (_e) {
			// silently fail - supporter badge is optional enhancement
			console.error('failed to check supporter status:', _e);
		}
	}

	// reload data when navigating between artist pages
	// watch data.artist?.did (from server) not artist?.did (local derived)
	$effect(() => {
		const currentDid = data.artist?.did;
		if (!currentDid || !browser) return;

		// check if we navigated to a different artist
		if (loadedForDid !== currentDid) {
			// reset state for new artist
			analytics = null;
			tracksHydrated = false;
			likedTracksCount = null;
			publicPlaylists = [];
			isSupporter = false;
			supporterCount = null;
			supporters = [];

			// sync tracks and pagination from server data
			tracks = data.tracks ?? [];
			hasMoreTracks = data.hasMoreTracks ?? false;
			nextCursor = data.nextCursor ?? null;

			// mark as loaded for this artist
			loadedForDid = currentDid;

			// load fresh data
			loadAnalytics();
			primeLikesFromCache();
			void hydrateTracksWithLikes();
			void loadLikedTracksCount();
			void loadPublicPlaylists();
			void checkSupporterStatus();
			void loadAtprotofansData();
		}
	});

	async function loadMoreTracks() {
		if (!artist?.did || !nextCursor || loadingMoreTracks) return;

		loadingMoreTracks = true;
		try {
			const response = await fetch(
				`${API_URL}/tracks/?artist_did=${artist.did}&cursor=${encodeURIComponent(nextCursor)}`
			);
			if (response.ok) {
				const data = await response.json();
				const newTracks = data.tracks || [];

				// hydrate with liked status if authenticated
				if (auth.isAuthenticated) {
					const likedTracks = await fetchLikedTracks();
					const likedIds = new Set(likedTracks.map(track => track.id));
					for (const track of newTracks) {
						track.is_liked = likedIds.has(track.id);
					}
				}

				tracks = [...tracks, ...newTracks];
				hasMoreTracks = data.has_more || false;
				nextCursor = data.next_cursor || null;
			}
		} catch (_e) {
			console.error('failed to load more tracks:', _e);
		} finally {
			loadingMoreTracks = false;
		}
	}

	async function hydrateTracksWithLikes() {
		if (!browser || tracksHydrated) return;

		// skip if not authenticated - no need to fetch liked tracks
		if (!auth.isAuthenticated) {
			tracksHydrated = true;
			return;
		}

		tracksLoading = true;
		try {
			const likedTracks = await fetchLikedTracks();
			const likedIds = new Set(likedTracks.map(track => track.id));
			applyLikedFlags(likedIds);
		} catch (_e) {
			console.error('failed to hydrate artist likes:', _e);
		} finally {
			tracksLoading = false;
			tracksHydrated = true;
		}
	}

	function applyLikedFlags(likedIds: Set<number>) {
		let changed = false;

		const nextTracks = tracks.map(track => {
			const nextLiked = likedIds.has(track.id);
			const currentLiked = Boolean(track.is_liked);
			if (currentLiked !== nextLiked) {
				changed = true;
				return { ...track, is_liked: nextLiked };
			}
			return track;
		});

		if (changed) {
			tracks = nextTracks;
		}
	}

	function primeLikesFromCache() {
		if (!browser) return;
		try {
			const cachedRaw = localStorage.getItem('tracks_cache');
			if (!cachedRaw) return;
			const cached = JSON.parse(cachedRaw) as { tracks?: Track[] };
			const cachedTracks = cached.tracks ?? [];
			if (cachedTracks.length === 0) return;

			const likedIds = new Set(
				cachedTracks.filter(track => Boolean(track.is_liked)).map(track => track.id)
			);

			if (likedIds.size > 0) {
				applyLikedFlags(likedIds);
			}
		} catch (e) {
			console.warn('failed to hydrate likes from cache', e);
		}
	}
</script>

<svelte:head>
	{#if data.artist}
		<title>{data.artist.display_name} (@{data.artist.handle}) - {APP_NAME}</title>
		<meta
			name="description"
			content={`listen to audio by ${data.artist.display_name} on ${APP_NAME}`}
		/>

		<!-- Open Graph / Facebook -->
		<meta property="og:type" content="profile" />
		<meta property="og:title" content="{data.artist.display_name}" />
		<meta
			property="og:description"
			content="@{data.artist.handle} on {APP_NAME}"
		/>
		<meta
			property="og:url"
			content={`${APP_CANONICAL_URL}/u/${data.artist.handle}`}
		/>
		<meta property="og:site_name" content={APP_NAME} />
		<meta property="profile:username" content="{data.artist.handle}" />
		{#if data.artist.avatar_url && !isImageSensitiveSSR(data.artist.avatar_url)}
			<meta property="og:image" content="{data.artist.avatar_url}" />
			<meta property="og:image:secure_url" content="{data.artist.avatar_url}" />
			<meta property="og:image:width" content="400" />
			<meta property="og:image:height" content="400" />
			<meta property="og:image:alt" content="{data.artist.display_name}" />
		{/if}

		<!-- Twitter -->
		<meta name="twitter:card" content="summary" />
		<meta name="twitter:title" content="{data.artist.display_name}" />
		<meta
			name="twitter:description"
			content="@{data.artist.handle} on {APP_NAME}"
		/>
		{#if data.artist.avatar_url && !isImageSensitiveSSR(data.artist.avatar_url)}
			<meta name="twitter:image" content="{data.artist.avatar_url}" />
		{/if}
	{/if}
</svelte:head>

{#if artist}
	<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

	<main>
		<section class="artist-header">
			{#if artist.avatar_url}
				<SensitiveImage src={artist.avatar_url}>
					<img src={artist.avatar_url} alt={artist.display_name} class="artist-avatar" />
				</SensitiveImage>
			{/if}
			<div class="artist-details">
				<div class="artist-info">
					<h1>{artist.display_name}</h1>
					<div class="handle-row">
						<a href="https://bsky.app/profile/{artist.handle}" target="_blank" rel="noopener" class="handle">
							@{artist.handle}
						</a>
						{#if isSupporter}
							<SupporterBadge />
						{/if}
					</div>
					{#if artist.bio}
						<p class="bio">{artist.bio}</p>
					{/if}
				</div>
				<div class="artist-actions-desktop">
					{#if supportUrl()}
						<a href={supportUrl()} target="_blank" rel="noopener" class="support-btn">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
								<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
							</svg>
							support
						</a>
					{/if}
					<ShareButton url={shareUrl} title="share artist" />
				</div>
			</div>
			<div class="artist-actions-mobile">
				{#if supportUrl()}
					<a href={supportUrl()} target="_blank" rel="noopener" class="support-btn">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
							<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
						</svg>
						support
					</a>
				{/if}
				<ShareButton url={shareUrl} title="share artist" />
			</div>
		</section>

		{#if artist.support_url === 'atprotofans' && supporters.length > 0}
			<section class="supporters-section">
				<div class="section-header">
					<h2>supporters</h2>
					{#if supporterCount !== null}
						<span>{supporterCount} {supporterCount === 1 ? 'supporter' : 'supporters'}</span>
					{/if}
				</div>
				<div class="supporters-grid">
					{#each supporters as supporter}
						<a
							href="https://bsky.app/profile/{supporter.handle}"
							target="_blank"
							rel="noopener"
							class="supporter-card"
							title={supporter.displayName || supporter.handle}
						>
							{#if supporter.avatar && supporter.avatar.length > 0}
								<img src={supporter.avatar} alt="" class="supporter-avatar" />
							{:else}
								<div class="supporter-avatar-placeholder">
									<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
										<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
									</svg>
								</div>
							{/if}
							<span class="supporter-name">{supporter.displayName || supporter.handle}</span>
						</a>
					{/each}
				</div>
				{#if supporterCount !== null && supporterCount > supporters.length}
					<a
						href={supportUrl()}
						target="_blank"
						rel="noopener"
						class="view-all-supporters"
					>
						view all {supporterCount} supporters on atprotofans
					</a>
				{/if}
			</section>
		{/if}

		<section class="analytics">
			<h2>analytics</h2>
			<div class="analytics-grid">
				{#key analyticsLoading}
					{#if analyticsLoading}
						<div class="stat-card skeleton" transition:fade={{ duration: 200 }}>
							<div class="skeleton-bar large"></div>
							<div class="skeleton-bar small"></div>
						</div>
						<div class="stat-card skeleton" transition:fade={{ duration: 200 }}>
							<div class="skeleton-bar large"></div>
							<div class="skeleton-bar small"></div>
						</div>
						<div class="stat-card skeleton" transition:fade={{ duration: 200 }}>
							<div class="skeleton-bar small"></div>
							<div class="skeleton-bar medium"></div>
							<div class="skeleton-bar small"></div>
						</div>
					{:else if analytics}
						<div class="stat-card" transition:fade={{ duration: 200 }}>
							<div class="stat-value">{analytics.total_plays.toLocaleString()}</div>
							<div class="stat-label">total plays</div>
						</div>
						<div class="stat-card" transition:fade={{ duration: 200 }}>
							<div class="stat-value">{analytics.total_items}</div>
							<div class="stat-label">total tracks</div>
							{#if analytics.total_duration_seconds > 0}
								<div class="stat-duration">{formatDuration(analytics.total_duration_seconds)}</div>
							{/if}
						</div>
						{#if analytics.top_item}
							<a href="/track/{analytics.top_item.id}" class="stat-card top-item" transition:fade={{ duration: 200 }}>
								<div class="stat-label">most played</div>
								<div class="top-item-title">{analytics.top_item.title}</div>
								<div class="top-item-plays">{analytics.top_item.play_count.toLocaleString()} plays</div>
							</a>
						{/if}
						{#if analytics.top_liked}
							<a href="/track/{analytics.top_liked.id}" class="stat-card top-item" transition:fade={{ duration: 200 }}>
								<div class="stat-label">most liked</div>
								<div class="top-item-title">{analytics.top_liked.title}</div>
								<div class="top-item-plays">{analytics.top_liked.play_count.toLocaleString()} {analytics.top_liked.play_count === 1 ? 'like' : 'likes'}</div>
							</a>
						{/if}
					{/if}
				{/key}
			</div>
		</section>

		<section class="tracks">
			<div class="section-header">
				<h2>
					tracks
					{#if tracksLoading}
						<span class="tracks-loading">updating…</span>
					{/if}
				</h2>
				{#if analytics?.total_items}
					<span>{analytics.total_items} {analytics.total_items === 1 ? 'track' : 'tracks'}</span>
				{/if}
			</div>
			{#if tracks.length === 0}
				<div class="empty-state">
					<p class="empty-message">no tracks yet</p>
					<p class="empty-detail">
						{artist.display_name} hasn't uploaded any music to {APP_NAME}.
					</p>
					<a
						href="https://bsky.app/profile/{artist.handle}"
						target="_blank"
						rel="noopener"
						class="bsky-link"
					>
						view their Bluesky profile
					</a>
				</div>
			{:else}
				<div class="track-list">
					{#each tracks as track, i}
						<TrackItem
							{track}
							index={i}
							isPlaying={player.currentTrack?.id === track.id}
							onPlay={(t) => queue.playNow(t)}
							isAuthenticated={auth.isAuthenticated}
							hideArtist={true}
						/>
					{/each}
				</div>
				{#if hasMoreTracks}
					<button
						class="load-more-btn"
						onclick={loadMoreTracks}
						disabled={loadingMoreTracks}
					>
						{#if loadingMoreTracks}
							loading…
						{:else}
							load more tracks
						{/if}
					</button>
				{/if}
			{/if}
		</section>

		{#if albums.length > 0}
			<section class="albums">
				<div class="section-header">
					<h2>albums</h2>
					<span>{albums.length} {albums.length === 1 ? 'album' : 'albums'}</span>
				</div>
				<div class="album-grid">
					{#each albums as album}
						<a class="album-card" href="/u/{artist.handle}/album/{album.slug}">
							<div class="album-cover-wrapper">
								{#if album.image_url}
									<SensitiveImage src={album.image_url}>
										<img src={album.image_url} alt="{album.title} artwork" />
									</SensitiveImage>
								{:else}
									<div class="album-cover-placeholder">
										<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
											<rect x="3" y="3" width="18" height="18" stroke="currentColor" stroke-width="1.5" fill="none" />
											<circle cx="12" cy="12" r="4" fill="currentColor" />
										</svg>
									</div>
								{/if}
							</div>
							<div class="album-card-meta">
								<h3>{album.title}</h3>
								<p>
									{album.track_count} {album.track_count === 1 ? 'track' : 'tracks'}
									<span class="dot">•</span>
									{album.total_plays.toLocaleString()} {album.total_plays === 1 ? 'play' : 'plays'}
								</p>
							</div>
						</a>
					{/each}
				</div>
			</section>
		{/if}

		{#if artist.show_liked_on_profile || publicPlaylists.length > 0}
			<section class="collections-section">
				<div class="section-header">
					<h2>collections</h2>
				</div>
				<div class="collections-list">
					{#if artist.show_liked_on_profile}
						<a href="/liked/{artist.handle}" class="collection-link">
							<div class="collection-icon liked">
								<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
									<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
								</svg>
							</div>
							<div class="collection-info">
								<h3>liked tracks</h3>
								{#if likedTracksCount !== null}
									<p>{likedTracksCount} {likedTracksCount === 1 ? 'track' : 'tracks'}</p>
								{:else}
									<p>view collection</p>
								{/if}
							</div>
							<div class="collection-arrow">
								<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M9 18l6-6-6-6"/>
								</svg>
							</div>
						</a>
					{/if}
					{#each publicPlaylists as playlist}
						<a href="/playlist/{playlist.id}" class="collection-link">
							<div class="collection-icon playlist">
								{#if playlist.image_url}
									<img src={playlist.image_url} alt="{playlist.name} cover" />
								{:else}
									<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<path d="M9 18V5l12-2v13"/>
										<circle cx="6" cy="18" r="3"/>
										<circle cx="18" cy="16" r="3"/>
									</svg>
								{/if}
							</div>
							<div class="collection-info">
								<h3>{playlist.name}</h3>
								<p>{playlist.track_count} {playlist.track_count === 1 ? 'track' : 'tracks'}</p>
							</div>
							<div class="collection-arrow">
								<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M9 18l6-6-6-6"/>
								</svg>
							</div>
						</a>
					{/each}
				</div>
			</section>
		{/if}
	</main>
{/if}

<style>
	main {
		min-height: 100vh;
		padding: 2rem;
		padding-bottom: 8rem;
		width: 100%;
	}

	main > * {
		max-width: 1200px;
		margin-left: auto;
		margin-right: auto;
	}

	.artist-header {
		display: flex;
		align-items: center;
		gap: 2rem;
		margin-bottom: 3rem;
		padding: 2rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
	}

	.artist-details {
		display: flex;
		align-items: flex-start;
		gap: 1.5rem;
		width: 100%;
	}

	.artist-info {
		flex: 1;
	}

	.artist-actions-desktop {
		display: flex;
		align-items: flex-start;
		justify-content: center;
		gap: 0.75rem;
	}

	.artist-actions-mobile {
		display: none;
		width: 100%;
		justify-content: center;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}

	.support-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		height: 32px;
		padding: 0 0.75rem;
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
		border-radius: var(--radius-sm);
		color: var(--accent);
		font-size: var(--text-sm);
		text-decoration: none;
		transition: all 0.2s ease;
	}

	.support-btn:hover {
		background: color-mix(in srgb, var(--accent) 25%, transparent);
		border-color: var(--accent);
		transform: translateY(-1px);
	}

	.support-btn svg {
		flex-shrink: 0;
	}

	.artist-avatar {
		width: 120px;
		height: 120px;
		border-radius: var(--radius-full);
		object-fit: cover;
		border: 3px solid var(--border-default);
	}

	.artist-info h1 {
		font-size: 2.5rem;
		margin: 0 0 0.5rem 0;
		color: var(--text-primary);
		word-wrap: break-word;
		overflow-wrap: break-word;
		hyphens: auto;
	}

	.handle-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}

	.handle {
		color: var(--text-tertiary);
		font-size: var(--text-xl);
		text-decoration: none;
		transition: color 0.2s;
	}

	.handle:hover {
		color: var(--accent);
	}

	.bio {
		color: var(--text-secondary);
		line-height: 1.6;
		margin: 0;
	}

	.supporters-section {
		margin-bottom: 2rem;
	}

	.supporters-section h2 {
		margin: 0;
		color: var(--text-primary);
		font-size: 1.8rem;
	}

	.supporters-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.supporter-card {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		color: inherit;
		text-decoration: none;
		transition: transform 0.15s ease, border-color 0.15s ease;
	}

	.supporter-card:hover {
		transform: translateY(-1px);
		border-color: var(--accent);
	}

	.supporter-avatar {
		width: 28px;
		height: 28px;
		border-radius: var(--radius-full);
		object-fit: cover;
		flex-shrink: 0;
	}

	.supporter-avatar-placeholder {
		width: 28px;
		height: 28px;
		border-radius: var(--radius-full);
		background: var(--bg-tertiary);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.supporter-name {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 120px;
	}

	.view-all-supporters {
		display: block;
		margin-top: 1rem;
		text-align: center;
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		text-decoration: none;
		padding: 0.5rem;
		transition: color 0.15s ease;
	}

	.view-all-supporters:hover {
		color: var(--accent);
	}

	.analytics {
		margin-bottom: 3rem;
	}

	.analytics h2 {
		margin-bottom: 1.5rem;
		color: var(--text-primary);
		font-size: 1.8rem;
	}

	.analytics-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1.5rem;
		/* prevent layout shift during transition */
		min-height: 120px;
	}

	.section-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.25rem;
	}

	.section-header span {
		color: var(--text-tertiary);
		font-size: var(--text-base);
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}

	.album-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
		gap: 1.25rem;
	}

	.album-card {
		display: flex;
		gap: 1rem;
		align-items: center;
		padding: 1rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		color: inherit;
		text-decoration: none;
		transition: transform 0.15s ease, border-color 0.15s ease;
		overflow: hidden;
		max-width: 100%;
	}

	.album-card:hover {
		transform: translateY(-2px);
		border-color: var(--accent);
	}

	.album-cover-wrapper {
		width: 72px;
		height: 72px;
		border-radius: var(--radius-base);
		overflow: hidden;
		flex-shrink: 0;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.album-cover-wrapper img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.album-cover-placeholder {
		color: var(--text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
	}

	.album-card-meta h3 {
		margin: 0 0 0.35rem 0;
		font-size: 1.05rem;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.album-card-meta {
		flex: 1;
		min-width: 0;
	}

	.album-card-meta {
		flex: 1;
		min-width: 0;
	}

	.album-card-meta p {
		margin: 0;
		color: var(--text-tertiary);
		font-size: var(--text-base);
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.album-card-meta .dot {
		font-size: 0.65rem;
		color: var(--text-muted);
	}

	.stat-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		padding: 1.5rem;
		transition: border-color 0.2s;
	}

	.stat-card:hover {
		border-color: var(--border-emphasis);
	}

	.stat-value {
		font-size: 2.5rem;
		font-weight: bold;
		color: var(--accent);
		margin-bottom: 0.5rem;
		line-height: 1;
	}

	.stat-label {
		color: var(--text-tertiary);
		font-size: var(--text-base);
		text-transform: lowercase;
		line-height: 1;
	}

	.stat-duration {
		margin-top: 0.5rem;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}

	.stat-card.top-item {
		grid-column: span 1;
		text-decoration: none;
		display: block;
		cursor: pointer;
	}

	.stat-card.top-item:hover {
		border-color: var(--accent);
		transform: translateY(-2px);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 20%, transparent);
	}

	.top-item-title {
		font-size: 1.2rem;
		color: var(--text-primary);
		margin: 0.5rem 0;
		font-weight: 500;
		line-height: 1;
	}

	.top-item-plays {
		color: var(--accent);
		font-size: var(--text-lg);
		line-height: 1;
	}

	/* skeleton loading styles - match exact dimensions of real content */
	.stat-card.skeleton {
		pointer-events: none;
		/* ensure skeleton has same total height as real content */
		min-height: 96px; /* matches stat-card content height */
	}

	.skeleton-bar {
		background: linear-gradient(
			90deg,
			var(--bg-tertiary) 0%,
			var(--bg-hover) 50%,
			var(--bg-tertiary) 100%
		);
		background-size: 200% 100%;
		animation: shimmer 1.5s ease-in-out infinite;
		border-radius: var(--radius-sm);
	}

	/* match .stat-value dimensions: 2.5rem font + 0.5rem margin-bottom */
	.skeleton-bar.large {
		height: 2.5rem;
		width: 60%;
		margin-bottom: 0.5rem;
		line-height: 1;
	}

	/* match .top-item-title dimensions: 1.2rem font + 0.5rem margin top/bottom */
	.skeleton-bar.medium {
		height: 1.2rem;
		width: 80%;
		margin: 0.5rem 0;
		line-height: 1;
	}

	/* match .stat-label dimensions: 0.9rem font */
	.skeleton-bar.small {
		height: 0.9rem;
		width: 40%;
		line-height: 1;
	}

	@keyframes shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}

	.tracks {
		margin-top: 2rem;
	}

	.tracks .section-header h2 {
		margin: 0;
		color: var(--text-primary);
		font-size: 1.8rem;
	}

	.load-more-btn {
		display: block;
		width: 100%;
		margin-top: 1rem;
		padding: 0.75rem 1.5rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		font-family: inherit;
		font-size: var(--text-base);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.load-more-btn:hover:not(:disabled) {
		background: var(--bg-tertiary);
		border-color: var(--accent);
		color: var(--accent);
	}

	.load-more-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.tracks-loading {
		margin-left: 0.75rem;
		font-size: var(--text-base);
		color: var(--text-secondary);
		font-weight: 400;
		text-transform: lowercase;
	}

	.track-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.empty-state {
		text-align: center;
		padding: 3rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
	}

	.empty-message {
		color: var(--text-secondary);
		font-size: var(--text-2xl);
		margin: 0 0 0.5rem 0;
	}

	.empty-detail {
		color: var(--text-tertiary);
		margin: 0 0 1.5rem 0;
	}

	.bsky-link {
		color: var(--accent);
		text-decoration: none;
		font-size: var(--text-lg);
		padding: 0.75rem 1.5rem;
		border: 1px solid var(--accent);
		border-radius: var(--radius-base);
		transition: all 0.2s;
		display: inline-block;
	}

	.bsky-link:hover {
		background: var(--accent);
		color: var(--bg-primary);
	}

	/* respect reduced motion preference */
	@media (prefers-reduced-motion: reduce) {
		.skeleton-bar {
			animation: none;
		}
	}

	@media (max-width: 768px) {
		main {
			padding: 1rem;
			padding-bottom: calc(var(--player-height, 10rem) + env(safe-area-inset-bottom, 0px));
		}

		.artist-header {
			flex-direction: column;
			text-align: center;
			gap: 1rem;
			padding: 1.5rem;
		}

		.artist-details {
			flex-direction: column;
			align-items: center;
			gap: 1rem;
		}

		.artist-info {
			text-align: center;
		}

		.handle-row {
			justify-content: center;
		}

		.artist-actions-desktop {
			display: none;
		}

		.artist-actions-mobile {
			display: flex;
		}

		.support-btn {
			height: 28px;
			font-size: var(--text-sm);
			padding: 0 0.6rem;
		}

		.support-btn svg {
			width: 14px;
			height: 14px;
		}

		.artist-avatar {
			width: 100px;
			height: 100px;
		}

		.artist-info h1 {
			font-size: 2rem;
			word-wrap: break-word;
			overflow-wrap: break-word;
		}

		.analytics-grid {
			grid-template-columns: 1fr;
		}

		.stat-value {
			font-size: 2rem;
		}

		.album-grid {
			grid-template-columns: 1fr;
		}

		.album-card {
			padding: 0.75rem;
			gap: 0.75rem;
		}

		.album-cover-wrapper {
			width: 56px;
			height: 56px;
			border-radius: var(--radius-sm);
		}

		.album-card-meta h3 {
			font-size: var(--text-base);
			margin-bottom: 0.25rem;
		}

		.album-card-meta p {
			font-size: var(--text-sm);
		}

		.supporters-section h2 {
			font-size: 1.5rem;
		}

		.supporters-grid {
			justify-content: center;
		}

		.supporter-card {
			padding: 0.4rem 0.6rem;
		}

		.supporter-avatar,
		.supporter-avatar-placeholder {
			width: 24px;
			height: 24px;
		}

		.supporter-name {
			max-width: 80px;
		}
	}

	.collections-section {
		margin-top: 2rem;
	}

	.collections-section h2 {
		margin-bottom: 1.25rem;
		color: var(--text-primary);
		font-size: 1.8rem;
	}

	.collections-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.collection-link {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1.25rem 1.5rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		color: inherit;
		text-decoration: none;
		transition: transform 0.15s ease, border-color 0.15s ease;
	}

	.collection-link:hover {
		transform: translateY(-2px);
		border-color: var(--accent);
	}

	.collection-icon {
		width: 48px;
		height: 48px;
		border-radius: var(--radius-md);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		overflow: hidden;
	}

	.collection-icon.liked {
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		color: var(--accent);
	}

	.collection-icon.playlist {
		background: var(--bg-tertiary);
		color: var(--text-secondary);
	}

	.collection-icon.playlist img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.collection-info {
		flex: 1;
		min-width: 0;
	}

	.collection-info h3 {
		margin: 0 0 0.25rem 0;
		font-size: var(--text-xl);
		color: var(--text-primary);
	}

	.collection-info p {
		margin: 0;
		font-size: var(--text-base);
		color: var(--text-tertiary);
	}

	.collection-arrow {
		color: var(--text-muted);
		transition: transform 0.15s ease, color 0.15s ease;
	}

	.collection-link:hover .collection-arrow {
		color: var(--accent);
		transform: translateX(4px);
	}

	.albums {
		margin-top: 2rem;
	}

	.albums h2 {
		margin-bottom: 1.5rem;
		color: var(--text-primary);
		font-size: 1.8rem;
	}
</style>
