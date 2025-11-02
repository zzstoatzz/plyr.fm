<script lang="ts">
	import { page } from '$app/stores';
	import type { User } from '$lib/types';
	import ColorSettings from './ColorSettings.svelte';

	interface Props {
		user: User | null;
		onLogout: () => Promise<void>;
	}

	let { user, onLogout }: Props = $props();

	let isAuthenticated = $derived(user !== null);
</script>

<header>
	<div class="header-content">
		<a href="/" class="brand">
			<h1>relay</h1>
			<p>music on atproto</p>
		</a>

		<nav>
			<ColorSettings />
			{#if isAuthenticated}
				<div class="nav-links">
					{#if $page.url.pathname !== '/portal'}
						<a href="/portal" class="nav-link">portal</a>
					{/if}
					{#if $page.url.pathname !== '/profile'}
						<a href="/profile" class="nav-link">profile</a>
					{/if}
				</div>
				<div class="divider"></div>
				<span class="user-info">@{user?.handle}</span>
				<button onclick={onLogout} class="btn-secondary">logout</button>
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
	}

	.brand {
		text-decoration: none;
		color: inherit;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
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
		gap: 1rem;
	}

	.nav-links {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.nav-link {
		color: var(--text-secondary);
		text-decoration: none;
		font-size: 0.9rem;
		transition: color 0.2s;
	}

	.nav-link:hover {
		color: var(--text-primary);
	}

	.divider {
		width: 1px;
		height: 20px;
		background: #444;
		margin: 0 0.5rem;
	}

	.user-info {
		color: #666;
		font-size: 0.85rem;
		padding: 0.25rem 0.5rem;
		background: #1a1a1a;
		border-radius: 4px;
		border: 1px solid #333;
	}

	.btn-primary {
		background: transparent;
		border: 1px solid var(--accent);
		color: var(--accent);
		padding: 0.5rem 1rem;
		border-radius: 4px;
		font-size: 0.9rem;
		text-decoration: none;
		transition: all 0.2s;
		cursor: pointer;
	}

	.btn-primary:hover {
		background: var(--accent);
		color: var(--bg-primary);
	}

	.btn-secondary {
		background: transparent;
		border: 1px solid #444;
		color: #b0b0b0;
		padding: 0.5rem 1rem;
		border-radius: 4px;
		font-size: 0.9rem;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-secondary:hover {
		border-color: #666;
		color: #e8e8e8;
	}
</style>
