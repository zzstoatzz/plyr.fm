<script lang="ts">
	import { onMount } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import { auth } from '$lib/auth.svelte';
	import { API_URL } from '$lib/config';
	import { APP_NAME } from '$lib/branding';
	import { statsCache, formatDuration } from '$lib/stats.svelte';
	import type { ActivityEvent } from '$lib/types';

	let { data } = $props();

	let events = $state<ActivityEvent[]>([]);
	let nextCursor = $state<string | null>(null);
	let hasMore = $state(false);
	let loadingMore = $state(false);
	let initialLoad = $state(true);

	let sentinelElement = $state<HTMLDivElement | null>(null);

	let stats = $derived(statsCache.stats);

	onMount(() => {
		auth.initialize();
		statsCache.fetch();
		events = data.events;
		nextCursor = data.next_cursor;
		hasMore = data.has_more;
		initialLoad = false;
	});

	function timeAgo(iso: string): string {
		const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
		if (seconds < 60) return `${seconds}s ago`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 30) return `${days}d ago`;
		const months = Math.floor(days / 30);
		if (months < 12) return `${months}mo ago`;
		const years = Math.floor(days / 365);
		return `${years}y ago`;
	}

	async function loadMore() {
		if (!hasMore || !nextCursor || loadingMore) return;
		loadingMore = true;
		try {
			const response = await fetch(`${API_URL}/activity/?cursor=${nextCursor}`);
			if (response.ok) {
				const result = await response.json();
				events = [...events, ...result.events];
				nextCursor = result.next_cursor;
				hasMore = result.has_more;
			}
		} catch (e) {
			console.error('failed to load more activity:', e);
		} finally {
			loadingMore = false;
		}
	}

	$effect(() => {
		if (!sentinelElement) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting && hasMore && !loadingMore) {
					loadMore();
				}
			},
			{ rootMargin: '200px' }
		);

		observer.observe(sentinelElement);

		return () => {
			observer.disconnect();
		};
	});

	async function logout() {
		await auth.logout();
		window.location.href = '/';
	}
</script>

<svelte:head>
	<title>activity - {APP_NAME}</title>
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={logout} />

