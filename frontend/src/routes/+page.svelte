<script lang="ts">
	import { onMount } from 'svelte';
	import TrackItem from '$lib/components/TrackItem.svelte';
	import Header from '$lib/components/Header.svelte';
	import type { Track, User } from '$lib/types';
	import { API_URL } from '$lib/config';
	import { player } from '$lib/player.svelte';

	let tracks = $state<Track[]>([]);
	let user = $state<User | null>(null);
	let loading = $state(true);

	// derived values
	let hasTracks = $derived(tracks.length > 0);
	let isAuthenticated = $derived(user !== null);

	onMount(async () => {
		// check authentication
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
				} else {
					// invalid session, clear it
					localStorage.removeItem('session_id');
				}
			} catch (e) {
				// not authenticated, that's fine
				localStorage.removeItem('session_id');
			}
		}

		// load tracks
		const response = await fetch(`${API_URL}/tracks/`);
		const data = await response.json();
		tracks = data.tracks;

		loading = false;
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
	}
</script>

{#if loading}
	<div class="loading">loading...</div>
{:else}
	<Header {user} onLogout={logout} />

	<main>

	<section class="tracks">
		<h2>latest tracks</h2>
		{#if !hasTracks}
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
	.loading {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		color: #888;
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
