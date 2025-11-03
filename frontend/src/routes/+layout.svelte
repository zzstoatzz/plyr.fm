<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import Player from '$lib/components/Player.svelte';
	import { onMount } from 'svelte';

	let { children } = $props();

	onMount(() => {
		// apply saved accent color from localStorage
		const savedAccent = localStorage.getItem('accentColor');
		if (savedAccent) {
			document.documentElement.style.setProperty('--accent', savedAccent);
			document.documentElement.style.setProperty('--accent-hover', getHoverColor(savedAccent));
		}
	});

	function getHoverColor(hex: string): string {
		// lighten the accent color by mixing with white
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgb(${Math.min(255, r + 30)}, ${Math.min(255, g + 30)}, ${Math.min(255, b + 30)})`;
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />

	<!-- default meta tags for link previews -->
	<title>relay - music streaming on atproto</title>
	<meta name="description" content="discover and stream music on the atproto network" />

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="website" />
	<meta property="og:title" content="relay - music streaming on atproto" />
	<meta property="og:description" content="discover and stream music on the atproto network" />
	<meta property="og:site_name" content="relay" />

	<!-- Twitter -->
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content="relay - music streaming on atproto" />
	<meta name="twitter:description" content="discover and stream music on the atproto network" />

	<script>
		// prevent flash by applying saved settings immediately
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
	</script>
</svelte:head>

{@render children?.()}
<Player />

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
</style>
