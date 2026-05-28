<script lang="ts">
	import { onMount } from 'svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import SensitiveImage from '$lib/components/SensitiveImage.svelte';
	import type { Playlist } from '$lib/types';
	import { API_URL } from '$lib/config';

	let playlists = $state<Playlist[]>([]);
	let loadingPlaylists = $state(false);

	async function loadMyPlaylists() {
		loadingPlaylists = true;
		try {
			const response = await fetch(`${API_URL}/lists/playlists`, {
				credentials: 'include'
			});
			if (response.ok) {
				playlists = await response.json();
			}
		} catch (_e) {
			console.error('failed to load playlists:', _e);
		} finally {
			loadingPlaylists = false;
		}
	}

	onMount(loadMyPlaylists);
</script>

<section class="playlists-section">
	<div class="section-header">
		<h2>your playlists</h2>
		<a href="/library" class="view-playlists-link">manage playlists →</a>
	</div>

	{#if loadingPlaylists}
		<div class="loading-container">
			<WaveLoading size="lg" message="loading playlists..." />
		</div>
	{:else if playlists.length === 0}
		<p class="empty">no playlists yet - <a href="/library">create a new playlist</a></p>
	{:else}
		<div class="playlists-grid">
			{#each playlists as playlist}
				<a href="/playlist/{playlist.id}" class="playlist-card">
					{#if playlist.image_url}
						<SensitiveImage src={playlist.image_url} compact tooltipPosition="above">
							<img src={playlist.image_url} alt="{playlist.name} cover" class="playlist-cover" />
						</SensitiveImage>
					{:else}
						<div class="playlist-cover-placeholder">
							<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
								<line x1="8" y1="6" x2="21" y2="6"></line>
								<line x1="8" y1="12" x2="21" y2="12"></line>
								<line x1="8" y1="18" x2="21" y2="18"></line>
								<line x1="3" y1="6" x2="3.01" y2="6"></line>
								<line x1="3" y1="12" x2="3.01" y2="12"></line>
								<line x1="3" y1="18" x2="3.01" y2="18"></line>
							</svg>
						</div>
					{/if}
					<div class="playlist-info">
						<h3 class="playlist-title">{playlist.name}</h3>
						<p class="playlist-stats">{playlist.track_count} {playlist.track_count === 1 ? 'track' : 'tracks'}</p>
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

	/* playlists section */
	.playlists-section {
		margin-top: 3rem;
	}

	.playlists-section h2 {
		font-size: var(--text-page-heading);
		margin-bottom: 1.5rem;
	}

	.view-playlists-link {
		color: var(--text-secondary);
		text-decoration: none;
		font-size: var(--text-sm);
		padding: 0.35rem 0.6rem;
		background: var(--bg-tertiary);
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-default);
		transition: all 0.15s;
		white-space: nowrap;
	}

	.view-playlists-link:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--bg-hover);
	}

	.playlists-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 1.5rem;
	}

	.playlist-card {
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

	.playlist-card:hover {
		border-color: var(--accent);
		transform: translateY(-2px);
	}

	.playlist-cover {
		width: 100%;
		aspect-ratio: 1;
		border-radius: var(--radius-base);
		object-fit: cover;
	}

	.playlist-cover-placeholder {
		width: 100%;
		aspect-ratio: 1;
		border-radius: var(--radius-base);
		background: linear-gradient(135deg, rgba(var(--accent-rgb, 139, 92, 246), 0.15), rgba(var(--accent-rgb, 139, 92, 246), 0.05));
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--accent);
	}

	.playlist-info {
		min-width: 0;
		flex: 1;
	}

	.playlist-title {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--text-primary);
		margin: 0 0 0.25rem 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.playlist-stats {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		margin: 0;
	}

	@media (max-width: 600px) {
		.playlists-section h2 {
			font-size: var(--text-xl);
		}

		.section-header {
			margin-bottom: 0.75rem;
		}

		.playlists-section {
			margin-top: 2rem;
		}

		.playlists-grid {
			grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
			gap: 0.75rem;
		}

		.playlist-card {
			padding: 0.75rem;
			gap: 0.5rem;
		}

		.playlist-title {
			font-size: var(--text-sm);
		}

		.playlist-stats {
			font-size: var(--text-xs);
		}

		.view-playlists-link {
			font-size: var(--text-xs);
			padding: 0.3rem 0.5rem;
		}
	}
</style>
