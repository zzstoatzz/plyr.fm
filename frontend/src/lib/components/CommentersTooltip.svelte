<script lang="ts">
	import { API_URL } from '$lib/config';
	import { getCommenters, setCommenters, type CommenterData } from '$lib/tooltip-cache.svelte';
	import {
		getRefreshedAvatar,
		triggerAvatarRefresh,
		hasAttemptedRefresh
	} from '$lib/avatar-refresh.svelte';
	import SensitiveImage from './SensitiveImage.svelte';

	interface Props {
		trackId: number;
		commentCount: number;
		onMouseEnter?: () => void;
		onMouseLeave?: () => void;
	}

	let { trackId, commentCount, onMouseEnter, onMouseLeave }: Props = $props();

	let commenters = $state<CommenterData[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let tooltipElement: HTMLDivElement | null = $state(null);
	let positionBelow = $state(false);

	// track which avatars have errored (by DID)
	let avatarErrors = $state<Set<string>>(new Set());

	/**
	 * get the display URL for a commenter's avatar.
	 * prefers refreshed URL from global cache, falls back to original.
	 */
	function getDisplayUrl(commenter: CommenterData): string | null {
		const refreshed = getRefreshedAvatar(commenter.did);
		return refreshed ?? commenter.avatar_url;
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
	function shouldShowFallback(commenter: CommenterData): boolean {
		const url = getDisplayUrl(commenter);
		return !url || avatarErrors.has(commenter.did);
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
		if (commentCount === 0) {
			loading = false;
			return;
		}

		// check cache first
		const cached = getCommenters(trackId);
		if (cached) {
			commenters = cached;
			loading = false;
			return;
		}

		const fetchCommenters = async () => {
			try {
				const url = `${API_URL}/tracks/${trackId}/comments`;
				const response = await fetch(url);

				if (!response.ok) {
					throw new Error(`failed to fetch comments: ${response.status}`);
				}

				const data = await response.json();
				const comments = data.comments || [];

				// extract unique commenters by did
				const uniqueMap = new Map<string, CommenterData>();
				for (const comment of comments) {
					if (!uniqueMap.has(comment.user_did)) {
						uniqueMap.set(comment.user_did, {
							did: comment.user_did,
							handle: comment.user_handle,
							display_name: comment.user_display_name,
							avatar_url: comment.user_avatar_url
						});
					}
				}
				const uniqueCommenters = Array.from(uniqueMap.values());
				commenters = uniqueCommenters;
				setCommenters(trackId, uniqueCommenters);
			} catch (err) {
				error = 'failed to load';
				console.error('error fetching commenters:', err);
			} finally {
				loading = false;
			}
		};

		fetchCommenters();
	});
</script>

<div
	bind:this={tooltipElement}
	class="commenters-tooltip"
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
	{:else if commenters.length > 0}
		<div class="commenters-avatars">
			{#each commenters as commenter (commenter.did)}
				{@const displayUrl = getDisplayUrl(commenter)}
				{@const showFallback = shouldShowFallback(commenter)}
				<a
					href="/u/{commenter.handle}"
					class="commenter-circle"
					title="{commenter.display_name || commenter.handle} (@{commenter.handle})"
				>
					{#if displayUrl && !showFallback}
						<SensitiveImage src={displayUrl} compact>
							<img
								src={displayUrl}
								alt=""
								onerror={() => handleAvatarError(commenter.did)}
							/>
						</SensitiveImage>
					{:else}
						<span>{(commenter.display_name || commenter.handle).charAt(0).toUpperCase()}</span>
					{/if}
				</a>
			{/each}
		</div>
	{:else}
		<div class="empty">no comments yet</div>
	{/if}
</div>

<style>
	.commenters-tooltip {
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

	.commenters-tooltip.position-below {
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

	.commenters-avatars {
		display: flex;
		/* start from left so most recent (leftmost) is always visible */
		/* scroll right to see older commenters */
		justify-content: flex-start;
		overflow-x: auto;
		max-width: 240px;
		padding: 0.5rem 0 0.125rem 0;
		scrollbar-width: none;
	}

	.commenters-avatars::-webkit-scrollbar {
		display: none;
	}

	.commenter-circle {
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

	.commenter-circle:first-child {
		margin-left: 0;
	}

	.commenter-circle:hover {
		transform: translateY(-2px) scale(1.08);
		z-index: 10;
	}

	.commenter-circle img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.commenter-circle span {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--text-secondary);
	}

	@media (prefers-reduced-motion: reduce) {
		.avatar-skeleton {
			animation: none;
		}
		.commenter-circle {
			transition: none;
		}
	}
</style>
