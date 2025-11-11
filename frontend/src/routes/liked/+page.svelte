<script lang="ts">
	import { onMount } from 'svelte';
	import TrackItem from '$lib/components/TrackItem.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import { fetchLikedTracks } from '$lib/tracks.svelte';
	import { player } from '$lib/player.svelte';
	import type { Track } from '$lib/types';

	let tracks = $state<Track[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	onMount(async () => {
		try {
			tracks = await fetchLikedTracks();
		} catch (e) {
			error = 'failed to load liked tracks';
			console.error(e);
		} finally {
			loading = false;
		}
	});

	function playTrack(track: Track) {
		player.playTrack(track);
	}
</script>

<svelte:head>
	<title>liked tracks • plyr</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<h1>liked tracks</h1>
		{#if !loading && tracks.length > 0}
			<p class="subtitle">{tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}</p>
		{/if}
	</header>

	{#if loading}
		<div class="loading-container">
			<LoadingSpinner />
		</div>
	{:else if error}
		<div class="error-message">
			<p>{error}</p>
		</div>
	{:else if tracks.length === 0}
		<div class="empty-state">
			<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
				<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
			</svg>
			<h2>no liked tracks yet</h2>
			<p>tracks you like will appear here</p>
		</div>
	{:else}
		<div class="tracks-list">
			{#each tracks as track (track.id)}
				<TrackItem
					{track}
					isPlaying={player.currentTrack?.id === track.id && !player.paused}
					onPlay={playTrack}
					isAuthenticated={true}
				/>
			{/each}
		</div>
	{/if}
</div>

<style>
	.page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem 1.5rem;
	}

	.page-header {
		margin-bottom: 2rem;
	}

	.page-header h1 {
		font-size: 2rem;
		font-weight: 700;
		color: #e8e8e8;
		margin: 0 0 0.5rem 0;
	}

	.subtitle {
		font-size: 0.95rem;
		color: #888;
		margin: 0;
	}

	.loading-container {
		display: flex;
		justify-content: center;
		align-items: center;
		min-height: 400px;
	}

	.error-message {
		text-align: center;
		padding: 3rem 1rem;
		color: #ff6b6b;
	}

	.empty-state {
		text-align: center;
		padding: 4rem 1rem;
		color: #888;
	}

	.empty-state svg {
		margin: 0 auto 1.5rem;
		color: #555;
	}

	.empty-state h2 {
		font-size: 1.5rem;
		font-weight: 600;
		color: #b0b0b0;
		margin: 0 0 0.5rem 0;
	}

	.empty-state p {
		font-size: 0.95rem;
		margin: 0;
	}

	.tracks-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	@media (max-width: 768px) {
		.page {
			padding: 1.5rem 1rem;
		}

		.page-header h1 {
			font-size: 1.5rem;
		}

		.empty-state {
			padding: 3rem 1rem;
		}

		.empty-state h2 {
			font-size: 1.25rem;
		}
	}
</style>
