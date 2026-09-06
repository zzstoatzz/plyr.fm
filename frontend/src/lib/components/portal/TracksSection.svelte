<script lang="ts">
	import EditTrackModal from '$lib/components/EditTrackModal.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import CopyrightFlag from '$lib/components/portal/CopyrightFlag.svelte';
	import type { Track, AlbumSummary } from '$lib/types';
	import { API_URL } from '$lib/config';
	import { toast } from '$lib/toast.svelte';
	let editingTrack = $state<Track | null>(null);
	type SortMode = 'recent' | 'title' | 'plays';

	interface Props {
		tracks: Track[];
		tracksTotal: number;
		tracksHasMore: boolean;
		loadingTracks: boolean;
		loadingMoreTracks: boolean;
		albums: AlbumSummary[];
		atprotofansEligible: boolean;
		onLoadMore: () => void;
		onTracksChanged: () => Promise<void>;
		q?: string;
		sort?: SortMode;
		onFilterChange?: (filters: { q: string; sort: SortMode }) => void;
	}

	let {
		tracks,
		tracksTotal,
		tracksHasMore,
		loadingTracks,
		loadingMoreTracks,
		albums,
		atprotofansEligible,
		onLoadMore,
		onTracksChanged,
		q = '',
		sort = 'recent',
		onFilterChange
	}: Props = $props();

	// search/sort controls — server-side via onFilterChange (the parent owns the
	// fetch). debounced so typing doesn't fire a request per keystroke.
	let searchInput = $state(q);
	let sortMode = $state<SortMode>(sort);
	let hasQuery = $derived(searchInput.trim().length > 0);
	let searchDebounce: ReturnType<typeof setTimeout> | undefined;

	function emitFilter() {
		onFilterChange?.({ q: searchInput.trim(), sort: sortMode });
	}

	function onSearchInput() {
		clearTimeout(searchDebounce);
		searchDebounce = setTimeout(emitFilter, 250);
	}

	async function deleteTrack(trackId: number, trackTitle: string) {
		if (!confirm(`delete "${trackTitle}"?`)) return;

		try {
			const response = await fetch(`${API_URL}/tracks/${trackId}`, {
				method: 'DELETE',
				credentials: 'include'
			});

			if (response.ok) {
				await onTracksChanged();
				toast.success('track deleted');
			} else {
				const error = await response.json();
				toast.error(error.detail || 'failed to delete track');
			}
		} catch (e) {
			toast.error(`network error: ${e instanceof Error ? e.message : 'unknown error'}`);
		}
	}
</script>

