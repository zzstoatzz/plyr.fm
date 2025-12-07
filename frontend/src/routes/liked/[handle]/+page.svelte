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

	const user = $derived(data.userLikes?.user);
	const tracks = $derived(data.userLikes?.tracks ?? []);
	const displayName = $derived(user?.display_name || user?.handle || 'unknown');
	const isOwnProfile = $derived(auth.user?.handle === user?.handle);

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
	<title>{displayName}'s liked tracks • plyr</title>
	<meta name="description" content="tracks liked by {displayName} on plyr.fm" />
	{#if user?.avatar_url}
		<meta property="og:image" content={user.avatar_url} />
	{/if}
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

<div class="page">
	<div class="user-header">
		{#if user?.avatar_url}
			<img src={user.avatar_url} alt={displayName} class="avatar" />
		{:else}
			<div class="avatar avatar-placeholder">
				{displayName.charAt(0).toUpperCase()}
			</div>
		{/if}
		<div class="user-info">
			<h1>{displayName}'s liked tracks</h1>
			<a href="https://bsky.app/profile/{user?.handle}" target="_blank" rel="noopener" class="handle">
				@{user?.handle}
			</a>
		</div>
	</div>

	<div class="section-header">
		<h2>
			{#if tracks.length > 0}
				<span class="count">{tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}</span>
			{:else}
				no liked tracks
			{/if}
		</h2>
		{#if tracks.length > 0}
			<div class="header-actions">
				<button class="btn-action" onclick={queueAll} title="queue all liked tracks">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="8" y1="6" x2="21" y2="6"></line>
						<line x1="8" y1="12" x2="21" y2="12"></line>
						<line x1="8" y1="18" x2="21" y2="18"></line>
						<line x1="3" y1="6" x2="3.01" y2="6"></line>
						<line x1="3" y1="12" x2="3.01" y2="12"></line>
						<line x1="3" y1="18" x2="3.01" y2="18"></line>
					</svg>
					<span>queue all</span>
				</button>
			</div>
		{/if}
	</div>

	{#if tracks.length === 0}
		<div class="empty-state">
			<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
				<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
			</svg>
			<h2>{isOwnProfile ? "you haven't" : `${displayName} hasn't`} liked any tracks yet</h2>
			<p>liked tracks will appear here</p>
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
	{/if}
</div>

<style>
	.page {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 1rem calc(var(--player-height, 0px) + 2rem + env(safe-area-inset-bottom, 0px));
		min-height: 100vh;
	}

	.user-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 2rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--border-default);
	}

	.avatar {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}

	.avatar-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-tertiary);
		color: var(--text-secondary);
		font-size: 1.5rem;
		font-weight: 600;
	}

	.user-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.user-info h1 {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.handle {
		font-size: 0.9rem;
		color: var(--text-tertiary);
		text-decoration: none;
		transition: color 0.15s;
	}

	.handle:hover {
		color: var(--accent);
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.section-header h2 {
		font-size: var(--text-page-heading);
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.count {
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.btn-action {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.85rem;
		background: transparent;
		border: 1px solid var(--border-default);
		color: var(--text-secondary);
		border-radius: 6px;
		font-size: 0.85rem;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}

	.btn-action:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.btn-action:active {
		transform: scale(0.97);
	}

	.btn-action svg {
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

	.tracks-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	@media (max-width: 768px) {
		.page {
			padding: 0 0.75rem calc(var(--player-height, 0px) + 1.25rem + env(safe-area-inset-bottom, 0px));
		}

		.user-header {
			gap: 0.75rem;
			margin-bottom: 1.5rem;
			padding-bottom: 1rem;
		}

		.avatar {
			width: 48px;
			height: 48px;
		}

		.avatar-placeholder {
			font-size: 1.25rem;
		}

		.user-info h1 {
			font-size: 1.25rem;
		}

		.handle {
			font-size: 0.85rem;
		}

		.section-header h2 {
			font-size: 1.25rem;
		}

		.count {
			font-size: 0.85rem;
		}

		.empty-state {
			padding: 3rem 1rem;
		}

		.empty-state h2 {
			font-size: 1.25rem;
		}

		.btn-action {
			padding: 0.45rem 0.7rem;
			font-size: 0.8rem;
		}

		.btn-action svg {
			width: 16px;
			height: 16px;
		}
	}
</style>
