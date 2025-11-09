<script lang="ts">
	import { onMount } from 'svelte';
	import TrackItem from '$lib/components/TrackItem.svelte';
	import Header from '$lib/components/Header.svelte';
	import NotificationZone from '$lib/components/NotificationZone.svelte';
	import type { User } from '$lib/types';
	import { API_URL } from '$lib/config';
import { player } from '$lib/player.svelte';
import { queue } from '$lib/queue.svelte';
	import { tracksCache } from '$lib/tracks.svelte';

	let user = $state<User | null>(null);
	let isAuthenticated = $state(false);

	// use cached tracks
	let tracks = $derived(tracksCache.tracks);
	let loadingTracks = $derived(tracksCache.loading);
	let hasTracks = $derived(tracks.length > 0);
	// only show loading if we don't have cached data
	let showLoading = $derived(loadingTracks && !hasTracks);

	onMount(async () => {
		// check authentication (non-blocking)
		try {
			const sessionId = localStorage.getItem('session_id');
			const authResponse = await fetch(`${API_URL}/auth/me`, {
				headers: {
					'Authorization': `Bearer ${sessionId}`
				}
			});
			if (authResponse.ok) {
				user = await authResponse.json();
				isAuthenticated = true;
			}
		} catch (e) {
			// network error or not authenticated - continue as guest
			console.warn('failed to check auth status:', e);
		}

		// fetch tracks from cache (will use cached data if recent)
		tracksCache.fetch();
	});

	async function logout() {
		const sessionId = localStorage.getItem('session_id');
		await fetch(`${API_URL}/auth/logout`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${sessionId}`
			}
		});
		user = null;
		isAuthenticated = false;
	}
</script>

<Header {user} {isAuthenticated} onLogout={logout} />

<main>
	<NotificationZone />

	<section class="tracks">
		<h2>latest tracks</h2>
		{#if showLoading}
			<p class="loading-text">loading tracks...</p>
		{:else if !hasTracks}
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

<style>
	.loading-text {
		color: #808080;
		padding: 2rem;
		text-align: center;
	}

	main {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 1rem calc(var(--player-height, 120px) + env(safe-area-inset-bottom, 0px));
	}

	.tracks h2 {
		font-size: 1.5rem;
		margin-bottom: 1.5rem;
		color: #e8e8e8;
	}

	.empty {
		color: #808080;
		padding: 2rem;
		text-align: center;
	}

	.track-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
</style>
