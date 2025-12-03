<script lang="ts">
	import { API_URL } from '$lib/config';

	interface Liker {
		did: string;
		handle: string;
		display_name: string;
		avatar_url?: string;
		liked_at: string;
	}

	interface Props {
		trackId: number;
		likeCount: number;
	}

	let { trackId, likeCount }: Props = $props();

	let likers = $state<Liker[]>([]);
	let loading = $state(true); // start as loading
	let error = $state<string | null>(null);

	$effect(() => {
		if (likeCount === 0) {
			loading = false;
			return;
		}

		const fetchLikers = async () => {
			try {
				const url = `${API_URL}/tracks/${trackId}/likes`;
				const response = await fetch(url);

				if (!response.ok) {
					const text = await response.text();
					console.error('failed to fetch likers:', response.status, text);
					throw new Error(`failed to fetch likers: ${response.status}`);
				}

				const data = await response.json();
				likers = data.users || [];
			} catch (err) {
				error = 'failed to load';
				console.error('error fetching likers:', err);
			} finally {
				loading = false;
			}
		};

		fetchLikers();
	});

	// format relative time
	function formatTime(isoString: string): string {
		const date = new Date(isoString);
		const now = new Date();
		const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

		if (seconds < 60) return 'just now';
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
		if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
		if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
		return `${Math.floor(seconds / 604800)}w ago`;
	}
</script>

<div
	class="likers-tooltip"
	role="tooltip"
>
	{#if loading}
		<div class="loading">loading...</div>
	{:else if error}
		<div class="error">{error}</div>
{:else if likers.length > 0}
	<div class="likers-list">
		{#each likers as liker}
			<a
				href="/u/{liker.handle}"
				class="liker"
			>
				{#if liker.avatar_url}
					<img src={liker.avatar_url} alt={liker.display_name} class="avatar" />
				{:else}
					<div class="avatar-placeholder">
						{liker.display_name.charAt(0).toUpperCase()}
					</div>
				{/if}
				<div class="liker-info">
					<div class="display-name">{liker.display_name}</div>
					<div class="handle">@{liker.handle}</div>
				</div>
				<div class="liked-time">{formatTime(liker.liked_at)}</div>
			</a>
		{/each}
	</div>
{:else}
	<div class="empty">be the first to like this</div>
{/if}
</div>

<style>
	.likers-tooltip {
		position: absolute;
		bottom: 100%;
		left: 50%;
		transform: translateX(-50%);
		margin-bottom: 0.5rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: 8px;
		padding: 0.75rem;
		min-width: 240px;
		max-width: 320px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
		z-index: 1000;
		pointer-events: auto;
	}

	.loading,
	.error,
	.empty {
		color: var(--text-tertiary);
		font-size: 0.85rem;
		text-align: center;
		padding: 0.5rem;
	}

	.error {
		color: var(--error);
	}

	.likers-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.liker {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem;
		border-radius: 6px;
		text-decoration: none;
		transition: background 0.2s;
	}

	.liker:hover {
		background: var(--bg-hover);
	}

	.avatar,
	.avatar-placeholder {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.avatar {
		object-fit: cover;
		border: 1px solid var(--border-default);
	}

	.avatar-placeholder {
		background: var(--border-default);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-tertiary);
		font-weight: 600;
		font-size: 0.9rem;
	}

	.liker-info {
		flex: 1;
		min-width: 0;
	}

	.display-name {
		color: var(--text-primary);
		font-weight: 500;
		font-size: 0.9rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.handle {
		color: var(--text-tertiary);
		font-size: 0.8rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.liked-time {
		color: var(--text-muted);
		font-size: 0.75rem;
		flex-shrink: 0;
	}

	/* custom scrollbar */
	.likers-list::-webkit-scrollbar {
		width: 6px;
	}

	.likers-list::-webkit-scrollbar-track {
		background: var(--bg-tertiary);
	}

	.likers-list::-webkit-scrollbar-thumb {
		background: var(--border-default);
		border-radius: 3px;
	}

	.likers-list::-webkit-scrollbar-thumb:hover {
		background: var(--border-emphasis);
	}
</style>
