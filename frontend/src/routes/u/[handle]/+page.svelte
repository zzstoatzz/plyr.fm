<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { API_URL } from '$lib/config';
	import type { Analytics } from '$lib/types';
	import TrackItem from '$lib/components/TrackItem.svelte';
	import Header from '$lib/components/Header.svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { auth } from '$lib/auth.svelte';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import type { PageData } from './$types';

	// receive server-loaded data
	let { data }: { data: PageData } = $props();

	// use server-loaded data directly
	const artist = $derived(data.artist);
	const tracks = $derived(data.tracks);
	const albums = $derived(data.albums ?? []);

	let analytics: Analytics | null = $state(null);
	let analyticsLoading = $state(false);

	function checkIsOwnProfile(): boolean {
		return auth.user !== null && artist !== null && auth.user.did === artist.did;
	}
	let isOwnProfile = $derived(checkIsOwnProfile());

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

	onMount(() => {
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
		{#if data.artist.avatar_url}
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
		{#if data.artist.avatar_url}
			<meta name="twitter:image" content="{data.artist.avatar_url}" />
		{/if}
	{/if}
</svelte:head>

{#if artist}
	<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

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
							isAuthenticated={auth.isAuthenticated}
						/>
					{/each}
				</div>
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
									<img src={album.image_url} alt="{album.title} artwork" />
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
		word-wrap: break-word;
		overflow-wrap: break-word;
		hyphens: auto;
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

	.discography {
		margin: 3rem 0;
	}

	.section-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.25rem;
	}

	.section-header span {
		color: #808080;
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}

	.album-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 1.25rem;
	}

	.album-card {
		display: flex;
		gap: 1rem;
		align-items: center;
		padding: 1rem;
		background: #141414;
		border: 1px solid #282828;
		border-radius: 10px;
		color: inherit;
		text-decoration: none;
		transition: transform 0.15s ease, border-color 0.15s ease;
	}

	.album-card:hover {
		transform: translateY(-2px);
		border-color: var(--accent);
	}

	.album-cover-wrapper {
		width: 72px;
		height: 72px;
		border-radius: 6px;
		overflow: hidden;
		flex-shrink: 0;
		background: #1a1a1a;
		border: 1px solid #333;
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
		color: #666;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
	}

	.album-card-meta h3 {
		margin: 0 0 0.35rem 0;
		font-size: 1.05rem;
		color: #fafafa;
		text-transform: lowercase;
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
		color: #9a9a9a;
		font-size: 0.9rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.album-card-meta .dot {
		font-size: 0.65rem;
		color: #555;
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
		text-decoration: none;
		display: block;
		cursor: pointer;
	}

	.stat-card.top-item:hover {
		border-color: var(--accent);
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(138, 179, 255, 0.2);
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
			padding-bottom: calc(var(--player-height, 10rem) + env(safe-area-inset-bottom, 0px));
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
	}
</style>
