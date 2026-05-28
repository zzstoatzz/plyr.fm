<script lang="ts">
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import type { AlbumSummary } from '$lib/types';
	import { auth } from '$lib/auth.svelte';

	let { albums, loadingAlbums }: { albums: AlbumSummary[]; loadingAlbums: boolean } = $props();
</script>

<section class="albums-section">
	<h2>your albums</h2>

	{#if loadingAlbums}
		<div class="loading-container">
			<WaveLoading size="lg" message="loading albums..." />
		</div>
	{:else if albums.length === 0}
		<p class="empty">no albums yet - upload tracks with album names to create albums</p>
	{:else}
		<div class="albums-grid">
			{#each albums as album}
				<a href="/u/{auth.user?.handle}/album/{album.slug}" class="album-card">
					{#if album.image_url}
						<img src={album.image_url} alt="{album.title} cover" class="album-cover" />
					{:else}
						<div class="album-cover-placeholder">
							<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
								<rect x="3" y="3" width="18" height="18" stroke="currentColor" stroke-width="1.5" fill="none"/>
								<circle cx="12" cy="12" r="4" fill="currentColor"/>
							</svg>
						</div>
					{/if}
					<div class="album-info">
						<h3 class="album-title">{album.title}</h3>
						<p class="album-stats">
							{album.track_count} {album.track_count === 1 ? 'track' : 'tracks'} •
							{album.total_plays} {album.total_plays === 1 ? 'play' : 'plays'}
						</p>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</section>

<style>
	/* shared page-level primitives — duplicated here because Svelte scoped CSS
	   does not cross the component boundary; the parent keeps its own copies for
	   the remaining sections. */
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

	.albums-section {
		margin-top: 3rem;
	}

	.albums-section h2 {
		font-size: var(--text-page-heading);
		margin-bottom: 1.5rem;
	}

	.albums-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 1.5rem;
	}

	.album-card {
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		padding: 1rem;
		transition: all 0.2s;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		text-decoration: none;
		color: inherit;
	}

	.album-card:hover {
		border-color: var(--accent);
		transform: translateY(-2px);
	}

	.album-cover {
		width: 100%;
		aspect-ratio: 1;
		border-radius: var(--radius-base);
		object-fit: cover;
	}

	.album-cover-placeholder {
		width: 100%;
		aspect-ratio: 1;
		border-radius: var(--radius-base);
		background: linear-gradient(135deg, rgba(var(--accent-rgb, 139, 92, 246), 0.15), rgba(var(--accent-rgb, 139, 92, 246), 0.05));
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--accent);
	}

	.album-info {
		min-width: 0;
		flex: 1;
	}

	.album-title {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--text-primary);
		margin: 0 0 0.25rem 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.album-stats {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		margin: 0;
	}

	@media (max-width: 600px) {
		.albums-section h2 {
			font-size: var(--text-xl);
		}

		.albums-section {
			margin-top: 2rem;
		}

		.albums-grid {
			grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
			gap: 0.75rem;
		}

		.album-card {
			padding: 0.75rem;
			gap: 0.5rem;
		}

		.album-title {
			font-size: var(--text-sm);
		}
	}
</style>
