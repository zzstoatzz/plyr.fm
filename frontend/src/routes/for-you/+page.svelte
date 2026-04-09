<script lang="ts">
	import { onMount } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import TrackItem from '$lib/components/TrackItem.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import { auth } from '$lib/auth.svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { toast } from '$lib/toast.svelte';
	import { API_URL } from '$lib/config';
	import { APP_NAME } from '$lib/branding';
	import type { Track } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let tracks = $state<Track[]>([]);
	let nextCursor = $state<string | null>(null);
	let hasMore = $state(false);
	let loadingMore = $state(false);
	let showSpinner = $state(false);
	let sentinelElement = $state<HTMLDivElement | null>(null);
	let coldStart = $state(false);

	onMount(() => {
		auth.initialize();
		tracks = [...data.tracks];
		nextCursor = data.next_cursor;
		hasMore = data.has_more;
		coldStart = data.cold_start;
	});

	$effect(() => {
		if (loadingMore) {
			const timer = setTimeout(() => {
				showSpinner = true;
			}, 400);
			return () => {
				clearTimeout(timer);
				showSpinner = false;
			};
		} else {
			showSpinner = false;
		}
	});

	async function loadMore() {
		if (!hasMore || !nextCursor || loadingMore) return;
		loadingMore = true;
		try {
			const response = await fetch(
				`${API_URL}/for-you/?cursor=${encodeURIComponent(nextCursor)}`,
				{ credentials: 'include' }
			);
			if (response.ok) {
				const result = await response.json();
				tracks = [...tracks, ...result.tracks];
				nextCursor = result.next_cursor;
				hasMore = result.has_more;
			}
		} catch (e) {
			console.error('failed to load more recommendations:', e);
		} finally {
			loadingMore = false;
		}
	}

	$effect(() => {
		if (!sentinelElement) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting && hasMore && !loadingMore) loadMore();
			},
			{ rootMargin: '200px' }
		);
		observer.observe(sentinelElement);
		return () => observer.disconnect();
	});

	async function handleLogout() {
		await auth.logout();
		window.location.href = '/';
	}

	function playTrack(track: Track) {
		queue.playNow(track);
	}

	function queueAll() {
		if (tracks.length === 0) return;
		queue.addTracks(tracks);
		toast.success(`queued ${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}`);
	}
</script>

<svelte:head>
	<title>for you • {APP_NAME}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

<div class="page">
	<header class="page-header">
		<div class="header-top">
			<div class="header-text">
				<h1>for you</h1>
				{#if tracks.length > 0}
					<p class="subtitle">
						{#if coldStart}
							warming up — showing what's popular while we learn what you like
						{:else}
							personalized from your likes and playlist picks
						{/if}
					</p>
				{/if}
			</div>
			{#if tracks.length > 0}
				<button class="btn-queue-all" onclick={queueAll} title="queue all tracks">
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
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

	{#if tracks.length === 0 && !loadingMore}
		<div class="empty-state">
			{#if coldStart}
				<p>nothing to recommend yet.</p>
				<p class="empty-hint">
					the feed picks up once there's enough activity to learn from — like a few tracks or add
					them to playlists to get things going.
				</p>
			{:else}
				<p>no picks for you right now.</p>
				<p class="empty-hint">
					we've seen your taste but nothing new matches it yet — check back later, or like a few
					more tracks to broaden the signal.
				</p>
			{/if}
		</div>
	{:else}
		<div class="tracks-list">
			{#each tracks as track, i (track.id)}
				<TrackItem
					{track}
					index={i}
					isPlaying={player.currentTrack?.id === track.id && !player.paused}
					onPlay={playTrack}
					isAuthenticated={auth.isAuthenticated}
				/>
			{/each}
		</div>

		{#if hasMore}
			<div bind:this={sentinelElement} class="scroll-sentinel">
				{#if showSpinner}
					<WaveLoading size="sm" message="loading more..." />
				{/if}
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

	.header-text {
		min-width: 0;
	}

	.page-header h1 {
		font-size: var(--text-page-heading);
		font-weight: 700;
		color: var(--text-page-heading, var(--text-primary));
		margin: 0 0 0.35rem 0;
	}

	.subtitle {
		font-size: var(--text-sm);
		color: var(--text-muted);
		margin: 0;
		line-height: 1.4;
	}

	.btn-queue-all {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 1rem;
		background: var(--glass-btn-bg, transparent);
		border: 1px solid var(--glass-btn-border, var(--accent));
		color: var(--accent);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
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
		padding: 3rem 1rem;
		color: var(--text-muted);
		font-size: var(--text-sm);
		background: color-mix(in srgb, var(--track-bg) 60%, transparent);
		border: 1px dashed var(--border-subtle);
		border-radius: var(--radius-md);
	}

	.empty-state p {
		margin: 0;
		line-height: 1.5;
	}

	.empty-state p + p {
		margin-top: 0.5rem;
	}

	.empty-hint {
		color: var(--text-tertiary);
		font-size: var(--text-xs);
	}

	.tracks-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.scroll-sentinel {
		display: flex;
		justify-content: center;
		padding: 2rem 0;
		min-height: 60px;
	}

	@media (max-width: 768px) {
		.page {
			padding: 0 0.75rem calc(var(--player-height, 0px) + 1.25rem + env(safe-area-inset-bottom, 0px));
		}

		.page-header h1 {
			font-size: var(--text-2xl);
		}

		.btn-queue-all {
			padding: 0.5rem 0.75rem;
			font-size: var(--text-xs);
		}

		.btn-queue-all svg {
			width: 16px;
			height: 16px;
		}
	}
</style>