<section class="tracks-section">
	<h2>your tracks</h2>

	{#if tracks.length > 0 || hasQuery}
		<div class="tracks-toolbar">
			<input
				type="search"
				class="track-search"
				placeholder="filter your tracks…"
				bind:value={searchInput}
				oninput={onSearchInput}
				aria-label="filter your tracks"
			/>
			<select
				class="track-sort"
				bind:value={sortMode}
				onchange={emitFilter}
				aria-label="sort tracks"
			>
				<option value="recent">recent</option>
				<option value="title">title</option>
				<option value="plays">most played</option>
			</select>
		</div>
	{/if}

	{#if loadingTracks && tracks.length === 0}
		<div class="loading-container">
			<WaveLoading size="lg" message="loading tracks..." />
		</div>
	{:else if tracks.length === 0}
		<p class="empty">
			{hasQuery ? `no tracks match “${searchInput.trim()}”` : 'no tracks uploaded yet'}
		</p>
	{:else}
		<div class="tracks-list" class:refreshing={loadingTracks}>
			{#each tracks as track}
				<div class="track-item" class:copyright-flagged={track.copyright_flagged}>
					<div class="track-artwork-col">
						<div class="track-artwork">
							{#if track.image_url}
								<img src={track.image_url} alt="{track.title} artwork" />
							{:else}
								<div class="track-artwork-placeholder">
									<svg
										width="20"
										height="20"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.5"
									>
										<path d="M9 18V5l12-2v13"></path>
										<circle cx="6" cy="18" r="3"></circle>
										<circle cx="18" cy="16" r="3"></circle>
									</svg>
								</div>
							{/if}
						</div>
						<a href="/track/{track.id}" class="track-view-link" title="view track page">view</a>
					</div>
					<div class="track-info">
						<div class="track-title">
							{track.title}
							{#if track.support_gate}
								<span class="support-gate-badge" title="supporters only">
									<svg
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="currentColor"
										aria-hidden="true"
									>
										<path
											d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"
										/>
									</svg>
								</span>
							{/if}
							{#if track.copyright_flagged}
								<CopyrightFlag match={track.copyright_match} recordUrl={track.atproto_record_url} />
							{/if}
						</div>
						<div class="track-meta">
							{#if track.features && track.features.length > 0}
								<div
									class="meta-features"
									title={`feat. ${track.features.map((f) => f.display_name).join(', ')}`}
								>
									<span class="features-label">feat.</span>
									<span class="features-list"
										>{track.features.map((f) => f.display_name).join(', ')}</span
									>
								</div>
							{/if}
							{#if track.album}
								<div class="meta-album" title={track.album.title}>
									<svg
										class="album-icon"
										viewBox="0 0 16 16"
										fill="none"
										xmlns="http://www.w3.org/2000/svg"
										aria-hidden="true"
										focusable="false"
									>
										<rect
											x="2"
											y="2"
											width="12"
											height="12"
											stroke="currentColor"
											stroke-width="1.5"
											fill="none"
										/>
										<circle cx="8" cy="8" r="2.5" fill="currentColor" />
									</svg>
									<a href="/u/{track.artist_handle}/album/{track.album.slug}" class="album-link">
										{track.album.title}
									</a>
								</div>
							{/if}
							{#if track.tags && track.tags.length > 0}
								<div class="meta-tags">
									{#each track.tags as tag}
										<a href="/tag/{encodeURIComponent(tag)}" class="meta-tag">{tag}</a>
									{/each}
								</div>
							{/if}
						</div>
						{#if track.created_at}
							<div class="track-date">
								{new Date(track.created_at).toLocaleDateString()}
							</div>
						{/if}
					</div>
					<div class="track-actions">
						<button
							type="button"
							class="track-action-btn edit"
							onclick={() => (editingTrack = track)}
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
								<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
								<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
							</svg>
							edit track
						</button>
						<button
							type="button"
							class="track-action-btn delete"
							onclick={() => deleteTrack(track.id, track.title)}
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
								<polyline points="3 6 5 6 21 6"></polyline>
								<path
									d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
								></path>
							</svg>
							delete
						</button>
					</div>
				</div>
			{/each}
		</div>

		{#if tracksHasMore}
			<button class="load-more-btn" onclick={onLoadMore} disabled={loadingMoreTracks}>
				{loadingMoreTracks ? 'loading...' : `load more (${tracks.length} of ${tracksTotal})`}
			</button>
		{/if}
	{/if}
</section>

{#if editingTrack}
	<EditTrackModal
		track={editingTrack}
		{albums}
		{atprotofansEligible}
		onClose={() => {
			editingTrack = null;
		}}
		onSaved={onTracksChanged}
	/>
{/if}

<style>
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
	.tracks-section {
		margin-top: 3rem;
	}
	.tracks-section h2 {
		font-size: var(--text-page-heading);
		margin-bottom: 1.5rem;
	}
	.tracks-toolbar {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.track-search {
		flex: 1;
		min-width: 0;
		padding: 0.55rem 0.75rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--text-base);
		transition: border-color 0.15s;
	}
	.track-search:focus {
		outline: none;
		border-color: var(--accent);
	}
	.track-sort {
		flex-shrink: 0;
		padding: 0.55rem 0.6rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.track-sort:focus {
		outline: none;
		border-color: var(--accent);
	}
	.tracks-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.tracks-list.refreshing {
		opacity: 0.5;
		transition: opacity 0.15s;
	}
	.track-item {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-base);
		padding: 1rem;
		transition: all 0.2s;
	}
	.track-item.copyright-flagged {
		background: color-mix(in srgb, var(--warning) 8%, transparent);
		border-color: color-mix(in srgb, var(--warning) 30%, transparent);
	}
	.track-item.copyright-flagged .track-title {
		color: var(--warning);
	}
	.track-item.copyright-flagged .track-artwork img,
	.track-item.copyright-flagged .track-artwork-placeholder {
		opacity: 0.6;
	}
	.track-artwork-col {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		flex-shrink: 0;
	}
	.track-artwork {
		width: 48px;
		height: 48px;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--bg-primary);
		border: 1px solid var(--border-subtle);
	}
	.track-artwork img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.track-artwork-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}
	.track-view-link {
		font-size: var(--text-xs);
		color: var(--text-muted);
		text-decoration: none;
		transition: color 0.15s;
	}
	.track-view-link:hover {
		color: var(--accent);
	}
	.track-item:hover {
		background: var(--bg-hover);
		border-color: var(--border-default);
	}
	.track-info {
		flex: 1;
		min-width: 0;
	}
	.track-title {
		font-weight: 600;
		font-size: var(--text-lg);
		margin-bottom: 0.25rem;
		color: var(--text-primary);
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.support-gate-badge {
		display: inline-flex;
		align-items: center;
		color: var(--accent);
		flex-shrink: 0;
	}
	.track-meta {
		font-size: var(--text-base);
		color: var(--text-secondary);
		margin-bottom: 0.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}
	.meta-features,
	.meta-album {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		width: 100%;
		min-width: 0;
	}
	.features-label {
		color: var(--accent-hover);
		font-weight: 600;
	}
	.features-list {
		color: var(--accent-hover);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta-album {
		color: var(--text-tertiary);
	}
	.album-link {
		color: var(--text-tertiary);
		text-decoration: none;
		transition: color 0.2s;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.album-link:hover {
		color: var(--accent);
	}
	.album-icon {
		width: 14px;
		height: 14px;
		opacity: 0.7;
		flex-shrink: 0;
	}
	.meta-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.meta-tag {
		display: inline-block;
		padding: 0.1rem 0.4rem;
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		color: var(--accent-hover);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		font-weight: 500;
		text-decoration: none;
		transition: all 0.15s;
	}
	.meta-tag:hover {
		background: color-mix(in srgb, var(--accent) 25%, transparent);
		color: var(--accent-hover);
	}
	.track-date {
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.track-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
		margin-left: 0.75rem;
		align-self: flex-start;
	}
	.track-action-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.65rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-full);
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		font-family: inherit;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
		width: auto;
	}
	.track-action-btn:hover {
		transform: none;
		box-shadow: none;
		border-color: var(--border-emphasis);
		color: var(--text-secondary);
	}
	.track-action-btn.delete:hover {
		color: var(--text-secondary);
	}
	@media (max-width: 600px) {
		.tracks-section h2 {
			font-size: var(--text-xl);
		}
		.tracks-section {
			margin-top: 2rem;
		}
		.tracks-list {
			gap: 0.5rem;
		}
		.track-item {
			padding: 0.75rem;
			gap: 0.75rem;
		}
		.track-artwork-col {
			gap: 0.25rem;
		}
		.track-artwork {
			width: 40px;
			height: 40px;
		}
		.track-view-link {
			font-size: 0.65rem;
		}
		.track-title {
			font-size: var(--text-base);
		}
		.track-meta {
			font-size: var(--text-sm);
		}
		.track-date {
			font-size: var(--text-xs);
		}
		.track-actions {
			margin-left: 0.5rem;
			gap: 0.35rem;
			flex-direction: column;
		}
		.track-action-btn {
			padding: 0.35rem 0.55rem;
			font-size: var(--text-xs);
		}
		.track-action-btn svg {
			width: 12px;
			height: 12px;
		}
	}
</style>
