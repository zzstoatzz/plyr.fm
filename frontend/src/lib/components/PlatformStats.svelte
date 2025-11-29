<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { API_URL } from '$lib/config';

	interface Stats {
		total_plays: number;
		total_tracks: number;
		total_artists: number;
	}

	let stats = $state<Stats | null>(null);
	let loading = $state(true);

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
			<span class="stat-label">plays</span>
		</div>
		<span class="stat-divider">•</span>
		<div class="stat-item">
			<span class="stat-value">{stats.total_tracks}</span>
			<span class="stat-label">tracks</span>
		</div>
		<span class="stat-divider">•</span>
		<div class="stat-item">
			<span class="stat-value">{stats.total_artists}</span>
			<span class="stat-label">artists</span>
		</div>
	</div>
{/if}

<style>
	.stats-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		font-size: 0.85rem;
	}

	.stats-bar.skeleton {
		min-height: 44px;
	}

	.stat-item {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.stat-value {
		color: var(--accent);
		font-weight: 600;
	}

	.stat-label {
		color: var(--text-secondary);
	}

	.stat-divider {
		color: var(--text-muted);
		font-size: 0.6rem;
	}

	.skeleton-bar {
		width: 180px;
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
		.skeleton-bar {
			animation: none;
		}
	}
</style>
