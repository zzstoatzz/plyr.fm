<script lang="ts">
	import type { RadioStation } from '$lib/radio.svelte';

	let {
		stations,
		activeSlug,
		onSelect
	}: {
		stations: RadioStation[];
		activeSlug: string | null;
		onSelect: (slug: string) => void;
	} = $props();
</script>

{#if stations.length > 1}
	<div class="station-pills" role="tablist" aria-label="radio stations">
		{#each stations as s (s.slug)}
			<button
				type="button"
				role="tab"
				aria-selected={s.slug === activeSlug}
				class="pill"
				class:active={s.slug === activeSlug}
				title={s.description}
				onclick={() => onSelect(s.slug)}
			>
				{s.name}
			</button>
		{/each}
	</div>
{/if}

<style>
	.station-pills {
		display: inline-flex;
		align-self: center;
		gap: 0.25rem;
		padding: 0.2rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-full);
	}

	.pill {
		appearance: none;
		border: none;
		background: transparent;
		color: var(--text-secondary);
		font-family: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		text-transform: lowercase;
		padding: 0.3rem 0.85rem;
		border-radius: var(--radius-full);
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
		-webkit-tap-highlight-color: transparent;
	}

	.pill:hover {
		color: var(--text-primary);
	}

	.pill.active {
		background: var(--accent);
		color: var(--bg-primary);
	}
</style>
