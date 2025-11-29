<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { API_URL } from '$lib/config';

	interface Props {
		variant?: 'bar' | 'menu';
	}

	let { variant = 'bar' }: Props = $props();

	interface Stats {
		total_plays: number;
		total_tracks: number;
		total_artists: number;
	}

	let stats = $state<Stats | null>(null);
	let loading = $state(true);

	function pluralize(count: number, singular: string, plural: string): string {
		return count === 1 ? singular : plural;
	}

	async function loadStats() {
		try {
			const response = await fetch(`${API_URL}/stats`);
			if (response.ok) {
				stats = await response.json();
			}
		} catch (e) {
			console.error('failed to load platform stats:', e);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		loadStats();
	});
</script>

{#if variant === 'bar'}
	{#if loading}
		<div class="stats-sidebar-card skeleton" transition:fade={{ duration: 200 }}>
			<div class="skeleton-rows">
				<span class="skeleton-row"></span>
				<span class="skeleton-row"></span>
				<span class="skeleton-row"></span>
			</div>
		</div>
	{:else if stats}
		<div class="stats-sidebar-card" transition:fade={{ duration: 200 }}>
			<div class="sidebar-header">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<line x1="18" y1="20" x2="18" y2="10"></line>
					<line x1="12" y1="20" x2="12" y2="4"></line>
					<line x1="6" y1="20" x2="6" y2="14"></line>
				</svg>
				<span>stats</span>
			</div>
			<div class="sidebar-stats">
				<div class="sidebar-stat">
					<svg class="stat-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polygon points="5 3 19 12 5 21 5 3"></polygon>
					</svg>
					<span class="stat-value">{stats.total_plays.toLocaleString()}</span>
					<span class="stat-label">{pluralize(stats.total_plays, 'play', 'plays')}</span>
				</div>
				<div class="sidebar-stat">
					<svg class="stat-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path d="M9 18V5l12-2v13"></path>
						<circle cx="6" cy="18" r="3"></circle>
						<circle cx="18" cy="16" r="3"></circle>
					</svg>
					<span class="stat-value">{stats.total_tracks.toLocaleString()}</span>
					<span class="stat-label">{pluralize(stats.total_tracks, 'track', 'tracks')}</span>
				</div>
				<div class="sidebar-stat">
					<svg class="stat-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
						<circle cx="8" cy="5" r="3" stroke="currentColor" stroke-width="1.5" fill="none" />
						<path d="M3 14c0-2.5 2-4.5 5-4.5s5 2 5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
					</svg>
					<span class="stat-value">{stats.total_artists.toLocaleString()}</span>
					<span class="stat-label">{pluralize(stats.total_artists, 'artist', 'artists')}</span>
				</div>
			</div>
		</div>
	{/if}
{:else if variant === 'menu'}
	<div class="stats-menu-section">
		<div class="stats-menu-header">
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<line x1="18" y1="20" x2="18" y2="10"></line>
				<line x1="12" y1="20" x2="12" y2="4"></line>
				<line x1="6" y1="20" x2="6" y2="14"></line>
			</svg>
			<span>stats</span>
		</div>
		{#if loading}
			<div class="stats-menu-loading">
				<span class="skeleton-text"></span>
			</div>
		{:else if stats}
			<div class="stats-menu-grid">
				<div class="stats-menu-item">
					<svg class="menu-stat-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polygon points="5 3 19 12 5 21 5 3"></polygon>
					</svg>
					<span class="stats-menu-value">{stats.total_plays.toLocaleString()}</span>
					<span class="stats-menu-label">{pluralize(stats.total_plays, 'play', 'plays')}</span>
				</div>
				<div class="stats-menu-item">
					<svg class="menu-stat-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path d="M9 18V5l12-2v13"></path>
						<circle cx="6" cy="18" r="3"></circle>
						<circle cx="18" cy="16" r="3"></circle>
					</svg>
					<span class="stats-menu-value">{stats.total_tracks.toLocaleString()}</span>
					<span class="stats-menu-label">{pluralize(stats.total_tracks, 'track', 'tracks')}</span>
				</div>
				<div class="stats-menu-item">
					<svg class="menu-stat-icon" width="12" height="12" viewBox="0 0 16 16" fill="none">
						<circle cx="8" cy="5" r="3" stroke="currentColor" stroke-width="1.5" fill="none" />
						<path d="M3 14c0-2.5 2-4.5 5-4.5s5 2 5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
					</svg>
					<span class="stats-menu-value">{stats.total_artists.toLocaleString()}</span>
					<span class="stats-menu-label">{pluralize(stats.total_artists, 'artist', 'artists')}</span>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	/* Sidebar card variant - glass effect matching Toast */
	.stats-sidebar-card {
		background: rgba(10, 10, 10, 0.6);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 10px;
		overflow: hidden;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
	}

	.stats-sidebar-card.skeleton {
		min-height: 140px;
		padding: 1rem;
	}

	.skeleton-rows {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.skeleton-row {
		height: 20px;
		background: linear-gradient(90deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.06) 50%, rgba(255, 255, 255, 0.03) 100%);
		background-size: 200% 100%;
		animation: shimmer 1.5s ease-in-out infinite;
		border-radius: 4px;
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.65rem 0.85rem;
		background: rgba(255, 255, 255, 0.03);
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		color: var(--text-secondary);
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.sidebar-header svg {
		opacity: 0.6;
	}

	.sidebar-stats {
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.sidebar-stat {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.5rem;
		border-radius: 6px;
		transition: background 0.15s ease;
	}

	.sidebar-stat:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.stat-icon {
		color: var(--text-muted);
		opacity: 0.6;
		flex-shrink: 0;
	}

	.stat-value {
		color: var(--text-primary);
		font-weight: 600;
		font-size: 0.9rem;
		font-variant-numeric: tabular-nums;
	}

	.stat-label {
		color: var(--text-tertiary);
		font-size: 0.8rem;
	}

	@keyframes shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-row,
		.skeleton-text {
			animation: none;
		}
	}

	/* Menu variant styles */
	.stats-menu-section {
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--border-subtle);
	}

	.stats-menu-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		color: var(--text-secondary);
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.stats-menu-header svg {
		opacity: 0.6;
	}

	.stats-menu-loading {
		padding: 0.5rem 0;
	}

	.skeleton-text {
		display: block;
		width: 100%;
		height: 60px;
		background: linear-gradient(90deg, #1a1a1a 0%, #242424 50%, #1a1a1a 100%);
		background-size: 200% 100%;
		animation: shimmer 1.5s ease-in-out infinite;
		border-radius: 6px;
	}

	.stats-menu-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
	}

	.stats-menu-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
		padding: 0.6rem 0.4rem;
		background: var(--bg-tertiary, #1a1a1a);
		border-radius: 6px;
	}

	.menu-stat-icon {
		color: var(--text-muted);
		opacity: 0.5;
		margin-bottom: 0.15rem;
	}

	.stats-menu-value {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}

	.stats-menu-label {
		font-size: 0.65rem;
		color: var(--text-tertiary);
		text-transform: lowercase;
	}
</style>
