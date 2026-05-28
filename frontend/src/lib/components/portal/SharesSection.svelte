<script lang="ts">
	import { onMount } from 'svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import type { Track } from '$lib/types';
	import { API_URL } from '$lib/config';
	import { toast } from '$lib/toast.svelte';

	interface ShareLinkUser {
		did: string;
		handle: string;
		display_name: string | null;
		avatar_url: string | null;
		count: number;
	}

	interface ShareLinkStats {
		code: string;
		track: Track;
		click_count: number;
		play_count: number;
		anonymous_clicks: number;
		anonymous_plays: number;
		visitors: ShareLinkUser[];
		listeners: ShareLinkUser[];
		created_at: string;
	}

	let shares = $state<ShareLinkStats[]>([]);
	let loadingShares = $state(false);
	let sharesTotal = $state(0);
	let sharesHasMore = $state(false);
	let loadingMoreShares = $state(false);
	let expandedShareCode = $state<string | null>(null);

	async function loadShares(append = false) {
		if (append) {
			loadingMoreShares = true;
		} else {
			loadingShares = true;
		}
		try {
			const offset = append ? shares.length : 0;
			const response = await fetch(`${API_URL}/tracks/me/shares?limit=20&offset=${offset}`, {
				credentials: 'include'
			});
			if (response.ok) {
				const data = await response.json();
				if (append) {
					shares = [...shares, ...data.shares];
				} else {
					shares = data.shares;
				}
				sharesTotal = data.total;
				sharesHasMore = data.has_more;
			}
		} catch (_e) {
			console.error('failed to load shares:', _e);
		} finally {
			loadingShares = false;
			loadingMoreShares = false;
		}
	}

	function toggleShareDetails(code: string) {
		expandedShareCode = expandedShareCode === code ? null : code;
	}

	onMount(loadShares);
</script>

