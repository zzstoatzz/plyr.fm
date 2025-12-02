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
	<title>{data.tag?.name ?? 'tag'} • plyr</title>
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

<div class="page">
	{#if data.error}
		<div class="empty-state">
			<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
				<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
				<line x1="7" y1="7" x2="7.01" y2="7"></line>
			</svg>
			<h2>{data.error}</h2>
			<p><a href="/">back to home</a></p>
		</div>
	{:else if data.tag}
		<header class="page-header">
			<div class="header-top">
				<div>
					<h1>
						<svg class="tag-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
							<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
							<line x1="7" y1="7" x2="7.01" y2="7"></line>
						</svg>
						{data.tag.name}
					</h1>
					<p class="subtitle">
						{data.tag.track_count} {data.tag.track_count === 1 ? 'track' : 'tracks'}
					</p>
				</div>
				{#if data.tracks.length > 0}
					<button class="btn-queue-all" onclick={queueAll} title="queue all tracks">
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
					<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
					<line x1="7" y1="7" x2="7.01" y2="7"></line>
				</svg>
				<h2>no tracks with this tag</h2>
				<p>tracks tagged with #{data.tag.name} will appear here</p>
			</div>
		{:else}
			<div class="tracks-list">
				{#each data.tracks as track, i (track.id)}
					<TrackItem
						{track}
						index={i}
						isPlaying={player.currentTrack?.id === track.id && !player.paused}
						onPlay={playTrack}
						isAuthenticated={auth.isAuthenticated}
					/>
				{/each}
			</div>
		{/if}
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
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.page-header h1 {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: var(--text-page-heading);
		font-weight: 700;
		color: #8ab3ff;
		margin: 0 0 0.5rem 0;
	}

	.tag-icon {
		flex-shrink: 0;
	}

	.subtitle {
		font-size: 0.95rem;
		color: var(--text-tertiary);
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
		color: var(--text-tertiary);
	}

	.empty-state svg {
		margin: 0 auto 1.5rem;
		color: var(--text-muted);
	}

	.empty-state h2 {
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin: 0 0 0.5rem 0;
	}

	.empty-state p {
		font-size: 0.95rem;
		margin: 0;
	}

	.empty-state a {
		color: var(--accent);
		text-decoration: none;
	}

	.empty-state a:hover {
		text-decoration: underline;
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

		.tag-icon {
			width: 20px;
			height: 20px;
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

		.tag-icon {
			width: 18px;
			height: 18px;
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
