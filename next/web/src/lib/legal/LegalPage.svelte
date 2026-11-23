<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';

	let { title, updated, other, children }: { title: string; updated: string; other: { route: '/(app)/terms' | '/(app)/privacy'; label: string }; children: Snippet } = $props();
</script>

<svelte:head>
	<title>{title.toLowerCase()} · plyr.fm</title>
	<meta name="description" content="{title} for plyr.fm" />
</svelte:head>

<article class="page-content legal">
	<h1>{title}</h1>
	<p class="updated">last updated {updated}</p>
	{@render children()}
	<nav><a href={resolve(other.route)}>{other.label}</a></nav>
</article>

<style>
	/* prose reads best around 70 characters a line, so the text keeps a measure while the page stays full width */
	.legal { line-height: 1.7; }
	.legal > :global(*) { max-width: 44rem; }
	h1 { font-size: clamp(1.6rem, 4vw, 2.1rem); margin: 0 0 0.35rem; }
	.updated { color: var(--muted); font-size: var(--t-14); margin: 0 0 2rem; }
	.legal :global(h2) { font-size: var(--t-18); margin: 2rem 0 0.6rem; }
	.legal :global(p), .legal :global(ul), .legal :global(address) { margin: 0 0 1rem; color: var(--muted); }
	.legal :global(strong) { color: var(--text); }
	.legal :global(a) { color: var(--accent); }
	.legal :global(ul) { padding-left: 1.4rem; }
	.legal :global(li) { margin-bottom: 0.35rem; }
	.legal :global(address) { font-style: normal; padding: 1rem; background: var(--surface); border: 1px solid var(--line); border-radius: 0.65rem; }
	nav { margin-top: 2.5rem; padding-top: 1.25rem; border-top: 1px solid var(--line); }
</style>
