<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { API_URL } from '$lib/config';

	interface Tag {
		name: string;
		track_count: number;
	}

	interface Props {
		onTagsChange: (tags: string[]) => void;
		hiddenTags?: string[];
	}

	let { onTagsChange, hiddenTags = [] }: Props = $props();

	let tags = $state<Tag[]>([]);
	let selectedTags = new SvelteSet<string>();
	let loaded = $state(false);

	let visibleTags = $derived(tags.filter((t) => !hiddenTags.includes(t.name)));

	onMount(async () => {
		try {
			const res = await fetch(`${API_URL}/tracks/tags?limit=15`);
			if (res.ok) {
				tags = await res.json();
			}
		} catch {
			// silently fail — component renders nothing if no tags
		} finally {
			loaded = true;
		}
	});

	function toggle(tagName: string) {
		if (selectedTags.has(tagName)) {
			selectedTags.delete(tagName);
		} else {
			selectedTags.add(tagName);
		}
		onTagsChange([...selectedTags]);
	}

	function clearSelection() {
		selectedTags.clear();
		onTagsChange([]);
	}
</script>

{#if loaded && visibleTags.length > 0}
	<div class="tag-filter-row">
		{#if selectedTags.size > 0}
			<button type="button" class="chip clear-chip" onclick={clearSelection}>
				clear
			</button>
		{/if}
		{#each visibleTags as tag (tag.name)}
			<button
				type="button"
				class="chip"
				class:selected={selectedTags.has(tag.name)}
				onclick={() => toggle(tag.name)}
			>
				{tag.name} ({tag.track_count})
			</button>
		{/each}
	</div>
{/if}

<style>
	.tag-filter-row {
		display: flex;
		gap: 0.5rem;
		overflow-x: auto;
		scrollbar-width: none;
		scroll-snap-type: x proximity;
		padding-bottom: 0.25rem;
		margin-bottom: 1rem;
	}

	.tag-filter-row::-webkit-scrollbar {
		display: none;
	}

	.chip {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		padding: 0.3rem 0.7rem;
		background: transparent;
		border: 1px solid var(--border-subtle);
		color: var(--text-secondary);
		border-radius: var(--radius-xl);
		font-size: var(--text-xs);
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
		scroll-snap-align: start;
	}

	.chip:hover {
		border-color: var(--accent);
	}

	.chip.selected {
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		border-color: var(--accent);
		color: var(--accent-hover);
	}

	.clear-chip {
		color: var(--text-tertiary);
		border-style: dashed;
	}

	.clear-chip:hover {
		border-color: var(--error);
		color: var(--error);
	}
</style>
