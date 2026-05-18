<script lang="ts">
	import { likersSheet } from '$lib/likers-sheet.svelte';
	import { getRefreshedAvatar, triggerAvatarRefresh, hasAttemptedRefresh } from '$lib/avatar-refresh.svelte';
	import BottomSheet from './BottomSheet.svelte';
	import SensitiveImage from './SensitiveImage.svelte';
	import type { LikerData } from '$lib/tooltip-cache.svelte';

	let avatarErrors = $state<Set<string>>(new Set());

	function getDisplayUrl(liker: LikerData): string | null {
		return getRefreshedAvatar(liker.did) ?? liker.avatar_url;
	}

	function handleAvatarError(did: string) {
		avatarErrors = new Set([...avatarErrors, did]);
		if (!hasAttemptedRefresh(did)) triggerAvatarRefresh(did);
	}

	function shouldShowFallback(liker: LikerData): boolean {
		const url = getDisplayUrl(liker);
		return !url || avatarErrors.has(liker.did);
	}

	function formatTime(isoString: string): string {
		const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
		if (seconds < 60) return 'just now';
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
		if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
		if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
		return `${Math.floor(seconds / 604800)}w ago`;
	}
</script>

<BottomSheet
	open={likersSheet.isOpen}
	onClose={() => likersSheet.close()}
	ariaLabel="liked by"
>
	<div class="sheet-header">
		<span class="sheet-title">
			{likersSheet.likeCount} {likersSheet.likeCount === 1 ? 'like' : 'likes'}
		</span>
		<button class="sheet-close" onclick={() => likersSheet.close()} aria-label="close">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
				<line x1="18" y1="6" x2="6" y2="18"></line>
				<line x1="6" y1="6" x2="18" y2="18"></line>
			</svg>
		</button>
	</div>
	<div class="sheet-content">
		{#if likersSheet.loading}
			<div class="sheet-loading">
				{#each [1, 2, 3] as _, i (i)}
					<div class="liker-skeleton">
						<div class="avatar-skeleton"></div>
						<div class="text-skeleton"></div>
					</div>
				{/each}
			</div>
		{:else if likersSheet.error}
			<div class="sheet-empty">{likersSheet.error}</div>
		{:else if likersSheet.likers.length > 0}
			<div class="likers-list">
				{#each likersSheet.likers as liker (liker.did)}
					{@const displayUrl = getDisplayUrl(liker)}
					{@const showFallback = shouldShowFallback(liker)}
					<a href="/u/{liker.handle}/liked" class="liker-row" onclick={() => likersSheet.close()}>
						<div class="liker-avatar">
							{#if displayUrl && !showFallback}
								<SensitiveImage src={displayUrl} compact>
									<img
										src={displayUrl}
										alt=""
										onerror={() => handleAvatarError(liker.did)}
									/>
								</SensitiveImage>
							{:else}
								<span class="liker-initial">{(liker.display_name || liker.handle).charAt(0).toUpperCase()}</span>
							{/if}
						</div>
						<div class="liker-info">
							<span class="liker-name">{liker.display_name || liker.handle}</span>
							<span class="liker-time">{formatTime(liker.liked_at)}</span>
						</div>
					</a>
				{/each}
			</div>
		{:else}
			<div class="sheet-empty">be the first to like this</div>
		{/if}
	</div>
</BottomSheet>

<style>
	.sheet-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		flex-shrink: 0;
	}

	.sheet-title {
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--text-primary);
	}

	.sheet-close {
		background: none;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		padding: 0.25rem;
		border-radius: var(--radius-sm);
		transition: color 0.15s;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.sheet-close:hover {
		color: var(--text-primary);
	}

	.sheet-content {
		overflow-y: auto;
		padding: 0 1rem 1rem;
		flex: 1;
		min-height: 0;
	}

	.likers-list {
		display: flex;
		flex-direction: column;
	}

	.liker-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0;
		text-decoration: none;
		color: inherit;
		border-bottom: 1px solid var(--border-subtle);
		transition: background 0.15s;
		border-radius: var(--radius-sm);
		padding-left: 0.25rem;
		padding-right: 0.25rem;
	}

	.liker-row:last-child {
		border-bottom: none;
	}

	.liker-row:active {
		background: var(--bg-tertiary);
	}

	.liker-avatar {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-full);
		overflow: hidden;
		background: var(--bg-tertiary);
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.liker-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.liker-initial {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-secondary);
	}

	.liker-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.liker-name {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.liker-time {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
	}

	.sheet-empty {
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		text-align: center;
		padding: 2rem 1rem;
	}

	.sheet-loading {
		display: flex;
		flex-direction: column;
	}

	.liker-skeleton {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.25rem;
	}

	.avatar-skeleton {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-full);
		background: linear-gradient(90deg, var(--bg-tertiary) 0%, var(--bg-hover) 50%, var(--bg-tertiary) 100%);
		background-size: 200% 100%;
		animation: shimmer 1.5s ease-in-out infinite;
		flex-shrink: 0;
	}

	.text-skeleton {
		width: 120px;
		height: 14px;
		border-radius: var(--radius-sm);
		background: linear-gradient(90deg, var(--bg-tertiary) 0%, var(--bg-hover) 50%, var(--bg-tertiary) 100%);
		background-size: 200% 100%;
		animation: shimmer 1.5s ease-in-out infinite;
	}

	@keyframes shimmer {
		0% { background-position: 200% 0; }
		100% { background-position: -200% 0; }
	}

	@media (prefers-reduced-motion: reduce) {
		.avatar-skeleton,
		.text-skeleton {
			animation: none;
		}
	}
</style>
