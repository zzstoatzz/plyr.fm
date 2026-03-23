<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Header from '$lib/components/Header.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import { auth } from '$lib/auth.svelte';
	import { API_URL } from '$lib/config';
	import { APP_NAME } from '$lib/branding';
	import { statsCache, formatDuration } from '$lib/stats.svelte';
	import type { ActivityEvent, ActivityHistogramBucket } from '$lib/types';

	let { data } = $props();

	let events = $state<ActivityEvent[]>([]);
	let nextCursor = $state<string | null>(null);
	let hasMore = $state(false);
	let loadingMore = $state(false);
	let initialLoad = $state(true);
	let sentinelElement = $state<HTMLDivElement | null>(null);
	let stats = $derived(statsCache.stats);
	let histogram = $state<ActivityHistogramBucket[]>([]);
	let previousCount = $state(0);
	let showSpinner = $state(false);

	$effect(() => {
		if (loadingMore) {
			const timer = setTimeout(() => { showSpinner = true; }, 400);
			return () => { clearTimeout(timer); showSpinner = false; };
		} else {
			showSpinner = false;
		}
	});

	const sparklinePath = $derived.by(() => {
		if (histogram.length === 0) return '';
		const max = Math.max(...histogram.map((b) => b.count), 1);
		const w = 100;
		const h = 32;
		const step = w / (histogram.length - 1 || 1);
		const points = histogram.map((b, i) => `${i * step},${h - (b.count / max) * h * 0.85}`);
		return `M${points.join(' L')} L${w},${h} L0,${h} Z`;
	});

	onMount(() => {
		auth.initialize();
		statsCache.fetch();
		previousCount = data.events.length;
		events = data.events;
		nextCursor = data.next_cursor;
		hasMore = data.has_more;
		histogram = data.histogram;
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
		return `${Math.floor(days / 365)}y ago`;
	}

	async function loadMore() {
		if (!hasMore || !nextCursor || loadingMore) return;
		loadingMore = true;
		try {
			const response = await fetch(`${API_URL}/activity/?cursor=${encodeURIComponent(nextCursor)}`);
			if (response.ok) {
				const result = await response.json();
				previousCount = events.length;
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
				if (entries[0].isIntersecting && hasMore && !loadingMore) loadMore();
			},
			{ rootMargin: '200px' }
		);
		observer.observe(sentinelElement);
		return () => observer.disconnect();
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

<div class="lava-bg" aria-hidden="true">
	<div class="lava-blob b1"></div>
	<div class="lava-blob b2"></div>
	<div class="lava-blob b3"></div>
	<div class="lava-blob b4"></div>
	<div class="lava-blob b5"></div>
</div>

<main>
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

	{#if histogram.some(b => b.count > 0)}
		<div class="sparkline-container">
			<span class="sparkline-label">last 7 days</span>
			<svg class="sparkline" viewBox="0 0 100 32" preserveAspectRatio="none">
				<defs>
					<linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stop-color="var(--accent)" stop-opacity="0.3" />
						<stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02" />
					</linearGradient>
				</defs>
				<path d={sparklinePath} fill="url(#spark-fill)" />
				<path
					d={sparklinePath.replace(/ L\d+,32 L0,32 Z/, '')}
					fill="none" stroke="var(--accent)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"
				/>
			</svg>
		</div>
	{/if}

	{#if initialLoad}
		<div class="loading-container">
			<WaveLoading size="lg" message="loading activity..." />
		</div>
	{:else if events.length === 0}
		<p class="empty">no activity yet</p>
	{:else}
		<div class="event-list">
			{#each events as event, i (event.created_at + event.actor.did + event.type + (event.collection?.id ?? ''))}
				{@const hasArt = event.track && (event.track.thumbnail_url || event.track.image_url)}
				{@const batchIndex = i >= previousCount ? i - previousCount : -1}
				{@const isSelfAction = event.track && event.actor.handle === event.track.artist_handle}
				<div
					class="event-item {event.type}"
					in:fly={{ y: 12, duration: batchIndex >= 0 ? 280 : 0, delay: batchIndex >= 0 ? batchIndex * 35 : 0, easing: cubicOut }}
				>
					<div class="left-col">
						{#if hasArt && event.track}
							<a href="/track/{event.track.id}" class="art-link">
								<img src={event.track.thumbnail_url || event.track.image_url} alt={event.track.title} class="art-img" />
							</a>
						{:else if event.collection?.image_url}
							<a href={event.collection.type === 'album' ? `/u/${event.collection.owner_handle}/album/${event.collection.slug}` : `/playlist/${event.collection.id}`} class="art-link">
								<img src={event.collection.image_url} alt={event.collection.name} class="art-img" />
							</a>
						{:else}
							<a href="/u/{event.actor.handle}" class="art-link">
								{#if event.actor.avatar_url}
									<img src={event.actor.avatar_url} alt={event.actor.display_name} class="art-img" />
								{:else}
									<div class="art-img art-placeholder">
										<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
											<circle cx="8" cy="5" r="3" fill="none" /><path d="M3 14c0-2.5 2-4.5 5-4.5s5 2 5 4.5" stroke-linecap="round" />
										</svg>
									</div>
								{/if}
							</a>
						{/if}
					</div>

					<div class="event-body">
						<div class="event-header">
							<div class="handle-group">
								{#if hasArt}
									<a href="/u/{event.actor.handle}" class="header-avatar-link">
										{#if event.actor.avatar_url}
											<img src={event.actor.avatar_url} alt={event.actor.display_name} class="header-avatar" />
										{:else}
											<span class="header-avatar header-avatar-placeholder">
												<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
													<circle cx="8" cy="5" r="3" fill="none" /><path d="M3 14c0-2.5 2-4.5 5-4.5s5 2 5 4.5" stroke-linecap="round" />
												</svg>
											</span>
										{/if}
									</a>
								{/if}
								<a href="/u/{event.actor.handle}" class="handle-link">
									{event.actor.display_name || event.actor.handle}
								</a>
							</div>
							<span class="event-time" title={new Date(event.created_at).toLocaleString()}>{timeAgo(event.created_at)}</span>
						</div>
						{#if event.type === 'like' && event.track}
							<p class="event-action">
								<span class="icon-slot"><svg class="action-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></span>
								<span class="verb">liked</span> <a href="/track/{event.track.id}" class="track-link">{event.track.title}</a>
								{#if event.track.artist_handle && !isSelfAction}
									<span class="by-artist">by</span>
									<a href="/u/{event.track.artist_handle}" class="artist-avatar-link" title={event.track.artist_handle}>
										{#if event.track.artist_avatar_url}
											<img src={event.track.artist_avatar_url} alt={event.track.artist_handle} class="inline-avatar" />
										{:else}
											<span class="inline-avatar inline-avatar-placeholder">
												<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
													<circle cx="8" cy="5" r="3" fill="none" /><path d="M3 14c0-2.5 2-4.5 5-4.5s5 2 5 4.5" stroke-linecap="round" />
												</svg>
											</span>
										{/if}
									</a>
								{/if}
							</p>
						{:else if event.type === 'track' && event.track}
							<p class="event-action">
								<span class="icon-slot"><svg class="action-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></span>
								<span class="verb">uploaded</span> <a href="/track/{event.track.id}" class="track-link">{event.track.title}</a>
							</p>
						{:else if event.type === 'comment' && event.track}
							<p class="event-action">
								<span class="icon-slot"><svg class="action-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>
								<span class="verb">commented on</span> <a href="/track/{event.track.id}" class="track-link">{event.track.title}</a>
								{#if event.track.artist_handle && !isSelfAction}
									<span class="by-artist">by</span>
									<a href="/u/{event.track.artist_handle}" class="artist-avatar-link" title={event.track.artist_handle}>
										{#if event.track.artist_avatar_url}
											<img src={event.track.artist_avatar_url} alt={event.track.artist_handle} class="inline-avatar" />
										{:else}
											<span class="inline-avatar inline-avatar-placeholder">
												<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
													<circle cx="8" cy="5" r="3" fill="none" /><path d="M3 14c0-2.5 2-4.5 5-4.5s5 2 5 4.5" stroke-linecap="round" />
												</svg>
											</span>
										{/if}
									</a>
								{/if}
							</p>
						{:else if event.type === 'join'}
							<p class="event-action">
								<span class="icon-slot"><svg class="action-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg></span>
								<span class="verb">joined</span> plyr.fm
							</p>
						{:else if event.type === 'playlist_create' && event.collection}
							<p class="event-action">
								<span class="icon-slot"><svg class="action-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></span>
								<span class="verb">created playlist</span> <a href="/playlist/{event.collection.id}" class="track-link">{event.collection.name}</a>
							</p>
						{:else if event.type === 'album_release' && event.collection}
							<p class="event-action">
								<span class="icon-slot"><svg class="action-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg></span>
								<span class="verb">released</span> <a href="/u/{event.collection.owner_handle}/album/{event.collection.slug}" class="track-link">{event.collection.name}</a>
							</p>
						{:else if event.type === 'track_added_to_playlist' && event.collection}
							<p class="event-action">
								<span class="icon-slot"><svg class="action-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg></span>
								<span class="verb">added</span>
								{#if event.track}
									<a href="/track/{event.track.id}" class="track-link">{event.track.title}</a>
									<span class="by-artist">to</span>
								{/if}
								<a href="/playlist/{event.collection.id}" class="track-link">{event.collection.name}</a>
							</p>
						{/if}
						{#if event.type === 'comment' && event.comment_text}
							<p class="comment-preview">
								{event.comment_text.length > 120 ? event.comment_text.slice(0, 120) + '...' : event.comment_text}
							</p>
						{/if}
					</div>
				</div>
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
</main>

<style>
	.lava-bg { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
	.lava-blob {
		position: absolute; border-radius: 50%; filter: blur(50px);
		opacity: 0.1; will-change: transform;
	}
	.b1 {
		width: 30vw; height: 30vw; max-width: 280px; max-height: 280px;
		background: color-mix(in srgb, var(--accent) 60%, #e0607e);
		top: 5%; left: 5%; animation: lava1 22s ease-in-out infinite;
	}
	.b2 {
		width: 25vw; height: 25vw; max-width: 240px; max-height: 240px;
		background: color-mix(in srgb, #a78bfa 70%, var(--accent));
		top: 25%; right: 3%; animation: lava2 28s ease-in-out infinite;
	}
	.b3 {
		width: 28vw; height: 28vw; max-width: 260px; max-height: 260px;
		background: color-mix(in srgb, #4ade80 50%, var(--accent));
		bottom: 15%; left: 10%; animation: lava3 18s ease-in-out infinite;
	}
	.b4 {
		width: 22vw; height: 22vw; max-width: 200px; max-height: 200px;
		background: color-mix(in srgb, var(--accent) 80%, #e0607e);
		top: 55%; right: 15%; animation: lava1 32s ease-in-out infinite reverse;
	}
	.b5 {
		width: 20vw; height: 20vw; max-width: 180px; max-height: 180px;
		background: color-mix(in srgb, #a78bfa 40%, #4ade80);
		top: 75%; left: 30%; animation: lava2 20s ease-in-out infinite reverse;
	}
	@keyframes lava1 {
		0%, 100% { transform: translate(0, 0) scale(1); }
		33% { transform: translate(50px, 40px) scale(1.1); }
		66% { transform: translate(15px, 70px) scale(0.95); }
	}
	@keyframes lava2 {
		0%, 100% { transform: translate(0, 0) scale(1); }
		33% { transform: translate(-40px, 50px) scale(1.08); }
		66% { transform: translate(-25px, -30px) scale(0.92); }
	}
	@keyframes lava3 {
		0%, 100% { transform: translate(0, 0) scale(1); }
		33% { transform: translate(35px, -50px) scale(1.12); }
		66% { transform: translate(-25px, -20px) scale(0.9); }
	}
	@media (prefers-reduced-motion: reduce) {
		.lava-blob { animation: none !important; }
	}

	main {
		max-width: 800px; margin: 0 auto; position: relative;
		padding: 0 1rem calc(var(--player-height, 0px) + 2rem + env(safe-area-inset-bottom, 0px));
	}
	.page-header { margin-bottom: 1rem; }
	h1 { font-size: var(--text-page-heading); font-weight: 700; color: var(--text-primary); margin: 0; }
	.header-pulse {
		font-size: var(--text-xs); color: var(--text-muted);
		margin: 0.25rem 0 0 0; letter-spacing: 0.01em;
	}

	.sparkline-container {
		margin-bottom: 1.25rem; position: relative;
		background: color-mix(in srgb, var(--track-bg) 70%, transparent);
		backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
		border: 1px solid var(--glass-border, var(--track-border));
		border-radius: var(--radius-md); padding: 0.625rem 0.75rem 0.375rem;
	}
	.sparkline-label {
		font-size: var(--text-xs); color: var(--text-muted);
		position: absolute; top: 0.375rem; right: 0.625rem;
	}
	.sparkline { width: 100%; height: 32px; display: block; }

	.loading-container { display: flex; justify-content: center; padding: 3rem 2rem; }
	.empty { color: var(--text-tertiary); padding: 2rem; text-align: center; }
	.event-list { display: flex; flex-direction: column; gap: 0.5rem; }

	.event-item {
		--type-color: var(--border-subtle);
		display: flex; align-items: center; gap: 0.875rem;
		padding: 0.75rem 1rem; position: relative;
		background: color-mix(in srgb, var(--track-bg) 85%, transparent);
		backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
		border: 1px solid var(--glass-border, var(--track-border));
		border-radius: var(--radius-md);
		transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease, border-color 0.2s ease;
	}
	/* neon glow accent — follows card border-radius */
	.event-item::before {
		content: ''; position: absolute; inset: 0;
		border-radius: inherit; pointer-events: none;
		border-left: 2px solid var(--type-color);
		box-shadow: inset 4px 0 8px -2px color-mix(in srgb, var(--type-color) 30%, transparent);
	}
	.event-item:hover {
		background: color-mix(in srgb, var(--track-bg-hover) 90%, transparent);
		border-color: color-mix(in srgb, var(--type-color) 20%, var(--glass-border, var(--track-border)));
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15), 0 0 20px color-mix(in srgb, var(--type-color) 10%, transparent);
	}
	.event-item:hover::before {
		box-shadow: inset 6px 0 12px -2px color-mix(in srgb, var(--type-color) 50%, transparent);
	}
	.event-item.like { --type-color: #e0607e; }
	.event-item.track { --type-color: var(--accent); }
	.event-item.comment { --type-color: #a78bfa; }
	.event-item.join { --type-color: #4ade80; }
	.event-item.playlist_create { --type-color: #38bdf8; }
	.event-item.album_release { --type-color: #f59e0b; }
	.event-item.track_added_to_playlist { --type-color: #38bdf8; }

	.left-col { flex-shrink: 0; position: relative; width: 44px; height: 44px; }
	.art-link { display: block; width: 44px; height: 44px; text-decoration: none; }
	.art-img {
		width: 44px; height: 44px; border-radius: var(--radius-sm);
		object-fit: cover; display: block; background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
	}
	.art-placeholder {
		display: flex; align-items: center; justify-content: center; color: var(--text-muted);
	}
	.event-body { flex: 1; min-width: 0; }
	.event-header {
		display: flex; align-items: center; justify-content: space-between;
		gap: 0.75rem; margin-bottom: 0.125rem;
	}
	.handle-group {
		display: flex; align-items: center; gap: 0.375rem;
		min-width: 0;
	}
	.header-avatar-link { flex-shrink: 0; text-decoration: none; line-height: 0; }
	.header-avatar {
		width: 20px; height: 20px; border-radius: 50%;
		object-fit: cover; display: block;
		border: 1px solid var(--border-subtle);
	}
	.header-avatar-placeholder {
		background: var(--bg-tertiary); display: flex;
		align-items: center; justify-content: center; color: var(--text-muted);
	}
	.handle-link {
		color: var(--text-primary); font-weight: 600; font-size: var(--text-sm);
		text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
		line-height: 1.2;
	}
	.handle-link:hover { color: var(--accent); }
	.event-time { flex-shrink: 0; font-size: var(--text-xs); color: var(--text-muted); white-space: nowrap; }
	.event-action {
		font-size: var(--text-sm); color: var(--text-tertiary); margin: 0;
		line-height: 1.2; display: flex; align-items: center; gap: 0.375rem;
	}
	.icon-slot {
		width: 20px; flex-shrink: 0;
		display: flex; align-items: center; justify-content: center;
	}
	.action-icon { opacity: 0.6; color: var(--type-color); }
	.verb {
		font-size: var(--text-xs);
		color: color-mix(in srgb, var(--text-tertiary) 70%, var(--accent));
	}
	.track-link { color: var(--text-secondary); text-decoration: none; font-weight: 500; }
	.track-link:hover { color: var(--accent); }
	.by-artist {
		font-size: var(--text-xs);
		color: color-mix(in srgb, var(--text-tertiary) 70%, var(--accent));
	}
	.artist-avatar-link { text-decoration: none; flex-shrink: 0; }
	.inline-avatar {
		width: 16px; height: 16px; border-radius: 50%;
		object-fit: cover; display: inline-block; vertical-align: middle;
		border: 1px solid var(--border-subtle);
	}
	.inline-avatar-placeholder {
		background: var(--bg-tertiary); display: inline-flex;
		align-items: center; justify-content: center; color: var(--text-muted);
	}
	.comment-preview {
		font-size: var(--text-xs); color: var(--text-tertiary); margin: 0.375rem 0 0 0;
		line-height: 1.4; font-style: italic;
		background: color-mix(in srgb, #a78bfa 6%, transparent);
		border-left: 2px solid color-mix(in srgb, #a78bfa 40%, transparent);
		padding: 0.375rem 0.625rem; border-radius: var(--radius-sm);
	}
	.scroll-sentinel { display: flex; justify-content: center; padding: 2rem 0; min-height: 60px; }

	@media (max-width: 768px) {
		main { padding: 0 0.75rem calc(var(--player-height, 0px) + 1.25rem + env(safe-area-inset-bottom, 0px)); }
		.left-col, .art-link, .art-img { width: 40px; height: 40px; }
		.header-avatar { width: 18px; height: 18px; }
		.lava-blob { opacity: 0.07; }
		.event-item { gap: 0.625rem; padding: 0.625rem 0.75rem; }
	}
</style>
