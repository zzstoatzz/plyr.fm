<script lang="ts">
	import Header from '$lib/components/Header.svelte';
	import { auth } from '$lib/auth.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	async function handleLogout() {
		await auth.logout();
		window.location.href = '/';
	}
</script>

<svelte:head>
	<title>library • plyr</title>
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

<div class="page">
	<div class="page-header">
		<h1>library</h1>
		<p>your collections on plyr</p>
	</div>

	<section class="collections">
		<a href="/liked" class="collection-card">
			<div class="collection-icon liked">
				<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
				</svg>
			</div>
			<div class="collection-info">
				<h3>liked tracks</h3>
				<p>{data.likedCount} {data.likedCount === 1 ? 'track' : 'tracks'}</p>
			</div>
			<div class="collection-arrow">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="9 18 15 12 9 6"></polyline>
				</svg>
			</div>
		</a>

		<!-- placeholder for future playlists -->
		<div class="coming-soon">
			<div class="coming-soon-icon">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<line x1="8" y1="6" x2="21" y2="6"></line>
					<line x1="8" y1="12" x2="21" y2="12"></line>
					<line x1="8" y1="18" x2="21" y2="18"></line>
					<line x1="3" y1="6" x2="3.01" y2="6"></line>
					<line x1="3" y1="12" x2="3.01" y2="12"></line>
					<line x1="3" y1="18" x2="3.01" y2="18"></line>
				</svg>
			</div>
			<span>playlists coming soon</span>
		</div>
	</section>
</div>

<style>
	.page {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 1rem calc(var(--player-height, 0px) + 2rem + env(safe-area-inset-bottom, 0px));
		min-height: 100vh;
	}

	.page-header {
		margin-bottom: 2rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--border-default);
	}

	.page-header h1 {
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 0.25rem 0;
	}

	.page-header p {
		font-size: 0.9rem;
		color: var(--text-tertiary);
		margin: 0;
	}

	.collections {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.collection-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.25rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: 12px;
		text-decoration: none;
		color: inherit;
		transition: all 0.15s;
	}

	.collection-card:hover {
		border-color: var(--accent);
		background: var(--bg-hover);
	}

	.collection-card:active {
		transform: scale(0.99);
	}

	.collection-icon {
		width: 48px;
		height: 48px;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.collection-icon.liked {
		background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05));
		color: #ef4444;
	}

	.collection-info {
		flex: 1;
		min-width: 0;
	}

	.collection-info h3 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0 0 0.15rem 0;
	}

	.collection-info p {
		font-size: 0.85rem;
		color: var(--text-tertiary);
		margin: 0;
	}

	.collection-arrow {
		color: var(--text-muted);
		flex-shrink: 0;
		transition: transform 0.15s;
	}

	.collection-card:hover .collection-arrow {
		transform: translateX(3px);
		color: var(--accent);
	}

	.coming-soon {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		background: var(--bg-tertiary);
		border: 1px dashed var(--border-default);
		border-radius: 12px;
		color: var(--text-muted);
		font-size: 0.9rem;
	}

	.coming-soon-icon {
		width: 40px;
		height: 40px;
		border-radius: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-secondary);
		color: var(--text-muted);
		flex-shrink: 0;
	}

	@media (max-width: 768px) {
		.page {
			padding: 0 0.75rem calc(var(--player-height, 0px) + 1.25rem + env(safe-area-inset-bottom, 0px));
		}

		.page-header {
			margin-bottom: 1.5rem;
			padding-bottom: 1rem;
		}

		.page-header h1 {
			font-size: 1.5rem;
		}

		.collection-card {
			padding: 0.875rem 1rem;
		}

		.collection-icon {
			width: 44px;
			height: 44px;
		}

		.collection-info h3 {
			font-size: 0.95rem;
		}

		.coming-soon {
			padding: 0.875rem 1rem;
			font-size: 0.85rem;
		}

		.coming-soon-icon {
			width: 36px;
			height: 36px;
		}
	}
</style>
