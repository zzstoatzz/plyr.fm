<script lang="ts">
	import { page } from '$app/stores';
	import type { User } from '$lib/types';
	import SettingsMenu from './SettingsMenu.svelte';
	import LinksMenu from './LinksMenu.svelte';
	import { APP_NAME, APP_TAGLINE } from '$lib/branding';

	interface Props {
		user: User | null;
		isAuthenticated: boolean;
		onLogout: () => Promise<void>;
	}

	let { user, isAuthenticated, onLogout }: Props = $props();
</script>

<header>
	<div class="header-content">
		<div class="left-section">
			<!-- desktop: show icons inline -->
			<a
				href="https://bsky.app/profile/plyr.fm"
				target="_blank"
				rel="noopener noreferrer"
				class="bluesky-link desktop-only"
				title="Follow @plyr.fm on Bluesky"
			>
				<svg
					width="20"
					height="20"
					viewBox="0 0 600 530"
					fill="currentColor"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="m135.72 44.03c66.496 49.921 138.02 151.14 164.28 205.46 26.262-54.316 97.782-155.54 164.28-205.46 47.98-36.021 125.72-63.892 125.72 24.795 0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.3797-3.6904-10.832-3.7077-7.8964-0.0174-2.9357-1.1937 0.51669-3.7077 7.8964-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.4491-163.25-81.433-5.9562-21.282-16.111-152.36-16.111-170.07 0-88.687 77.742-60.816 125.72-24.795z"
					/>
				</svg>
			</a>
			<a
				href="https://status.zzstoatzz.io/@plyr.fm"
				target="_blank"
				rel="noopener noreferrer"
				class="status-link desktop-only"
				title="View status page"
			>
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
				</svg>
			</a>

			<!-- mobile: show menu button -->
			<div class="mobile-only">
				<LinksMenu />
			</div>

			<a href="/" class="brand">
				<h1>{APP_NAME}</h1>
				<p>{APP_TAGLINE}</p>
			</a>
		</div>

		<nav>
			{#if isAuthenticated}
				<a href="/liked" class="nav-link" class:active={$page.url.pathname === '/liked'}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
					</svg>
					<span>liked</span>
				</a>
				<a href="/portal" class="user-handle">@{user?.handle}</a>
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

	.left-section {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.brand {
		text-decoration: none;
		color: inherit;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex-shrink: 0;
		margin-left: 1.5rem;
	}

	.brand:hover h1 {
		color: var(--accent);
	}

	.desktop-only {
		display: flex;
	}

	.mobile-only {
		display: none;
	}

	.bluesky-link,
	.status-link {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
		transition: color 0.2s;
		text-decoration: none;
		flex-shrink: 0;
	}

	.bluesky-link:hover {
		color: #1185fe;
	}

	.status-link:hover {
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
		transition: all 0.2s;
		white-space: nowrap;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.75rem;
		border-radius: 6px;
		border: 1px solid transparent;
	}

	.nav-link:hover {
		color: var(--text-primary);
		background: #1a1a1a;
		border-color: #333;
	}

	.nav-link.active {
		color: var(--accent);
		background: rgba(114, 137, 218, 0.1);
		border-color: var(--accent);
	}

	.nav-link svg {
		width: 16px;
		height: 16px;
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

	@media (max-width: 768px) {
		.desktop-only {
			display: none !important;
		}

		.mobile-only {
			display: flex;
		}

		.header-content {
			padding: 0.75rem 0.75rem;
			gap: 0.75rem;
		}

		.left-section {
			gap: 0.5rem;
		}

		.brand {
			margin-left: 0;
		}

		.brand h1 {
			font-size: 1.15rem;
		}

		.brand p {
			font-size: 0.7rem;
		}

		.bluesky-link svg,
		.status-link svg {
			width: 16px;
			height: 16px;
		}

		nav {
			gap: 0.4rem;
		}

		.nav-link {
			padding: 0.3rem 0.5rem;
			font-size: 0.8rem;
		}

		.nav-link span {
			display: none;
		}

		.user-handle {
			font-size: 0.8rem;
			padding: 0.3rem 0.5rem;
		}

		.btn-logout,
		.btn-primary {
			font-size: 0.8rem;
			padding: 0.3rem 0.65rem;
		}
	}
</style>
