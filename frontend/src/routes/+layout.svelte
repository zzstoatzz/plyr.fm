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
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { auth } from '$lib/auth.svelte';
	import { browser } from '$app/environment';

	let { children } = $props();
	let showQueue = $state(false);

	// only show default meta tags on pages without their own specific metadata
	let hasPageMetadata = $derived(
		$page.url.pathname === '/' || // homepage has its own metadata
		$page.url.pathname.startsWith('/track/') || // track pages have specific metadata
		$page.url.pathname.match(/^\/u\/[^/]+\/album\/[^/]+/) // album pages have specific metadata
	);

	// initialize auth on mount
	if (browser) {
		void auth.initialize();
	}

	function handleQueueShortcut(event: KeyboardEvent) {
		// ignore modifier keys
		if (event.metaKey || event.ctrlKey || event.altKey) {
			return;
		}

		// ignore if inside input/textarea/contenteditable
		const target = event.target as HTMLElement;
		if (
			target.tagName === 'INPUT' ||
			target.tagName === 'TEXTAREA' ||
			target.isContentEditable
		) {
			return;
		}

		// toggle queue on 'q' key
		if (event.key.toLowerCase() === 'q') {
			event.preventDefault();
			toggleQueue();
		}
	}

	onMount(() => {
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

		// add keyboard listener for queue toggle
		window.addEventListener('keydown', handleQueueShortcut);
	});

	onDestroy(() => {
		// cleanup keyboard listener
		if (browser) {
			window.removeEventListener('keydown', handleQueueShortcut);
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
	<link rel="manifest" href="/manifest.webmanifest" />
	<meta name="theme-color" content="#0a0a0a" />

	{#if !hasPageMetadata}
		<!-- default meta tags for pages without specific metadata -->
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
	{/if}

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

<button
	class="queue-toggle"
	onclick={toggleQueue}
	aria-pressed={showQueue}
	aria-label="toggle queue (Q)"
	title={showQueue ? 'hide queue (Q)' : 'show queue (Q)'}
>
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

		/* typography scale */
		--text-page-heading: 1.5rem;
		--text-section-heading: 1.2rem;
		--text-body: 1rem;
		--text-small: 0.9rem;

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
		min-height: 100vh; /* fallback for browsers without dvh support */
		width: 100%;
		overflow-x: hidden;
	}

	@supports (min-height: 100dvh) {
		.app-layout {
			min-height: 100dvh; /* dynamic viewport height (accounts for mobile browser UI) */
		}
	}

	.main-content {
		flex: 1;
		min-width: 0;
		width: 100%;
		transition: margin-right 0.3s ease;
		padding-bottom: calc(var(--player-height, 0px) + 2rem + env(safe-area-inset-bottom, 0px));
	}

	.main-content.with-queue {
		margin-right: 360px;
	}

	.queue-sidebar {
		position: fixed;
		top: 0;
		right: 0;
		width: min(360px, 100%);
		height: 100vh; /* fallback for browsers without dvh support */
		background: var(--bg-primary);
		border-left: 1px solid var(--border-subtle);
		z-index: 50;
	}

	@supports (height: 100dvh) {
		.queue-sidebar {
			height: 100dvh; /* dynamic viewport height (accounts for mobile browser UI) */
		}
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
		transform: translate3d(0, var(--visual-viewport-offset, 0px), 0);
		will-change: transform;
	}

	.queue-toggle:hover {
		background: var(--bg-hover);
		color: var(--accent);
		border-color: var(--accent);
		transform: translate3d(0, var(--visual-viewport-offset, 0px), 0) scale(1.05);
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
