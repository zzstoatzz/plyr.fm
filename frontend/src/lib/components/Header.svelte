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
	<!-- desktop: all items as siblings for even spacing -->
	<div class="header-content desktop-only">
		<div class="brand-group">
			<a href="/" class="brand">
				<h1>{APP_NAME}{#if APP_STAGE}<sup class="stage-badge">{APP_STAGE}</sup>{/if}</h1>
				<p>{APP_TAGLINE}</p>
			</a>
			<div class="social-links">
				<a
					href="https://bsky.app/profile/plyr.fm"
					target="_blank"
					rel="noopener noreferrer"
					class="social-link"
					title="follow @plyr.fm on bluesky"
				>
					<svg width="18" height="18" viewBox="0 0 600 530" fill="currentColor">
						<path d="m135.72 44.03c66.496 49.921 138.02 151.14 164.28 205.46 26.262-54.316 97.782-155.54 164.28-205.46 47.98-36.021 125.72-63.892 125.72 24.795 0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.3797-3.6904-10.832-3.7077-7.8964-0.0174-2.9357-1.1937 0.51669-3.7077 7.8964-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.4491-163.25-81.433-5.9562-21.282-16.111-152.36-16.111-170.07 0-88.687 77.742-60.816 125.72-24.795z"/>
					</svg>
				</a>
				<a
					href="https://status.zzstoatzz.io/@plyr.fm"
					target="_blank"
					rel="noopener noreferrer"
					class="social-link"
					title="view status page"
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
					</svg>
				</a>
				<a
					href="https://tangled.org/@zzstoatzz.io/plyr.fm"
					target="_blank"
					rel="noopener noreferrer"
					class="social-link"
					title="view source on tangled"
				>
					<img src="https://cdn.bsky.app/img/avatar/plain/did:plc:wshs7t2adsemcrrd4snkeqli/bafkreif6z53z4ukqmdgwstspwh5asmhxheblcd2adisoccl4fflozc3kva@jpeg" alt="Tangled" width="18" height="18" class="tangled-icon" />
				</a>
			</div>
		</div>

		<button class="nav-link" onclick={() => search.open()} title="search (Cmd+K)">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="11" cy="11" r="8"></circle>
				<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
			</svg>
			<span>search</span>
		</button>

		{#if isAuthenticated}
			{#if !$page.url.pathname.startsWith('/library')}
				<a href="/library" class="nav-link" title="library">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
					</svg>
					<span>library</span>
				</a>
			{:else}
				<div class="nav-spacer"></div>
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
			{:else}
				<div class="nav-spacer"></div>
			{/if}

			<UserMenu {user} {onLogout} />
		{:else}
			<a href="/login" class="btn-primary">log in</a>
		{/if}
	</div>

	<!-- mobile: original nested structure -->
	<div class="header-content-mobile mobile-only">
		<div class="left-section">
			<LinksMenu />
			<a href="/" class="brand">
				<h1>{APP_NAME}{#if APP_STAGE}<sup class="stage-badge">{APP_STAGE}</sup>{/if}</h1>
				<p>{APP_TAGLINE}</p>
			</a>
		</div>

		<div class="mobile-center">
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

		{#if isAuthenticated}
			<ProfileMenu {user} {onLogout} />
		{:else}
			<a href="/login" class="btn-primary">log in</a>
		{/if}
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

	/* desktop: flat structure with space-between */
	.header-content {
		max-width: 800px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	/* mobile: nested structure */
	.header-content-mobile {
		padding: 0.75rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
	}

	.desktop-only {
		display: flex;
	}

	.mobile-only {
		display: none;
	}

	.left-section {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.brand-group {
		display: flex;
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

	.social-links {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.social-link {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
		text-decoration: none;
		transition: color 0.15s;
	}

	.social-link:hover {
		color: var(--accent);
	}

	.social-link:hover svg {
		color: var(--accent);
	}

	.tangled-icon {
		border-radius: var(--radius-sm);
		opacity: 0.7;
		transition: opacity 0.15s;
	}

	.social-link:hover .tangled-icon {
		opacity: 1;
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

	.mobile-center {
		flex: 1;
		display: flex;
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

	.nav-spacer {
		width: 80px;
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

	@media (max-width: 768px) {
		.desktop-only {
			display: none !important;
		}

		.mobile-only {
			display: flex;
		}

		.brand h1 {
			font-size: 1.15rem;
		}

		.brand p {
			font-size: 0.55rem;
		}

		.btn-primary {
			font-size: var(--text-sm);
			padding: 0.3rem 0.65rem;
		}
	}
</style>
