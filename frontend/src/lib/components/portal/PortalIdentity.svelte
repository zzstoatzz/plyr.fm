<script lang="ts">
	import { onMount } from 'svelte';
	import { API_URL } from '$lib/config';
	import { auth } from '$lib/auth.svelte';
	import type { Artist } from '$lib/types';

	let { trackCount, albumCount }: { trackCount: number; albumCount: number } = $props();

	let artist = $state<Artist | null>(null);

	const handle = $derived(auth.user?.handle ?? '');
	const displayName = $derived(artist?.display_name || handle);
	const initial = $derived((displayName || '?').trim().charAt(0).toUpperCase());

	onMount(async () => {
		try {
			const res = await fetch(`${API_URL}/artists/me`, { credentials: 'include' });
			if (res.ok) artist = await res.json();
		} catch {
			// fall back to handle-only display
		}
	});
</script>

<div class="identity">
	<div class="avatar">
		{#if artist?.avatar_url}
			<img src={artist.avatar_url} alt={displayName} />
		{:else}
			<span class="avatar-fallback">{initial}</span>
		{/if}
	</div>
	<div class="meta">
		<span class="name">{displayName}</span>
		{#if handle}<span class="handle">@{handle}</span>{/if}
		<span class="counts">
			{trackCount} {trackCount === 1 ? 'track' : 'tracks'} · {albumCount}
			{albumCount === 1 ? 'album' : 'albums'}
		</span>
	</div>
	{#if handle}
		<a class="view-profile" href="/u/{handle}">view public profile →</a>
	{/if}
</div>

<style>
	.identity {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.avatar {
		width: 56px;
		height: 56px;
		flex-shrink: 0;
		border-radius: var(--radius-full);
		overflow: hidden;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.avatar-fallback {
		font-size: var(--text-xl);
		font-weight: 600;
		color: var(--text-tertiary);
	}

	.meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.name {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.handle {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.counts {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		margin-top: 0.15rem;
	}

	.view-profile {
		flex-shrink: 0;
		align-self: flex-start;
		color: var(--text-secondary);
		text-decoration: none;
		font-size: var(--text-sm);
		padding: 0.35rem 0.6rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		transition: all 0.15s;
		white-space: nowrap;
	}

	.view-profile:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--bg-hover);
	}

	@media (max-width: 600px) {
		.identity {
			flex-wrap: wrap;
			gap: 0.75rem;
			margin-bottom: 1.25rem;
		}

		.avatar {
			width: 48px;
			height: 48px;
		}

		.view-profile {
			order: 3;
			width: 100%;
			text-align: center;
		}
	}
</style>
