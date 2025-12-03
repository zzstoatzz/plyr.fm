<script lang="ts">
	import { browser } from '$app/environment';
	import { search } from '$lib/search.svelte';

	// detect platform for shortcut display
	const isMac = browser && navigator.platform.toLowerCase().includes('mac');
	const shortcutKey = isMac ? '⌘' : 'Ctrl';
</script>

<button class="search-trigger" onclick={() => search.open()} title="search (⌘K)">
	<svg
		width="14"
		height="14"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<circle cx="11" cy="11" r="8"></circle>
		<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
	</svg>
	<span class="shortcut-hint">{shortcutKey}K</span>
</button>

<style>
	.search-trigger {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.5rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: 6px;
		color: var(--text-tertiary);
		font-family: inherit;
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}

	.search-trigger:hover {
		border-color: var(--accent);
		color: var(--text-secondary);
		background: var(--bg-hover);
	}

	.search-trigger svg {
		flex-shrink: 0;
		opacity: 0.7;
	}

	.search-trigger:hover svg {
		opacity: 1;
		color: var(--accent);
	}

	.shortcut-hint {
		padding: 0.1rem 0.3rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: 3px;
		font-size: 0.65rem;
		font-weight: 500;
		letter-spacing: 0.02em;
	}
</style>