<main>
	<!-- stats-informed ambient header -->
	<div class="page-header">
		<h1>activity</h1>
		{#if stats}
			<p class="header-pulse">
				{stats.total_tracks.toLocaleString()} tracks &middot;
				{stats.total_artists.toLocaleString()} artists &middot;
				{formatDuration(stats.total_duration_seconds)} of audio
			</p>
		{/if}
	</div>

	{#if initialLoad}
		<div class="loading-container">
			<WaveLoading size="lg" message="loading activity..." />
		</div>
	{:else if events.length === 0}
		<p class="empty">no activity yet</p>
	{:else}
		<div class="event-list">
			{#each events as event (event.created_at + event.actor.did + event.type)}
				<div class="event-item {event.type}">
					<a href="/u/{event.actor.handle}" class="avatar-link">
						{#if event.actor.avatar_url}
							<img
								src={event.actor.avatar_url}
								alt={event.actor.display_name}
								class="avatar"
							/>
						{:else}
							<div class="avatar placeholder">
								<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
									<circle cx="8" cy="5" r="3" fill="none" />
									<path d="M3 14c0-2.5 2-4.5 5-4.5s5 2 5 4.5" stroke-linecap="round" />
								</svg>
							</div>
						{/if}
					</a>

					<div class="event-body">
						<div class="event-header">
							<a href="/u/{event.actor.handle}" class="handle-link">
								{event.actor.display_name || event.actor.handle}
							</a>
							<span class="event-time">{timeAgo(event.created_at)}</span>
						</div>

						{#if event.type === 'like' && event.track}
							<p class="event-action">
								<svg class="action-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
								liked <a href="/track/{event.track.id}" class="track-link">{event.track.title}</a>
							</p>
						{:else if event.type === 'track' && event.track}
							<p class="event-action">
								<svg class="action-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
								shared <a href="/track/{event.track.id}" class="track-link">{event.track.title}</a>
							</p>
						{:else if event.type === 'comment' && event.track}
							<p class="event-action">
								<svg class="action-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
								commented on <a href="/track/{event.track.id}" class="track-link">{event.track.title}</a>
							</p>
						{:else if event.type === 'join'}
							<p class="event-action">
								<svg class="action-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
								joined plyr.fm
							</p>
						{/if}

						{#if event.type === 'comment' && event.comment_text}
							<p class="comment-preview">
								{event.comment_text.length > 120
									? event.comment_text.slice(0, 120) + '...'
									: event.comment_text}
							</p>
						{/if}
					</div>

					<!-- track artwork for events that reference a track -->
					{#if event.track}
						<a href="/track/{event.track.id}" class="track-art-link">
							{#if event.track.thumbnail_url || event.track.image_url}
								<img
									src={event.track.thumbnail_url || event.track.image_url}
									alt={event.track.title}
									class="track-art"
								/>
							{:else}
								<div class="track-art track-art-placeholder">
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
										<polygon points="5 3 19 12 5 21 5 3"></polygon>
									</svg>
								</div>
							{/if}
						</a>
					{/if}
				</div>
			{/each}
		</div>

		{#if hasMore}
			<div bind:this={sentinelElement} class="scroll-sentinel">
				{#if loadingMore}
					<WaveLoading size="sm" message="loading more..." />
				{/if}
			</div>
		{/if}
	{/if}
</main>

<style>
	main {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 1rem calc(var(--player-height, 0px) + 2rem + env(safe-area-inset-bottom, 0px));
	}

	.page-header {
		margin-bottom: 1.5rem;
	}

	h1 {
		font-size: var(--text-page-heading);
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}

	.header-pulse {
		font-size: var(--text-xs);
		color: var(--text-muted);
		margin: 0.25rem 0 0 0;
		letter-spacing: 0.01em;
	}

	.loading-container {
		display: flex;
		justify-content: center;
		padding: 3rem 2rem;
	}

	.empty {
		color: var(--text-tertiary);
		padding: 2rem;
		text-align: center;
	}

	.event-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.event-item {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 0.75rem 1rem;
		background: var(--track-bg);
		border: 1px solid var(--track-border);
		border-radius: var(--radius-md);
		border-left: 3px solid var(--border-subtle);
		transition: all 0.15s ease;
	}

	.event-item:hover {
		background: var(--track-bg-hover);
		border-color: color-mix(in srgb, var(--accent) 20%, var(--track-border));
	}

	/* per-type left accent */
	.event-item.like { border-left-color: #e0607e; }
	.event-item.like:hover { border-left-color: #e87a94; }
	.event-item.track { border-left-color: var(--accent); }
	.event-item.track:hover { border-left-color: var(--accent-hover, var(--accent)); }
	.event-item.comment { border-left-color: #a78bfa; }
	.event-item.comment:hover { border-left-color: #b9a2fb; }
	.event-item.join { border-left-color: #4ade80; }
	.event-item.join:hover { border-left-color: #6ee7a0; }

	.avatar-link {
		flex-shrink: 0;
	}

	.avatar {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		object-fit: cover;
	}

	.avatar.placeholder {
		background: var(--bg-tertiary);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}

	.event-body {
		flex: 1;
		min-width: 0;
	}

	.event-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.125rem;
	}

	.handle-link {
		color: var(--text-primary);
		font-weight: 600;
		font-size: var(--text-sm);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.handle-link:hover {
		color: var(--accent);
	}

	.event-time {
		flex-shrink: 0;
		font-size: var(--text-xs);
		color: var(--text-muted);
		white-space: nowrap;
	}

	.event-action {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		margin: 0;
		line-height: 1.4;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.action-icon {
		flex-shrink: 0;
		opacity: 0.5;
	}

	.like .action-icon { color: #e0607e; }
	.track .action-icon { color: var(--accent); }
	.comment .action-icon { color: #a78bfa; }
	.join .action-icon { color: #4ade80; }

	.track-link {
		color: var(--text-secondary);
		text-decoration: none;
		font-weight: 500;
	}

	.track-link:hover {
		color: var(--accent);
	}

	.comment-preview {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		margin: 0.375rem 0 0 0;
		line-height: 1.4;
		font-style: italic;
		background: color-mix(in srgb, var(--accent) 5%, transparent);
		border-left: 2px solid color-mix(in srgb, #a78bfa 40%, transparent);
		padding: 0.375rem 0.625rem;
		border-radius: var(--radius-sm);
	}

	/* track artwork on the right side of the card */
	.track-art-link {
		flex-shrink: 0;
	}

	.track-art {
		width: 44px;
		height: 44px;
		border-radius: var(--radius-sm);
		object-fit: cover;
	}

	.track-art-placeholder {
		background: var(--bg-tertiary);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}

	.scroll-sentinel {
		display: flex;
		justify-content: center;
		padding: 2rem 0;
		min-height: 60px;
	}

	@media (max-width: 768px) {
		main {
			padding: 0 0.75rem calc(var(--player-height, 0px) + 1.25rem + env(safe-area-inset-bottom, 0px));
		}

		.avatar {
			width: 36px;
			height: 36px;
		}

		.track-art {
			width: 38px;
			height: 38px;
		}
	}
</style>
