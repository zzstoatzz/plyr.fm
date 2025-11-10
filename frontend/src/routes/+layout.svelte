<script lang="ts">
	import logo from '$lib/assets/logo.png';
	import {
		APP_NAME,
		APP_TAGLINE,
		APP_CANONICAL_URL
	} from '$lib/branding';
	import Player from '$lib/components/Player.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import Queue from '$lib/components/Queue.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	let { children } = $props();
	let showQueue = $state(false);

	onMount(() => {
		// redirect pages.dev domains to plyr.fm unless bypass password is provided
		if (window.location.hostname.endsWith('.pages.dev')) {
			const bypassPassword = sessionStorage.getItem('pages_dev_bypass');
			const BYPASS_SECRET = 'plyr-staging-2024'; // change this to your preferred password

			if (bypassPassword !== BYPASS_SECRET) {
				const password = prompt('This is a staging environment. Enter password to continue, or click Cancel to go to production:');

				if (password === BYPASS_SECRET) {
					sessionStorage.setItem('pages_dev_bypass', password);
				} else {
					// redirect to production
					const currentPath = window.location.pathname + window.location.search + window.location.hash;
					window.location.href = `https://plyr.fm${currentPath}`;
					return;
				}
			}
		}

		// apply saved accent color from localStorage
		const savedAccent = localStorage.getItem('accentColor');
		if (savedAccent) {
			document.documentElement.style.setProperty('--accent', savedAccent);
			document.documentElement.style.setProperty('--accent-hover', getHoverColor(savedAccent));
		}

		// restore queue visibility preference
		const savedQueueVisibility = localStorage.getItem('showQueue');
		if (savedQueueVisibility !== null) {
			showQueue = savedQueueVisibility === 'true';
		}
	});

	function getHoverColor(hex: string): string {
		// lighten the accent color by mixing with white
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgb(${Math.min(255, r + 30)}, ${Math.min(255, g + 30)}, ${Math.min(255, b + 30)})`;
	}

	function toggleQueue() {
		showQueue = !showQueue;
		localStorage.setItem('showQueue', showQueue.toString());
	}
</script>

<svelte:head>
	<link rel="icon" href={logo} />

	<!-- default meta tags for link previews -->
	<title>{APP_NAME} - {APP_TAGLINE}</title>
	<meta
		name="description"
		content={`discover and stream audio on the AT Protocol with ${APP_NAME}`}
	/>

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="website" />
	<meta property="og:title" content="{APP_NAME} - {APP_TAGLINE}" />
	<meta
		property="og:description"
		content={`discover and stream audio on the AT Protocol with ${APP_NAME}`}
	/>
	<meta property="og:site_name" content={APP_NAME} />
	<meta property="og:url" content={APP_CANONICAL_URL} />
	<meta property="og:image" content={logo} />

	<!-- Twitter -->
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content="{APP_NAME} - {APP_TAGLINE}" />
	<meta
		name="twitter:description"
		content={`discover and stream audio on the AT Protocol with ${APP_NAME}`}
	/>
	<meta name="twitter:image" content={logo} />

	<script>
		// prevent flash by applying saved settings immediately
		if (typeof window !== 'undefined') {
			(function() {
				const savedAccent = localStorage.getItem('accentColor');
				if (savedAccent) {
					document.documentElement.style.setProperty('--accent', savedAccent);
					// simple lightening for hover state
					const r = parseInt(savedAccent.slice(1, 3), 16);
					const g = parseInt(savedAccent.slice(3, 5), 16);
					const b = parseInt(savedAccent.slice(5, 7), 16);
					const hover = `rgb(${Math.min(255, r + 30)}, ${Math.min(255, g + 30)}, ${Math.min(255, b + 30)})`;
					document.documentElement.style.setProperty('--accent-hover', hover);
				}
			})();
		}
	</script>
</svelte:head>

<div class="app-layout">
	<main class="main-content" class:with-queue={showQueue}>
		{@render children?.()}
	</main>

	{#if showQueue}
		<aside class="queue-sidebar">
			<Queue />
		</aside>
	{/if}
</div>

<button class="queue-toggle" onclick={toggleQueue} title={showQueue ? 'hide queue' : 'show queue'}>
	<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
		<line x1="3" y1="6" x2="21" y2="6"></line>
		<line x1="3" y1="12" x2="21" y2="12"></line>
		<line x1="3" y1="18" x2="21" y2="18"></line>
	</svg>
</button>

<Player />
<Toast />

<style>
	:global(*),
	:global(*::before),
	:global(*::after) {
		box-sizing: border-box;
	}

	:global(:root) {
		/* accent colors - configurable */
		--accent: #6a9fff;
		--accent-hover: #8ab3ff;
		--accent-muted: #4a7ddd;

		/* backgrounds */
		--bg-primary: #0a0a0a;
		--bg-secondary: #141414;
		--bg-tertiary: #1a1a1a;
		--bg-hover: #1f1f1f;

		/* borders */
		--border-subtle: #282828;
		--border-default: #333333;
		--border-emphasis: #444444;

		/* text */
		--text-primary: #e8e8e8;
		--text-secondary: #b0b0b0;
		--text-tertiary: #808080;
		--text-muted: #666666;

		/* semantic */
		--success: #4ade80;
		--warning: #fbbf24;
		--error: #ef4444;
	}

	:global(body) {
		margin: 0;
		padding: 0;
		font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Consolas', monospace;
		background: var(--bg-primary);
		color: var(--text-primary);
		-webkit-font-smoothing: antialiased;
	}

	.app-layout {
		display: flex;
		min-height: 100vh;
		width: 100%;
		overflow-x: hidden;
	}

	.main-content {
		flex: 1;
		min-width: 0;
		width: 100%;
		transition: margin-right 0.3s ease;
	}

	.main-content.with-queue {
		margin-right: 360px;
	}

	.queue-sidebar {
		position: fixed;
		top: 0;
		right: 0;
		width: min(360px, 100%);
		height: 100vh;
		background: var(--bg-primary);
		border-left: 1px solid var(--border-subtle);
		z-index: 50;
	}

	.queue-toggle {
		position: fixed;
		bottom: calc(var(--player-height, 0px) + 20px + env(safe-area-inset-bottom, 0px));
		right: 20px;
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		color: var(--text-secondary);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
		z-index: 60;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	.queue-toggle:hover {
		background: var(--bg-hover);
		color: var(--accent);
		border-color: var(--accent);
		transform: scale(1.05);
	}

	@media (max-width: 768px) {
		.main-content.with-queue {
			margin-right: 0;
		}

		.queue-sidebar {
			width: 100%;
		}

		.queue-toggle {
			bottom: calc(var(--player-height, 0px) + 20px + env(safe-area-inset-bottom, 0px));
		}
	}
</style>
