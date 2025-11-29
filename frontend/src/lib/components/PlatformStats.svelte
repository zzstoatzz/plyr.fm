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
		<div class="stats-bar skeleton" transition:fade={{ duration: 200 }}>
			<div class="stat-item">
				<span class="skeleton-bar"></span>
			</div>
		</div>
	{:else if stats}
		<div class="stats-bar" transition:fade={{ duration: 200 }}>
			<div class="stat-item">
				<span class="stat-value">{stats.total_plays.toLocaleString()}</span>
				<span class="stat-label">{pluralize(stats.total_plays, 'play', 'plays')}</span>
			</div>
			<span class="stat-divider">•</span>
			<div class="stat-item">
				<span class="stat-value">{stats.total_tracks.toLocaleString()}</span>
				<span class="stat-label">{pluralize(stats.total_tracks, 'track', 'tracks')}</span>
			</div>
			<span class="stat-divider">•</span>
			<div class="stat-item">
				<span class="stat-value">{stats.total_artists.toLocaleString()}</span>
				<span class="stat-label">{pluralize(stats.total_artists, 'artist', 'artists')}</span>
			</div>
		</div>
	{/if}
{:else if variant === 'menu'}
	<div class="stats-menu-section">
		<div class="stats-menu-header">
			<svg
				width="16"
				height="16"
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
			<span>platform stats</span>
		</div>
		{#if loading}
			<div class="stats-menu-loading">
				<span class="skeleton-text"></span>
			</div>
		{:else if stats}
			<div class="stats-menu-grid">
				<div class="stats-menu-item">
					<span class="stats-menu-value">{stats.total_plays.toLocaleString()}</span>
					<span class="stats-menu-label">{pluralize(stats.total_plays, 'play', 'plays')}</span>
				</div>
				<div class="stats-menu-item">
					<span class="stats-menu-value">{stats.total_tracks.toLocaleString()}</span>
					<span class="stats-menu-label">{pluralize(stats.total_tracks, 'track', 'tracks')}</span>
				</div>
				<div class="stats-menu-item">
					<span class="stats-menu-value">{stats.total_artists.toLocaleString()}</span>
					<span class="stats-menu-label">{pluralize(stats.total_artists, 'artist', 'artists')}</span>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.stats-bar {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		font-size: 0.85rem;
	}

	.stats-bar.skeleton {
		min-height: 120px;
	}

	.stat-item {
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
	}

	.stat-value {
		color: var(--accent);
		font-weight: 600;
		font-size: 1.1rem;
	}

	.stat-label {
		color: var(--text-secondary);
	}

	.stat-divider {
		display: none;
	}

	.skeleton-bar {
		width: 100%;
		height: 16px;
		background: linear-gradient(
			90deg,
			#1a1a1a 0%,
			#242424 50%,
			#1a1a1a 100%
		);
		background-size: 200% 100%;
		animation: shimmer 1.5s ease-in-out infinite;
		border-radius: 4px;
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
		.skeleton-bar,
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
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.stats-menu-header svg {
		opacity: 0.7;
	}

	.stats-menu-loading {
		padding: 0.5rem 0;
	}

	.skeleton-text {
		display: block;
		width: 100%;
		height: 48px;
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
		padding: 0.5rem;
		background: var(--bg-tertiary, #1a1a1a);
		border-radius: 6px;
	}

	.stats-menu-value {
		font-size: 1rem;
		font-weight: 600;
		color: var(--accent);
	}

	.stats-menu-label {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		text-transform: lowercase;
	}
</style>
