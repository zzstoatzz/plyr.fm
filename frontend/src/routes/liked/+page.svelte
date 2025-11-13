<script lang="ts">
	import Header from '$lib/components/Header.svelte';
	import TrackItem from '$lib/components/TrackItem.svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { toast } from '$lib/toast.svelte';
	import { auth } from '$lib/auth.svelte';
	import type { Track } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	async function handleLogout() {
		await auth.logout();
		window.location.href = '/';
	}

	function playTrack(track: Track) {
		queue.playNow(track);
	}

	function queueAll() {
		if (data.tracks.length === 0) return;
		queue.addTracks(data.tracks);
		toast.success(`queued ${data.tracks.length} ${data.tracks.length === 1 ? 'track' : 'tracks'}`);
	}
</script>

<svelte:head>
	<title>liked tracks • plyr</title>
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

<div class="page">
	<header class="page-header">
		<div class="header-top">
			<div>
				<h1>liked tracks</h1>
				{#if data.tracks.length > 0}
					<p class="subtitle">{data.tracks.length} {data.tracks.length === 1 ? 'track' : 'tracks'}</p>
				{/if}
			</div>
			{#if data.tracks.length > 0}
				<button class="btn-queue-all" onclick={queueAll} title="queue all liked tracks">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="8" y1="6" x2="21" y2="6"></line>
						<line x1="8" y1="12" x2="21" y2="12"></line>
						<line x1="8" y1="18" x2="21" y2="18"></line>
						<line x1="3" y1="6" x2="3.01" y2="6"></line>
						<line x1="3" y1="12" x2="3.01" y2="12"></line>
						<line x1="3" y1="18" x2="3.01" y2="18"></line>
					</svg>
					<span>queue all</span>
				</button>
			{/if}
		</div>
	</header>

	{#if data.tracks.length === 0}
		<div class="empty-state">
			<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
				<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
			</svg>
			{#if !auth.isAuthenticated}
				<h2>log in to like tracks</h2>
				<p>you need to be logged in to like tracks</p>
			{:else}
				<h2>no liked tracks yet</h2>
				<p>tracks you like will appear here</p>
			{/if}
		</div>
	{:else}
		<div class="tracks-list">
			{#each data.tracks as track (track.id)}
				<TrackItem
					{track}
					isPlaying={player.currentTrack?.id === track.id && !player.paused}
					onPlay={playTrack}
					isAuthenticated={auth.isAuthenticated}
				/>
			{/each}
		</div>
	{/if}
</div>

<style>
	.page {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 1rem calc(var(--player-height, 0px) + 2rem + env(safe-area-inset-bottom, 0px));
		min-height: 100vh;
	}

	.page-header {
		margin-bottom: 1.5rem;
	}

	.header-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.page-header h1 {
		font-size: var(--text-page-heading);
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 0.5rem 0;
	}

	.subtitle {
		font-size: 0.95rem;
		color: #888;
		margin: 0;
	}

	.btn-queue-all {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 1rem;
		background: transparent;
		border: 1px solid var(--accent);
		color: var(--accent);
		border-radius: 6px;
		font-size: 0.9rem;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}

	.btn-queue-all:hover {
		background: var(--accent);
		color: var(--bg-primary);
	}

	.btn-queue-all svg {
		flex-shrink: 0;
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
			padding: 1.25rem 0.75rem calc(var(--player-height, 0px) + 1.25rem + env(safe-area-inset-bottom, 0px));
		}

		.page-header h1 {
			font-size: 1.35rem;
		}

		.empty-state {
			padding: 3rem 1rem;
		}

		.empty-state h2 {
			font-size: 1.25rem;
		}

		.btn-queue-all {
			padding: 0.5rem 0.75rem;
			font-size: 0.85rem;
		}

		.btn-queue-all svg {
			width: 18px;
			height: 18px;
		}
	}

	@media (max-width: 480px) {
		.page {
			padding: 1rem 0.65rem calc(var(--player-height, 0px) + 1rem + env(safe-area-inset-bottom, 0px));
		}

		.page-header {
			margin-bottom: 1.5rem;
		}

		.header-top {
			gap: 0.75rem;
		}

		.page-header h1 {
			font-size: 1.2rem;
			margin: 0 0 0.35rem 0;
		}

		.subtitle {
			font-size: 0.85rem;
		}

		.btn-queue-all {
			padding: 0.45rem 0.65rem;
			font-size: 0.8rem;
		}

		.btn-queue-all svg {
			width: 16px;
			height: 16px;
		}
	}
</style>
