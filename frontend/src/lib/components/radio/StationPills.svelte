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
		display: flex;
		flex-wrap: wrap;
		align-self: center;
		justify-content: center;
		gap: 0.35rem;
		max-width: 100%;
	}

	/* independent chips (not a fixed segmented bar) so the row wraps cleanly as
	   the lineup grows and labels vary in width (e.g. "deep cuts") */
	.pill {
		appearance: none;
		background: var(--bg-secondary);
		color: var(--text-secondary);
		border: 1px solid var(--border-subtle);
		font-family: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		text-transform: lowercase;
		white-space: nowrap;
		padding: 0.3rem 0.85rem;
		border-radius: var(--radius-full);
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease,
			border-color 0.15s ease;
		-webkit-tap-highlight-color: transparent;
	}

	.pill:hover {
		color: var(--text-primary);
		border-color: var(--border-default);
	}

	.pill.active {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--bg-primary);
	}
</style>
