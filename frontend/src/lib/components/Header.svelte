<script lang="ts">
	import { page } from '$app/stores';
	import type { User } from '$lib/types';
	import SettingsMenu from './SettingsMenu.svelte';
	import LinksMenu from './LinksMenu.svelte';
	import ProfileMenu from './ProfileMenu.svelte';
	import PlatformStats from './PlatformStats.svelte';
	import SearchTrigger from './SearchTrigger.svelte';
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
	<!-- Stats and search together in left margin, centered as a group -->
	<div class="margin-left desktop-only">
		<PlatformStats variant="header" />
		<SearchTrigger />
	</div>
	<!-- Logout positioned on far right, centered in right margin -->
	{#if isAuthenticated}
		<div class="logout-right desktop-only">
			<button onclick={onLogout} class="btn-logout-outer" title="log out">logout</button>
		</div>
	{/if}
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
			<a
				href="https://tangled.org/@zzstoatzz.io/plyr.fm"
				target="_blank"
				rel="noopener noreferrer"
				class="tangled-link desktop-only"
				title="View source on Tangled"
			>
				<img src="https://cdn.bsky.app/img/avatar/plain/did:plc:wshs7t2adsemcrrd4snkeqli/bafkreif6z53z4ukqmdgwstspwh5asmhxheblcd2adisoccl4fflozc3kva@jpeg" alt="Tangled" width="20" height="20" class="tangled-icon" />
			</a>

			<!-- mobile: show menu button -->
			<div class="mobile-only">
				<LinksMenu />
			</div>

			<a href="/" class="brand">
				<h1>{APP_NAME}{#if APP_STAGE}<sup class="stage-badge">{APP_STAGE}</sup>{/if}</h1>
				<p>{APP_TAGLINE}</p>
			</a>
		</div>

		<!-- Mobile: navigation icons with flex spacer -->
		<div class="mobile-center mobile-only">
			<button class="nav-icon" onclick={() => search.open()} title="search (⌘K)">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="11" cy="11" r="8"></circle>
					<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
				</svg>
			</button>
			{#if $page.url.pathname !== '/'}
				<a href="/" class="nav-icon" title="go to feed">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="12" cy="12" r="10"></circle>
						<line x1="2" y1="12" x2="22" y2="12"></line>
						<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
					</svg>
				</a>
			{/if}
			{#if isAuthenticated && !$page.url.pathname.startsWith('/library')}
				<a href="/library" class="nav-icon" title="go to library">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
					</svg>
				</a>
			{/if}
		</div>

		<nav>
			{#if isAuthenticated}
				<!-- Desktop nav -->
				<div class="desktop-nav desktop-only">
					{#if $page.url.pathname !== '/'}
						<a href="/" class="nav-link" title="go to feed">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<circle cx="12" cy="12" r="10"></circle>
								<line x1="2" y1="12" x2="22" y2="12"></line>
								<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
							</svg>
							<span>feed</span>
						</a>
					{/if}
					{#if !$page.url.pathname.startsWith('/library')}
						<a href="/library" class="nav-link" title="go to library">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
							</svg>
							<span>library</span>
						</a>
					{/if}
					{#if $page.url.pathname !== '/portal'}
						<a href="/portal" class="user-handle" title="go to portal">@{user?.handle}</a>
					{/if}
					<SettingsMenu />
				</div>

				<!-- Mobile nav: just ProfileMenu -->
				<div class="mobile-only">
					<ProfileMenu {user} {onLogout} />
				</div>
			{:else}
				<a href="/login" class="btn-primary">log in</a>
			{/if}
		</nav>
	</div>
</header>

<style>
	header {
		border-bottom: 1px solid var(--border-default);
		margin-bottom: 2rem;
		position: relative;
		z-index: 50;
	}

	.header-content {
		max-width: 800px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		position: relative;
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

	.desktop-nav {
		display: flex;
		align-items: center;
		gap: 0.75rem;
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
		border-radius: 10px;
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

	.margin-left {
		position: absolute;
		left: 0;
		top: 50%;
		transform: translateY(-50%);
		transition: width 0.3s ease;
		display: flex;
		align-items: center;
		justify-content: space-evenly;
		/* Fill the left margin area */
		width: calc((100vw - var(--queue-width, 0px) - 800px) / 2);
		padding: 0 1rem;
	}

	.logout-right {
		position: absolute;
		right: calc((100vw - var(--queue-width, 0px) - 800px) / 4);
		top: 50%;
		transform: translate(50%, -50%);
		transition: right 0.3s ease;
	}

	.btn-logout-outer {
		background: transparent;
		border: 1px solid var(--border-emphasis);
		color: var(--text-secondary);
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-size: 0.9rem;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}

	.btn-logout-outer:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.bluesky-link,
	.status-link,
	.tangled-link {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
		transition: color 0.2s, opacity 0.2s;
		text-decoration: none;
		flex-shrink: 0;
	}

	.bluesky-link:hover {
		color: #1185fe;
	}

	.status-link:hover {
		color: var(--accent);
	}

	.tangled-icon {
		border-radius: 4px;
		opacity: 0.7;
		transition: opacity 0.2s, box-shadow 0.2s;
	}

	.tangled-link:hover .tangled-icon {
		opacity: 1;
		box-shadow: 0 0 0 2px var(--accent);
	}

	h1 {
		font-size: 1.5rem;
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
		color: var(--accent);
		background: var(--bg-tertiary);
		border-color: var(--border-default);
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
		background: var(--bg-tertiary);
		border-radius: 6px;
		border: 1px solid var(--border-default);
		transition: all 0.2s;
		white-space: nowrap;
	}

	.user-handle:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--bg-hover);
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

	/* Hide margin-positioned elements and switch to mobile layout at the same breakpoint.
	   Account for queue panel (320px) potentially being open - need extra headroom */
	@media (max-width: 1599px) {
		.margin-left,
		.logout-right {
			display: none !important;
		}

		.desktop-only {
			display: none !important;
		}

		.mobile-only {
			display: flex;
		}

		.brand {
			margin-left: 0;
		}
	}

	/* Smaller screens: compact header */
	@media (max-width: 768px) {
		.header-content {
			padding: 0.75rem 0.75rem;
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

		.btn-primary {
			font-size: 0.8rem;
			padding: 0.3rem 0.65rem;
		}
	}
</style>
