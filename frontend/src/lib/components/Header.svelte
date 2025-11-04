<script lang="ts">
	import { page } from '$app/stores';
	import type { User } from '$lib/types';
	import SettingsMenu from './SettingsMenu.svelte';

	interface Props {
		user: User | null;
		isAuthenticated: boolean;
		onLogout: () => Promise<void>;
	}

	let { user, isAuthenticated, onLogout }: Props = $props();
</script>

<header>
	<div class="header-content">
		<a href="/" class="brand">
			<h1>relay</h1>
			<p>music on atproto</p>
		</a>

		<nav>
			{#if isAuthenticated}
				{#if $page.url.pathname !== '/portal'}
					<a href="/portal" class="nav-link">portal</a>
				{/if}
				<a href="/profile" class="user-handle">@{user?.handle}</a>
				<SettingsMenu />
				<button onclick={onLogout} class="btn-logout">logout</button>
			{:else}
				<a href="/login" class="btn-primary">login</a>
			{/if}
		</nav>
	</div>
</header>

<style>
	header {
		border-bottom: 1px solid #333;
		margin-bottom: 2rem;
	}

	.header-content {
		max-width: 800px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}

	.brand {
		text-decoration: none;
		color: inherit;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.brand:hover h1 {
		color: var(--accent);
	}

	h1 {
		font-size: 1.5rem;
		margin: 0;
		color: var(--text-primary);
		transition: color 0.2s;
	}

	.brand p {
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-tertiary);
	}

	nav {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.nav-link {
		color: var(--text-secondary);
		text-decoration: none;
		font-size: 0.9rem;
		transition: color 0.2s;
		white-space: nowrap;
	}

	.nav-link:hover {
		color: var(--text-primary);
	}

	.user-handle {
		color: var(--text-secondary);
		text-decoration: none;
		font-size: 0.9rem;
		padding: 0.4rem 0.75rem;
		background: #1a1a1a;
		border-radius: 6px;
		border: 1px solid #333;
		transition: all 0.2s;
		white-space: nowrap;
	}

	.user-handle:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: #222;
	}

	.btn-primary {
		background: transparent;
		border: 1px solid var(--accent);
		color: var(--accent);
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-size: 0.9rem;
		text-decoration: none;
		transition: all 0.2s;
		cursor: pointer;
		white-space: nowrap;
	}

	.btn-primary:hover {
		background: var(--accent);
		color: var(--bg-primary);
	}

	.btn-logout {
		background: transparent;
		border: 1px solid #444;
		color: #b0b0b0;
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-size: 0.9rem;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}

	.btn-logout:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	@media (max-width: 640px) {
		.header-content {
			padding: 1rem;
			gap: 0.5rem;
		}

		.brand h1 {
			font-size: 1.25rem;
		}

		.brand p {
			font-size: 0.75rem;
		}

		nav {
			gap: 0.5rem;
		}

		.nav-link,
		.user-handle,
		.btn-logout {
			font-size: 0.85rem;
			padding: 0.35rem 0.6rem;
		}
	}
</style>
