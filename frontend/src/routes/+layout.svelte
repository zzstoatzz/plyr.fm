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
	import SearchModal from '$lib/components/SearchModal.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { afterNavigate } from '$app/navigation';
	import { auth } from '$lib/auth.svelte';
	import { preferences } from '$lib/preferences.svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { search } from '$lib/search.svelte';
	import { browser } from '$app/environment';
	import type { LayoutData } from './$types';

	let { children, data } = $props<{ children: any; data: LayoutData }>();
	let showQueue = $state(false);

	// pages that define their own <title> in svelte:head
	let hasPageMetadata = $derived(
		$page.url.pathname === '/' || // homepage
		$page.url.pathname.startsWith('/track/') || // track detail
		$page.url.pathname === '/liked' || // liked tracks
		$page.url.pathname.match(/^\/u\/[^/]+$/) || // artist detail
		$page.url.pathname.match(/^\/u\/[^/]+\/album\/[^/]+/) // album detail
	);

	let isEmbed = $derived($page.url.pathname.startsWith('/embed/'));

	// sync auth and preferences state from layout data (fetched by +layout.ts)
	$effect(() => {
		if (browser) {
			auth.user = data.user;
			auth.isAuthenticated = data.isAuthenticated;
			auth.loading = false;
			preferences.data = data.preferences;
		}
	});

	// document title: show playing track, or fall back to page title
	let pageTitle = $state(`${APP_NAME} - ${APP_TAGLINE}`);

	function updateTitle() {
		const track = player.currentTrack;
		const playing = track && !player.paused;
		document.title = playing
			? `${track.title} - ${track.artist} • ${APP_NAME}`
			: pageTitle;
	}

	afterNavigate(() => {
		// capture page title after svelte:head renders, then apply correct title
		window.requestAnimationFrame(() => {
			const currentTitle = document.title;
			if (!currentTitle.includes(` • ${APP_NAME}`)) {
				pageTitle = currentTitle;
			}
			updateTitle();
		});
	});

	// react to play/pause changes
	$effect(() => {
		if (!browser) return;
		player.currentTrack;
		player.paused;
		updateTitle();
	});

	// set CSS custom property for queue width adjustment
	$effect(() => {
		if (!browser) return;
		const queueWidth = showQueue && !isEmbed ? '360px' : '0px';
		document.documentElement.style.setProperty('--queue-width', queueWidth);
	});

	const SEEK_AMOUNT = 10; // seconds
	let previousVolume = 0.7; // for mute toggle

	function handleKeyboardShortcuts(event: KeyboardEvent) {
		// Cmd/Ctrl+K: toggle search
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			search.toggle();
			return;
		}

		// ignore other modifier keys for remaining shortcuts
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

		// ignore playback shortcuts when search modal is open
		if (search.isOpen) {
			return;
		}

		const key = event.key.toLowerCase();

		// toggle queue on 'q' key
		if (key === 'q') {
			event.preventDefault();
			toggleQueue();
			return;
		}

		// playback shortcuts - only when a track is loaded
		if (!player.currentTrack) {
			return;
		}

		switch (event.key) {
			case ' ': // space - play/pause
				event.preventDefault();
				player.togglePlayPause();
				break;

			case 'ArrowLeft': // seek backward
				event.preventDefault();
				seekBy(-SEEK_AMOUNT);
				break;

			case 'ArrowRight': // seek forward
				event.preventDefault();
				seekBy(SEEK_AMOUNT);
				break;

			case 'j': // previous track (youtube-style)
			case 'J':
				event.preventDefault();
				handlePreviousTrack();
				break;

			case 'l': // next track (youtube-style)
			case 'L':
				event.preventDefault();
				if (queue.hasNext) {
					queue.next();
				}
				break;

			case 'm': // mute/unmute
			case 'M':
				event.preventDefault();
				toggleMute();
				break;
		}
	}

	function seekBy(seconds: number) {
		if (!player.audioElement || !player.duration) return;

		const newTime = Math.max(0, Math.min(player.duration, player.currentTime + seconds));
		player.currentTime = newTime;
		player.audioElement.currentTime = newTime;
	}

	function handlePreviousTrack() {
		const RESTART_THRESHOLD = 3; // restart if more than 3 seconds in

		if (player.currentTime > RESTART_THRESHOLD) {
			// restart current track
			player.currentTime = 0;
			if (player.audioElement) {
				player.audioElement.currentTime = 0;
			}
		} else if (queue.hasPrevious) {
			// go to previous track
			queue.previous();
		} else {
			// restart from beginning
			player.currentTime = 0;
			if (player.audioElement) {
				player.audioElement.currentTime = 0;
			}
		}
	}

	function toggleMute() {
		if (player.volume > 0) {
			previousVolume = player.volume;
			player.volume = 0;
		} else {
			player.volume = previousVolume || 0.7;
		}
	}

	onMount(() => {
		// apply saved accent color from localStorage
		const savedAccent = localStorage.getItem('accentColor');
		if (savedAccent) {
			document.documentElement.style.setProperty('--accent', savedAccent);
			document.documentElement.style.setProperty('--accent-hover', getHoverColor(savedAccent));
		}

		// apply saved theme from localStorage
		const savedTheme = localStorage.getItem('theme') as 'dark' | 'light' | 'system' | null;
		if (savedTheme) {
			preferences.applyTheme(savedTheme);
		} else {
			// default to dark
			document.documentElement.classList.add('theme-dark');
		}

		// restore queue visibility preference
		const savedQueueVisibility = localStorage.getItem('showQueue');
		if (savedQueueVisibility !== null) {
			showQueue = savedQueueVisibility === 'true';
		}

		// add keyboard listener for shortcuts
		window.addEventListener('keydown', handleKeyboardShortcuts);

		// listen for system theme changes
		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		const handleSystemThemeChange = () => {
			const currentTheme = localStorage.getItem('theme');
			if (currentTheme === 'system') {
				preferences.applyTheme('system');
			}
		};
		mediaQuery.addEventListener('change', handleSystemThemeChange);

		return () => {
			mediaQuery.removeEventListener('change', handleSystemThemeChange);
		};
	});

	onDestroy(() => {
		// cleanup keyboard listener
		if (browser) {
			window.removeEventListener('keydown', handleKeyboardShortcuts);
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
				const root = document.documentElement;

				// apply accent color
				const savedAccent = localStorage.getItem('accentColor');
				if (savedAccent) {
					root.style.setProperty('--accent', savedAccent);
					// simple lightening for hover state
					const r = parseInt(savedAccent.slice(1, 3), 16);
					const g = parseInt(savedAccent.slice(3, 5), 16);
					const b = parseInt(savedAccent.slice(5, 7), 16);
					const hover = `rgb(${Math.min(255, r + 30)}, ${Math.min(255, g + 30)}, ${Math.min(255, b + 30)})`;
					root.style.setProperty('--accent-hover', hover);
				}

				// apply theme
				const savedTheme = localStorage.getItem('theme') || 'dark';
				let effectiveTheme = savedTheme;
				if (savedTheme === 'system') {
					effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
				}
				root.classList.add('theme-' + effectiveTheme);
			})();
		}
	</script>
