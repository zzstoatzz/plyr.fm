<script lang="ts">
	import { page } from '$app/stores';
	import type { User } from '$lib/types';
	import LinksMenu from './LinksMenu.svelte';
	import ProfileMenu from './ProfileMenu.svelte';
	import UserMenu from './UserMenu.svelte';
	import { search } from '$lib/search.svelte';
	import { APP_NAME, APP_TAGLINE, APP_STAGE } from '$lib/branding';

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
			<!-- mobile: info menu (links + stats) -->
			<div class="mobile-only">
				<LinksMenu />
			</div>

			<a href="/" class="brand">
				<h1>{APP_NAME}{#if APP_STAGE}<sup class="stage-badge">{APP_STAGE}</sup>{/if}</h1>
				<p>{APP_TAGLINE}</p>
			</a>
		</div>

		<!-- mobile: navigation icons -->
		<div class="mobile-center mobile-only">
			<button class="nav-icon" onclick={() => search.open()} title="search (Cmd+K)">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="11" cy="11" r="8"></circle>
					<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
				</svg>
			</button>
			{#if isAuthenticated && !$page.url.pathname.startsWith('/library')}
				<a href="/library" class="nav-icon" title="library">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
					</svg>
				</a>
			{/if}
		</div>

		<nav>
			{#if isAuthenticated}
				<!-- desktop nav: search | library | upload | user menu -->
				<div class="desktop-nav desktop-only">
					<button class="nav-link" onclick={() => search.open()} title="search (Cmd+K)">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="11" cy="11" r="8"></circle>
							<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
						</svg>
						<span>search</span>
					</button>
					{#if !$page.url.pathname.startsWith('/library')}
						<a href="/library" class="nav-link" title="library">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
							</svg>
							<span>library</span>
						</a>
					{/if}
					{#if $page.url.pathname !== '/upload'}
						<a href="/upload" class="nav-link upload-link" title="upload a track">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
								<polyline points="17 8 12 3 7 8"></polyline>
								<line x1="12" y1="3" x2="12" y2="15"></line>
							</svg>
							<span>upload</span>
						</a>
					{/if}
					<UserMenu {user} {onLogout} />
				</div>

				<!-- mobile nav: profile menu -->
				<div class="mobile-only">
					<ProfileMenu {user} {onLogout} />
				</div>
			{:else}
				<!-- logged out: search + login -->
				<div class="desktop-nav desktop-only">
					<button class="nav-link" onclick={() => search.open()} title="search (Cmd+K)">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="11" cy="11" r="8"></circle>
							<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
						</svg>
						<span>search</span>
					</button>
					<a href="/login" class="btn-primary">log in</a>
				</div>
				<div class="mobile-only">
					<a href="/login" class="btn-primary">log in</a>
				</div>
			{/if}
		</nav>
	</div>
</header>

<style>
	header {
		border-bottom: 1px solid var(--glass-border, var(--border-default));
		margin-bottom: 2rem;
		position: sticky;
		top: 0;
		z-index: 50;
		background: var(--glass-bg, var(--bg-primary));
		backdrop-filter: var(--glass-blur, none);
		-webkit-backdrop-filter: var(--glass-blur, none);
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

	.desktop-nav {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.mobile-center {
		flex: 1;
		justify-content: space-evenly;
		align-items: center;
	}

	.nav-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border-radius: var(--radius-md);
		background: transparent;
		border: none;
		color: var(--text-secondary);
		text-decoration: none;
		cursor: pointer;
		font-family: inherit;
		transition: all 0.15s;
		-webkit-tap-highlight-color: transparent;
	}

	.nav-icon:hover {
		color: var(--accent);
		background: var(--bg-tertiary);
	}

	.nav-icon:active {
		transform: scale(0.94);
	}

	h1 {
		font-size: var(--text-3xl);
		margin: 0;
		color: var(--text-primary);
		transition: color 0.2s;
	}

	.stage-badge {
		font-size: 0.5rem;
		font-weight: 500;
		color: var(--text-tertiary);
		margin-left: 0.25rem;
		vertical-align: super;
		letter-spacing: 0.03em;
	}

	.brand p {
		margin: 0;
		font-size: 0.65rem;
		color: var(--text-tertiary);
		letter-spacing: 0.02em;
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
		font-size: var(--text-base);
		font-family: inherit;
		transition: all 0.15s;
		white-space: nowrap;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.65rem;
		border-radius: var(--radius-base);
		border: 1px solid transparent;
		background: transparent;
		cursor: pointer;
	}

	.nav-link:hover {
		color: var(--accent);
		background: var(--bg-tertiary);
		border-color: var(--border-default);
	}

	.nav-link.upload-link {
		border-color: var(--accent);
		color: var(--accent);
	}

	.nav-link.upload-link:hover {
		background: var(--accent);
		color: var(--bg-primary);
	}

	.nav-link svg {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}

	.btn-primary {
		background: transparent;
		border: 1px solid var(--accent);
		color: var(--accent);
		padding: 0.5rem 1rem;
		border-radius: var(--radius-base);
		font-size: var(--text-base);
		text-decoration: none;
		transition: all 0.15s;
		cursor: pointer;
		white-space: nowrap;
	}

	.btn-primary:hover {
		background: var(--accent);
		color: var(--bg-primary);
	}

	/* switch to mobile layout */
	@media (max-width: 768px) {
		.desktop-only {
			display: none !important;
		}

		.mobile-only {
			display: flex;
		}

		.header-content {
			padding: 0.75rem;
			gap: 0.75rem;
		}

		.left-section {
			gap: 0.5rem;
		}

		.brand h1 {
			font-size: 1.15rem;
		}

		.brand p {
			font-size: 0.55rem;
		}

		nav {
			gap: 0.4rem;
		}

		.btn-primary {
			font-size: var(--text-sm);
			padding: 0.3rem 0.65rem;
		}
	}
</style>
