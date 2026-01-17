<script lang="ts">
	import { API_URL } from '$lib/config';
	import { getLikers, setLikers, type LikerData } from '$lib/tooltip-cache.svelte';
	import {
		getRefreshedAvatar,
		triggerAvatarRefresh,
		hasAttemptedRefresh
	} from '$lib/avatar-refresh.svelte';
	import SensitiveImage from './SensitiveImage.svelte';

	interface Props {
		trackId: number;
		likeCount: number;
		onMouseEnter?: () => void;
		onMouseLeave?: () => void;
	}

	let { trackId, likeCount, onMouseEnter, onMouseLeave }: Props = $props();

	let likers = $state<LikerData[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let tooltipElement: HTMLDivElement | null = $state(null);
	let positionBelow = $state(false);

	// track which avatars have errored (by DID)
	let avatarErrors = $state<Set<string>>(new Set());

	/**
	 * get the display URL for a liker's avatar.
	 * prefers refreshed URL from global cache, falls back to original.
	 */
	function getDisplayUrl(liker: LikerData): string | null {
		const refreshed = getRefreshedAvatar(liker.did);
		return refreshed ?? liker.avatar_url;
	}

	/**
	 * handle avatar load error - show fallback and trigger refresh.
	 */
	function handleAvatarError(did: string) {
		avatarErrors = new Set([...avatarErrors, did]);

		if (!hasAttemptedRefresh(did)) {
			triggerAvatarRefresh(did);
		}
	}

	/**
	 * check if avatar should show fallback.
	 */
	function shouldShowFallback(liker: LikerData): boolean {
		const url = getDisplayUrl(liker);
		return !url || avatarErrors.has(liker.did);
	}

	// check if tooltip should flip below based on viewport position
	$effect(() => {
		if (!tooltipElement) return;

		const parent = tooltipElement.parentElement;
		if (!parent) return;

		const parentRect = parent.getBoundingClientRect();
		positionBelow = parentRect.top < 200;
	});

	$effect(() => {
		if (likeCount === 0) {
			loading = false;
			return;
		}

		// check cache first
		const cached = getLikers(trackId);
		if (cached) {
			likers = cached;
			loading = false;
			return;
		}

		const fetchLikers = async () => {
			try {
				const url = `${API_URL}/tracks/${trackId}/likes`;
				const response = await fetch(url);

				if (!response.ok) {
					throw new Error(`failed to fetch likers: ${response.status}`);
				}

				const data = await response.json();
				const users = data.users || [];
				likers = users;
				setLikers(trackId, users);
			} catch (err) {
				error = 'failed to load';
				console.error('error fetching likers:', err);
			} finally {
				loading = false;
			}
		};

		fetchLikers();
	});

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
	bind:this={tooltipElement}
	class="likers-tooltip"
	class:position-below={positionBelow}
	role="tooltip"
	onmouseenter={onMouseEnter}
	onmouseleave={onMouseLeave}
>
	{#if loading}
		<div class="loading">
			<div class="loading-avatars">
				{#each [1, 2, 3] as _}
					<div class="avatar-skeleton"></div>
				{/each}
			</div>
		</div>
	{:else if error}
		<div class="error">{error}</div>
	{:else if likers.length > 0}
		<div class="likers-avatars">
			{#each likers as liker (liker.did)}
				{@const displayUrl = getDisplayUrl(liker)}
				{@const showFallback = shouldShowFallback(liker)}
				<a
					href="/u/{liker.handle}/liked"
					class="liker-circle"
					title="{liker.display_name} (@{liker.handle}) • {formatTime(liker.liked_at)}"
				>
					{#if displayUrl && !showFallback}
						<SensitiveImage src={displayUrl} compact>
							<img
								src={displayUrl}
								alt=""
								onerror={() => handleAvatarError(liker.did)}
							/>
						</SensitiveImage>
					{:else}
						<span>{(liker.display_name || liker.handle).charAt(0).toUpperCase()}</span>
					{/if}
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
		margin-bottom: 0.625rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 0.5rem 0.625rem;
		box-shadow:
			0 4px 16px rgba(0, 0, 0, 0.4),
			0 0 0 1px rgba(255, 255, 255, 0.03);
		z-index: 1000;
		pointer-events: auto;
	}

	.likers-tooltip.position-below {
		bottom: auto;
		top: 100%;
		margin-bottom: 0;
		margin-top: 0.625rem;
	}

	.loading,
	.error,
	.empty {
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		text-align: center;
		padding: 0.25rem 0.5rem;
		white-space: nowrap;
	}

	.error {
		color: var(--error);
	}

	.loading-avatars {
		display: flex;
		justify-content: center;
	}

	.avatar-skeleton {
		width: 32px;
		height: 32px;
		border-radius: var(--radius-full);
		background: linear-gradient(
			90deg,
			var(--bg-tertiary) 0%,
			var(--bg-hover) 50%,
			var(--bg-tertiary) 100%
		);
		background-size: 200% 100%;
		animation: shimmer 1.5s ease-in-out infinite;
		border: 2px solid var(--bg-secondary);
		margin-left: -8px;
		flex-shrink: 0;
	}

	.avatar-skeleton:first-child {
		margin-left: 0;
	}

	@keyframes shimmer {
		0% { background-position: 200% 0; }
		100% { background-position: -200% 0; }
	}

	.likers-avatars {
		display: flex;
		/* start from left so most recent (leftmost) is always visible */
		/* scroll right to see older likers */
		justify-content: flex-start;
		overflow-x: auto;
		max-width: 240px;
		padding: 0.5rem 0 0.125rem 0;
		scrollbar-width: none;
	}

	.likers-avatars::-webkit-scrollbar {
		display: none;
	}

	.liker-circle {
		width: 32px;
		height: 32px;
		border-radius: var(--radius-full);
		border: 2px solid var(--bg-secondary);
		background: var(--bg-tertiary);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		margin-left: -8px;
		transition:
			transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
			z-index 0s;
		position: relative;
		text-decoration: none;
		flex-shrink: 0;
	}

	.liker-circle:first-child {
		margin-left: 0;
	}

	.liker-circle:hover {
		transform: translateY(-2px) scale(1.08);
		z-index: 10;
	}

	.liker-circle img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.liker-circle span {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--text-secondary);
	}

	@media (prefers-reduced-motion: reduce) {
		.avatar-skeleton {
			animation: none;
		}
		.liker-circle {
			transition: none;
		}
	}
</style>
