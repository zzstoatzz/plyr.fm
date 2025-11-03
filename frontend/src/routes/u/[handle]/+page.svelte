<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { API_URL } from '$lib/config';
	import type { Track, Artist, User } from '$lib/types';
	import TrackItem from '$lib/components/TrackItem.svelte';
	import Header from '$lib/components/Header.svelte';
	import { player } from '$lib/player.svelte';
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
							error = "this person hasn't posted any music on relay yet";
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

	onMount(() => {
		checkAuth();
		loadArtistAndTracks();
	});
</script>

<svelte:head>
	{#if data.artist}
		<title>{data.artist.display_name} (@{data.artist.handle}) - relay</title>
		<meta name="description" content="listen to music by {data.artist.display_name} on relay" />

		<!-- Open Graph / Facebook -->
		<meta property="og:type" content="profile" />
		<meta property="og:title" content="{data.artist.display_name} (@{data.artist.handle})" />
		<meta property="og:description" content="listen to music by {data.artist.display_name} on relay" />
		<meta property="og:url" content="https://relay.zzstoatzz.io/u/{data.artist.handle}" />
		<meta property="og:site_name" content="relay" />
		<meta property="profile:username" content="{data.artist.handle}" />
		{#if data.artist.avatar_url}
			<meta property="og:image" content="{data.artist.avatar_url}" />
		{/if}

		<!-- Twitter -->
		<meta name="twitter:card" content="summary" />
		<meta name="twitter:title" content="{data.artist.display_name} (@{data.artist.handle})" />
		<meta name="twitter:description" content="listen to music by {data.artist.display_name} on relay" />
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
							onPlay={(t) => player.playTrack(t)}
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
	}
</style>
