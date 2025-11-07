<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { fade } from 'svelte/transition';
	import { API_URL } from '$lib/config';
	import type { Track, Artist, User, Analytics } from '$lib/types';
	import TrackItem from '$lib/components/TrackItem.svelte';
	import Header from '$lib/components/Header.svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import type { PageData } from './$types';

	// receive server-loaded data
	let { data }: { data: PageData } = $props();

	let handle = $derived($page.params.handle);
	let artist: Artist | null = $state(data.artist); // initialize with server data
	let tracks: Track[] = $state(data.tracks); // initialize with server data
	let loading = $state(true);
	let error = $state('');
	let user: User | null = $state(null);
	let isAuthenticated = $state(false);
	let analytics: Analytics | null = $state(null);
	let analyticsLoading = $state(false);

	function checkIsOwnProfile(): boolean {
		return user !== null && artist !== null && user.did === artist.did;
	}
	let isOwnProfile = $derived(checkIsOwnProfile());

	async function checkAuth() {
		const sessionId = localStorage.getItem('session_id');
		if (!sessionId) {
			isAuthenticated = false;
			return;
		}

		try {
			const response = await fetch(`${API_URL}/auth/me`, {
				headers: {
					'Authorization': `Bearer ${sessionId}`
				}
			});

			if (response.ok) {
				user = await response.json();
				isAuthenticated = true;
			} else {
				localStorage.removeItem('session_id');
				isAuthenticated = false;
			}
		} catch (e) {
			console.error('auth check failed:', e);
			isAuthenticated = false;
		}
	}

	async function handleLogout() {
		const sessionId = localStorage.getItem('session_id');
		if (!sessionId) return;

		try {
			await fetch(`${API_URL}/auth/logout`, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${sessionId}`
				}
			});
		} catch (e) {
			console.error('logout failed:', e);
		}

		localStorage.removeItem('session_id');
		user = null;
		isAuthenticated = false;
	}

	async function loadArtistAndTracks() {
		loading = true;
		error = '';

		try {
			// fetch artist info (handle already has @ stripped by SvelteKit)
			const artistResponse = await fetch(`${API_URL}/artists/by-handle/${handle}`);
			if (!artistResponse.ok) {
				if (artistResponse.status === 404) {
					// check if handle is valid via AT Protocol identity resolution
					try {
						const identityResponse = await fetch(`https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`);
						if (identityResponse.ok) {
							// valid handle, but no artist record in our database
							error = `this person hasn't posted any audio on ${APP_NAME} yet`;
						} else {
							// invalid handle
							error = 'invalid handle';
						}
					} catch {
						// if we can't verify, assume invalid
						error = 'invalid handle';
					}
				} else {
					error = 'failed to load artist';
				}
				return;
			}
			artist = await artistResponse.json();

			// fetch artist's tracks
			const tracksResponse = await fetch(`${API_URL}/tracks/?artist_did=${artist?.did}`);
			if (tracksResponse.ok) {
				const data = await tracksResponse.json();
			tracks = data.tracks;
			}
		} catch (e) {
			error = 'failed to load artist';
			console.error('failed to load artist:', e);
		} finally {
			loading = false;
		}
	}

	async function loadAnalytics() {
		const sessionId = localStorage.getItem('session_id');
		if (!sessionId) return;

		analyticsLoading = true;
		const startTime = Date.now();
		const minDisplayTime = 300; // minimum 300ms to avoid flicker

		try {
			const response = await fetch(`${API_URL}/artists/me/analytics`, {
				headers: {
					'Authorization': `Bearer ${sessionId}`
				}
			});
			if (response.ok) {
				analytics = await response.json();
			}
		} catch (e) {
			console.error('failed to load analytics:', e);
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

	onMount(async () => {
		await checkAuth();
		await loadArtistAndTracks();
		// load analytics in background without blocking page render
		loadAnalytics();
	});
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
		<meta property="og:title" content="{data.artist.display_name} (@{data.artist.handle})" />
		<meta
			property="og:description"
			content={`listen to audio by ${data.artist.display_name} on ${APP_NAME}`}
		/>
		<meta
			property="og:url"
			content={`${APP_CANONICAL_URL}/u/${data.artist.handle}`}
		/>
		<meta property="og:site_name" content={APP_NAME} />
		<meta property="profile:username" content="{data.artist.handle}" />
		{#if data.artist.avatar_url}
			<meta property="og:image" content="{data.artist.avatar_url}" />
		{/if}

		<!-- Twitter -->
		<meta name="twitter:card" content="summary" />
		<meta name="twitter:title" content="{data.artist.display_name} (@{data.artist.handle})" />
		<meta
			name="twitter:description"
			content={`listen to audio by ${data.artist.display_name} on ${APP_NAME}`}
		/>
		{#if data.artist.avatar_url}
			<meta name="twitter:image" content="{data.artist.avatar_url}" />
		{/if}
	{/if}
</svelte:head>

{#if loading}
	<div class="loading">loading...</div>
{:else if error}
	<div class="error-container">
		<h1>{error}</h1>
		<a href="/">go home</a>
	</div>
{:else if artist}

	<Header {user} {isAuthenticated} onLogout={handleLogout} />

	<main>
		<section class="artist-header">
			{#if artist.avatar_url}
				<img src={artist.avatar_url} alt={artist.display_name} class="artist-avatar" />
			{/if}
			<div class="artist-info">
				<h1>{artist.display_name}</h1>
				<a href="https://bsky.app/profile/{artist.handle}" target="_blank" rel="noopener" class="handle">
					@{artist.handle}
				</a>
				{#if artist.bio}
					<p class="bio">{artist.bio}</p>
				{/if}
			</div>
		</section>

		{#if isOwnProfile}
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
							</div>
							{#if analytics.top_item}
								<div class="stat-card top-item" transition:fade={{ duration: 200 }}>
									<div class="stat-label">most played</div>
									<div class="top-item-title">{analytics.top_item.title}</div>
									<div class="top-item-plays">{analytics.top_item.play_count.toLocaleString()} plays</div>
								</div>
							{/if}
						{/if}
					{/key}
				</div>
			</section>
		{/if}

		<section class="tracks">
			<h2>tracks</h2>
			{#if tracks.length === 0}
				<p class="empty">no tracks yet</p>
			{:else}
				<div class="track-list">
					{#each tracks as track}
						<TrackItem
							{track}
							isPlaying={player.currentTrack?.id === track.id}
							onPlay={(t) => queue.playNow(t)}
						/>
					{/each}
				</div>
			{/if}
		</section>
	</main>
{/if}

<style>
	.loading,
	.error-container {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
	}

	.error-container a {
		color: var(--accent);
		text-decoration: none;
	}

	main {
		min-height: 100vh;
		padding: 2rem;
		padding-bottom: 8rem;
		max-width: 1200px;
		margin: 0 auto;
	}

	.artist-header {
		display: flex;
		align-items: center;
		gap: 2rem;
		margin-bottom: 3rem;
		padding: 2rem;
		background: #141414;
		border: 1px solid #282828;
		border-radius: 8px;
	}

	.artist-avatar {
		width: 120px;
		height: 120px;
		border-radius: 50%;
		object-fit: cover;
		border: 3px solid #333;
	}

	.artist-info h1 {
		font-size: 2.5rem;
		margin: 0 0 0.5rem 0;
		color: #e8e8e8;
	}

	.handle {
		color: #909090;
		font-size: 1.1rem;
		margin: 0 0 1rem 0;
		text-decoration: none;
		transition: color 0.2s;
		display: inline-block;
	}

	.handle:hover {
		color: var(--accent);
	}

	.bio {
		color: #b0b0b0;
		line-height: 1.6;
		margin: 0;
	}

	.analytics {
		margin-bottom: 3rem;
	}

	.analytics h2 {
		margin-bottom: 1.5rem;
		color: #e8e8e8;
		font-size: 1.8rem;
	}

	.analytics-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1.5rem;
		/* prevent layout shift during transition */
		min-height: 120px;
	}

	.stat-card {
		background: #141414;
		border: 1px solid #282828;
		border-radius: 8px;
		padding: 1.5rem;
		transition: border-color 0.2s;
	}

	.stat-card:hover {
		border-color: #404040;
	}

	.stat-value {
		font-size: 2.5rem;
		font-weight: bold;
		color: var(--accent);
		margin-bottom: 0.5rem;
		line-height: 1;
	}

	.stat-label {
		color: #909090;
		font-size: 0.9rem;
		text-transform: lowercase;
		line-height: 1;
	}

	.stat-card.top-item {
		grid-column: span 1;
	}

	.top-item-title {
		font-size: 1.2rem;
		color: #e8e8e8;
		margin: 0.5rem 0;
		font-weight: 500;
		line-height: 1;
	}

	.top-item-plays {
		color: var(--accent);
		font-size: 1rem;
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
			#1a1a1a 0%,
			#242424 50%,
			#1a1a1a 100%
		);
		background-size: 200% 100%;
		animation: shimmer 1.5s ease-in-out infinite;
		border-radius: 4px;
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

	.tracks h2 {
		margin-bottom: 1.5rem;
		color: #e8e8e8;
		font-size: 1.8rem;
	}

	.track-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.empty {
		text-align: center;
		padding: 3rem;
		color: #808080;
		font-style: italic;
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
			padding-bottom: 10rem;
		}

		.artist-header {
			flex-direction: column;
			text-align: center;
			gap: 1rem;
			padding: 1.5rem;
		}

		.artist-avatar {
			width: 100px;
			height: 100px;
		}

		.artist-info h1 {
			font-size: 2rem;
		}

		.analytics-grid {
			grid-template-columns: 1fr;
		}

		.stat-value {
			font-size: 2rem;
		}
	}
</style>
