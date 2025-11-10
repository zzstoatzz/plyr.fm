<script lang="ts">
	import { page } from '$app/stores';
	import type { User } from '$lib/types';
	import SettingsMenu from './SettingsMenu.svelte';
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
		<a href="/" class="brand">
			<h1>{APP_NAME}</h1>
			<p>{APP_TAGLINE}</p>
		</a>

		<nav>
			{#if isAuthenticated}
				<a href="/portal" class="user-handle">@{user?.handle}</a>
				<SettingsMenu />
				<button onclick={onLogout} class="btn-logout">logout</button>
			{:else}
				<a href="/login" class="btn-primary">login</a>
			{/if}
			<a
				href="https://bsky.app/profile/plyr.fm"
				target="_blank"
				rel="noopener noreferrer"
				class="bluesky-link"
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

	.bluesky-link {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
		transition: color 0.2s;
		text-decoration: none;
	}

	.bluesky-link:hover {
		color: #1185fe;
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

		.bluesky-link {
			order: -1;
		}

		.bluesky-link svg {
			width: 18px;
			height: 18px;
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