<section class="shares-section">
	<div class="section-header">
		<h2>share links</h2>
		{#if sharesTotal > 0}
			<span class="shares-count">{sharesTotal} {sharesTotal === 1 ? 'link' : 'links'}</span>
		{/if}
	</div>

	{#if loadingShares}
		<div class="loading-container">
			<WaveLoading size="lg" message="loading shares..." />
		</div>
	{:else if shares.length === 0}
		<p class="empty">no share links yet - share a track to start tracking who listens</p>
	{:else}
		<div class="shares-list">
			{#each shares as share}
				<div class="share-item">
					<button
						class="share-item-header"
						onclick={() => toggleShareDetails(share.code)}
						aria-expanded={expandedShareCode === share.code}
					>
						<div class="share-track-info">
							{#if share.track.image_url}
								<img src={share.track.image_url} alt="" class="share-track-cover" />
							{:else}
								<div class="share-track-cover-placeholder">
									<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
										<path d="M9 18V5l12-2v13"></path>
										<circle cx="6" cy="18" r="3"></circle>
										<circle cx="18" cy="16" r="3"></circle>
									</svg>
								</div>
							{/if}
							<div class="share-track-text">
								<a href="/track/{share.track.id}" class="share-track-title">{share.track.title}</a>
								<span class="share-track-artist">{share.track.artist}</span>
							</div>
						</div>
						<div class="share-stats">
							<span class="share-stat" title="clicks">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
									<polyline points="10 17 15 12 10 7"></polyline>
									<line x1="15" y1="12" x2="3" y2="12"></line>
								</svg>
								{share.click_count}
							</span>
							<span class="share-stat" title="plays">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
									<path d="M8 5v14l11-7z"/>
								</svg>
								{share.play_count}
							</span>
						</div>
						<svg
							class="expand-icon"
							class:expanded={expandedShareCode === share.code}
							width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
						>
							<polyline points="6 9 12 15 18 9"></polyline>
						</svg>
					</button>

					{#if expandedShareCode === share.code}
						<div class="share-details">
							<div class="share-link-row">
								<code class="share-link-url">{window.location.origin}/track/{share.track.id}?ref={share.code}</code>
								<button
									class="copy-link-btn"
									onclick={async () => {
										await navigator.clipboard.writeText(`${window.location.origin}/track/${share.track.id}?ref=${share.code}`);
										toast.success('link copied');
									}}
								>
									copy
								</button>
							</div>

							<div class="share-stats-grid">
								<!-- visitors (clicks) -->
								<div class="stat-group">
									<div class="stat-header">
										<span class="stat-label">visitors</span>
										<span class="stat-count">{share.click_count}</span>
									</div>
									{#if share.visitors.length > 0}
										<div class="user-avatars">
											{#each share.visitors as user}
												<a
													href="/u/{user.handle}"
													class="user-circle"
													title="{user.display_name || user.handle} ({user.count} {user.count === 1 ? 'click' : 'clicks'})"
												>
													{#if user.avatar_url}
														<img src={user.avatar_url} alt="" />
													{:else}
														<span>{(user.display_name || user.handle).charAt(0).toUpperCase()}</span>
													{/if}
												</a>
											{/each}
										</div>
									{/if}
									{#if share.anonymous_clicks > 0}
										<span class="anonymous-count">+{share.anonymous_clicks} anonymous</span>
									{/if}
									{#if share.visitors.length === 0 && share.anonymous_clicks === 0}
										<span class="no-data">none yet</span>
									{/if}
								</div>

								<!-- listeners (plays) -->
								<div class="stat-group">
									<div class="stat-header">
										<span class="stat-label">listeners</span>
										<span class="stat-count">{share.play_count}</span>
									</div>
									{#if share.listeners.length > 0}
										<div class="user-avatars">
											{#each share.listeners as user}
												<a
													href="/u/{user.handle}"
													class="user-circle"
													title="{user.display_name || user.handle} ({user.count} {user.count === 1 ? 'play' : 'plays'})"
												>
													{#if user.avatar_url}
														<img src={user.avatar_url} alt="" />
													{:else}
														<span>{(user.display_name || user.handle).charAt(0).toUpperCase()}</span>
													{/if}
												</a>
											{/each}
										</div>
									{/if}
									{#if share.anonymous_plays > 0}
										<span class="anonymous-count">+{share.anonymous_plays} anonymous</span>
									{/if}
									{#if share.listeners.length === 0 && share.anonymous_plays === 0}
										<span class="no-data">none yet</span>
									{/if}
								</div>
							</div>

							<div class="share-meta">
								<span class="share-created">created {new Date(share.created_at).toLocaleDateString()}</span>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>

		{#if sharesHasMore}
			<button
				class="load-more-btn"
				onclick={() => loadShares(true)}
				disabled={loadingMoreShares}
			>
				{loadingMoreShares ? 'loading...' : 'load more'}
			</button>
		{/if}
	{/if}
</section>

<style>
	/* shared page-level primitives — duplicated here because Svelte scoped CSS
	   does not cross the component boundary; the parent keeps its own copies for
	   the remaining sections. */
	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.section-header h2 {
		margin-bottom: 0;
	}

	.empty {
		color: var(--text-muted);
		padding: 2rem;
		text-align: center;
		background: var(--bg-tertiary);
		border-radius: var(--radius-md);
		border: 1px solid var(--border-subtle);
	}

	.loading-container {
		display: flex;
		justify-content: center;
		padding: 3rem 1rem;
	}

	.load-more-btn {
		display: block;
		width: 100%;
		padding: 0.75rem;
		margin-top: 1rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-secondary);
		font-size: var(--text-sm);
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
	}

	.load-more-btn:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}

	.load-more-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* shares section */
	.shares-section {
		margin-top: 3rem;
	}

	.shares-section h2 {
		font-size: var(--text-page-heading);
		margin-bottom: 1.5rem;
	}

	.shares-count {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		font-weight: 400;
	}

	.shares-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.share-item {
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.share-item-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		width: 100%;
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		color: inherit;
		transition: background 0.15s;
	}

	.share-item-header:hover {
		background: var(--bg-hover);
	}

	.share-track-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex: 1;
		min-width: 0;
	}

	.share-track-cover {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-sm);
		object-fit: cover;
		flex-shrink: 0;
	}

	.share-track-cover-placeholder {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-sm);
		background: var(--bg-hover);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.share-track-text {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.share-track-title {
		font-size: var(--text-base);
		font-weight: 500;
		color: var(--text-primary);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.share-track-title:hover {
		color: var(--accent);
	}

	.share-track-artist {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.share-stats {
		display: flex;
		gap: 1rem;
		flex-shrink: 0;
	}

	.share-stat {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.share-stat svg {
		opacity: 0.6;
	}

	.expand-icon {
		flex-shrink: 0;
		color: var(--text-muted);
		transition: transform 0.2s;
	}

	.expand-icon.expanded {
		transform: rotate(180deg);
	}

	.share-details {
		padding: 0.75rem 1rem 1rem;
		border-top: 1px solid var(--border-subtle);
		background: var(--bg-secondary);
	}

	.share-link-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		padding: 0.5rem;
		background: var(--bg-tertiary);
		border-radius: var(--radius-sm);
	}

	.share-link-url {
		flex: 1;
		font-size: var(--text-xs);
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		background: none;
		padding: 0;
	}

	.copy-link-btn {
		flex-shrink: 0;
		padding: 0.25rem 0.5rem;
		font-size: var(--text-xs);
		font-family: inherit;
		background: var(--accent);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.copy-link-btn:hover {
		opacity: 0.9;
	}

	.share-stats-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}

	.stat-group {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.stat-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.stat-label {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-secondary);
	}

	.stat-count {
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	.user-avatars {
		display: flex;
		justify-content: flex-start;
		overflow-x: auto;
		max-width: 100%;
		padding: 0.25rem 0;
		scrollbar-width: none;
	}

	.user-avatars::-webkit-scrollbar {
		display: none;
	}

	.user-circle {
		width: 28px;
		height: 28px;
		border-radius: var(--radius-full);
		border: 2px solid var(--bg-secondary);
		background: var(--bg-tertiary);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		margin-left: -6px;
		transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), z-index 0s;
		position: relative;
		text-decoration: none;
		flex-shrink: 0;
	}

	.user-circle:first-child {
		margin-left: 0;
	}

	.user-circle:hover {
		transform: translateY(-2px) scale(1.08);
		z-index: 10;
	}

	.user-circle img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.user-circle span {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--text-secondary);
	}

	.anonymous-count {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.no-data {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.share-meta {
		margin-top: 0.75rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border-subtle);
	}

	.share-created {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	@media (max-width: 600px) {
		.shares-section {
			margin-top: 2rem;
		}

		.shares-section h2 {
			font-size: var(--text-xl);
		}

		.section-header {
			margin-bottom: 0.75rem;
		}
	}
</style>
