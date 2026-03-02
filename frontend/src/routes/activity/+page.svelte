<script lang="ts">
	import { onMount } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import { auth } from '$lib/auth.svelte';
	import { API_URL } from '$lib/config';
	import { APP_NAME } from '$lib/branding';
	import type { ActivityEvent } from '$lib/types';

	let { data } = $props();

	let events = $state<ActivityEvent[]>([]);
	let nextCursor = $state<string | null>(null);
	let hasMore = $state(false);
	let loadingMore = $state(false);
	let initialLoad = $state(true);

	let sentinelElement = $state<HTMLDivElement | null>(null);

	onMount(() => {
		auth.initialize();
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

	// infinite scroll via IntersectionObserver
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
	<h1>activity</h1>

	{#if initialLoad}
		<div class="loading-container">
			<WaveLoading size="lg" message="loading activity..." />
		</div>
	{:else if events.length === 0}
		<p class="empty">no activity yet</p>
	{:else}
		<div class="event-list">
			{#each events as event (event.created_at + event.actor.did + event.type)}
				<div class="event-item">
					<a href="/u/{event.actor.handle}" class="avatar-link">
						{#if event.actor.avatar_url}
							<img
								src={event.actor.avatar_url}
								alt={event.actor.display_name}
								class="avatar"
							/>
						{:else}
							<div class="avatar placeholder"></div>
						{/if}
					</a>

					<div class="event-body">
						<div class="event-row">
							<p class="event-description">
								<span class="event-icon">
									{#if event.type === 'like'}
										<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
									{:else if event.type === 'track'}
										<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6zM10 19a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>
									{:else if event.type === 'comment'}
										<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z"/></svg>
									{:else if event.type === 'join'}
										<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.09 6.26L20.18 9l-5.09 3.74L17.18 19 12 15.27 6.82 19l2.09-6.26L3.82 9l6.09-.74L12 2z"/></svg>
									{/if}
								</span>

								<span class="event-text">
									<a href="/u/{event.actor.handle}" class="handle-link">
										{event.actor.display_name || event.actor.handle}
									</a>

									{#if event.type === 'like' && event.track}
										<span class="action-verb">liked</span>
										<a href="/track/{event.track.id}" class="track-link">
											{event.track.title}
										</a>
									{:else if event.type === 'track' && event.track}
										<span class="action-verb">posted</span>
										<a href="/track/{event.track.id}" class="track-link">
											{event.track.title}
										</a>
									{:else if event.type === 'comment' && event.track}
										<span class="action-verb">commented on</span>
										<a href="/track/{event.track.id}" class="track-link">
											{event.track.title}
										</a>
									{:else if event.type === 'join'}
										<span class="action-verb">joined plyr.fm</span>
									{/if}
								</span>
							</p>

							<span class="event-time">{timeAgo(event.created_at)}</span>
						</div>

						{#if event.type === 'comment' && event.comment_text}
							<p class="comment-preview">
								{event.comment_text.length > 100
									? event.comment_text.slice(0, 100) + '...'
									: event.comment_text}
							</p>
						{/if}
					</div>
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

	h1 {
		font-size: var(--text-page-heading);
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 1.5rem 0;
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
		gap: 0.5rem;
	}

	.event-item {
		display: flex;
		gap: 0.75rem;
		padding: 0.75rem;
		background: var(--track-bg);
		border: 1px solid var(--track-border);
		border-radius: var(--radius-md);
		transition: all 0.15s ease;
	}

	.event-item:hover {
		background: var(--track-bg-hover);
		border-color: color-mix(in srgb, var(--accent) 25%, var(--track-border));
	}

	.avatar-link {
		flex-shrink: 0;
	}

	.avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid var(--border-subtle);
	}

	.avatar.placeholder {
		background: var(--bg-tertiary);
	}

	.event-body {
		flex: 1;
		min-width: 0;
	}

	.event-row {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}

	.event-description {
		flex: 1;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		margin: 0;
		line-height: 1.4;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
	}

	.event-icon {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		color: var(--text-tertiary);
		position: relative;
		top: 2px;
	}

	.event-text {
		min-width: 0;
	}

	.action-verb {
		color: var(--text-tertiary);
	}

	.handle-link {
		color: var(--text-primary);
		font-weight: 600;
		text-decoration: none;
	}

	.handle-link:hover {
		color: var(--accent);
	}

	.track-link {
		color: var(--text-primary);
		text-decoration: none;
		font-weight: 500;
	}

	.track-link:hover {
		color: var(--accent);
	}

	.comment-preview {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		margin: 0.5rem 0 0 0;
		line-height: 1.4;
		font-style: italic;
		background: color-mix(in srgb, var(--accent) 5%, transparent);
		border-left: 2px solid var(--accent);
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-sm);
	}

	.event-time {
		flex-shrink: 0;
		font-size: var(--text-xs);
		color: var(--text-muted);
		white-space: nowrap;
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
	}
</style>
