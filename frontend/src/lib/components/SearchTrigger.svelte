<script lang="ts">
	import { search } from '$lib/search.svelte';
</script>

<button class="search-trigger" onclick={() => search.open()} title="search (⌘K)">
	<svg
		width="16"
		height="16"
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
</button>

<style>
	.search-trigger {
		background: transparent;
		border: 1px solid var(--border-default);
		color: var(--text-secondary);
		padding: 0.5rem;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.search-trigger:hover {
		color: var(--accent);
		border-color: var(--accent);
	}
</style>
