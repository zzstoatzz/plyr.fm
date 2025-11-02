<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { API_URL } from '$lib/config';
	import type { Track, Artist } from '$lib/types';
	import TrackItem from '$lib/components/TrackItem.svelte';
	import Header from '$lib/components/Header.svelte';
	import { player } from '$lib/player.svelte';

	let handle = $derived($page.params.handle);
	let artist: Artist | null = $state(null);
	let tracks: Track[] = $state([]);
	let loading = $state(true);
	let error = $state('');

	async function loadArtistAndTracks() {
		loading = true;
		error = '';

		try {
			// fetch artist info (handle already has @ stripped by SvelteKit)
			const artistResponse = await fetch(`${API_URL}/artists/${handle}`);
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
			console.error(e);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		loadArtistAndTracks();
	});
</script>

{#if loading}
	<div class="loading">loading...</div>
{:else if error}
	<div class="error-container">
		<h1>{error}</h1>
		<a href="/">go home</a>
	</div>
{:else if artist}
	<Header user={null} onLogout={() => {}} />

	<main>
		<section class="artist-header">
			{#if artist.avatar_url}
				<img src={artist.avatar_url} alt={artist.display_name} class="artist-avatar" />
			{/if}
			<div class="artist-info">
				<h1>{artist.display_name}</h1>
				<p class="handle">@{artist.handle}</p>
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
		color: #6a9fff;
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