</svelte:head>

<div class="app-layout">
	<main class="main-content" class:with-queue={showQueue && !isEmbed}>
		{@render children?.()}
	</main>

	{#if showQueue && !isEmbed}
		<aside class="queue-sidebar">
			<Queue />
		</aside>
	{/if}
</div>

{#if !isEmbed}
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
{/if}
<Toast />
<SearchModal />

<style>
	:global(*),
	:global(*::before),
	:global(*::after) {
		box-sizing: border-box;
	}

	:global(:root) {
		/* layout */
		--queue-width: 0px;

		/* accent colors - configurable */
		--accent: #6a9fff;
		--accent-hover: #8ab3ff;
		--accent-muted: #4a7ddd;
		--accent-rgb: 106, 159, 255;

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

	/* light theme overrides */
	:global(:root.theme-light) {
		--bg-primary: #fafafa;
		--bg-secondary: #ffffff;
		--bg-tertiary: #f5f5f5;
		--bg-hover: #ebebeb;

		--border-subtle: #e5e5e5;
		--border-default: #d4d4d4;
		--border-emphasis: #a3a3a3;

		--text-primary: #171717;
		--text-secondary: #525252;
		--text-tertiary: #737373;
		--text-muted: #a3a3a3;

		/* accent colors preserved from user preference */
		/* accent-muted darkened for light bg readability */
		--accent-muted: color-mix(in srgb, var(--accent) 70%, black);

		/* semantic colors adjusted for light bg */
		--success: #16a34a;
		--warning: #d97706;
		--error: #dc2626;
	}

	/* light theme specific overrides for components */
	:global(:root.theme-light) :global(.track-container) {
		background: var(--bg-secondary);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
	}

	:global(:root.theme-light) :global(.track-container:hover) {
		background: var(--bg-tertiary);
	}

	:global(:root.theme-light) :global(.track-container.playing) {
		background: color-mix(in srgb, var(--accent) 8%, white);
		border-color: color-mix(in srgb, var(--accent) 30%, white);
	}

	:global(:root.theme-light) :global(header) {
		background: var(--bg-primary);
		border-color: var(--border-default);
	}

	:global(:root.theme-light) :global(.tag-badge) {
		background: color-mix(in srgb, var(--accent) 12%, white);
		color: var(--accent-muted);
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
