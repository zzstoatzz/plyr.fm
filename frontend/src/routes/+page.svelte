<script lang="ts">
	import { onMount } from 'svelte';
	import TrackItem from '$lib/components/TrackItem.svelte';
	import Header from '$lib/components/Header.svelte';
	import type { User } from '$lib/types';
	import { API_URL } from '$lib/config';
	import { player } from '$lib/player.svelte';
	import { tracksCache } from '$lib/tracks.svelte';

	// optimistically check for session at init to prevent flash of logged-out state
	const hasSession = typeof window !== 'undefined' && !!localStorage.getItem('session_id');

	let user = $state<User | null>(null);
	let isAuthenticated = $state(hasSession);

	// use cached tracks
	let tracks = $derived(tracksCache.tracks);
	let loadingTracks = $derived(tracksCache.loading);
	let hasTracks = $derived(tracks.length > 0);

	onMount(async () => {
		// check authentication (non-blocking)
		const sessionId = localStorage.getItem('session_id');
		if (sessionId) {
			try {
				const authResponse = await fetch(`${API_URL}/auth/me`, {
					headers: {
						'Authorization': `Bearer ${sessionId}`
					}
				});
				if (authResponse.ok) {
					user = await authResponse.json();
					isAuthenticated = true;
				} else if (authResponse.status === 401) {
					// only clear session on explicit 401 (unauthorized)
					localStorage.removeItem('session_id');
					isAuthenticated = false;
				}
				// ignore other errors (network issues, 500s, etc.) - keep optimistic auth state
			} catch (e) {
				// network error - don't clear session or change auth state
				console.warn('failed to check auth status:', e);
			}
		} else {
			isAuthenticated = false;
		}

		// fetch tracks from cache (will use cached data if recent)
		tracksCache.fetch();
	});

	async function logout() {
		const sessionId = localStorage.getItem('session_id');
		if (sessionId) {
			await fetch(`${API_URL}/auth/logout`, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${sessionId}`
				}
			});
		}
		localStorage.removeItem('session_id');
		user = null;
		isAuthenticated = false;
	}
</script>

<Header {user} {isAuthenticated} onLogout={logout} />

<main>
	<section class="tracks">
		<h2>latest tracks</h2>
		{#if loadingTracks}
			<p class="loading-text">loading tracks...</p>
		{:else if !hasTracks}
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

<style>
	.loading-text {
		color: #808080;
		padding: 2rem;
		text-align: center;
	}

	main {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 1rem 120px;
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
