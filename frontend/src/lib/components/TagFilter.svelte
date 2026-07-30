<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { API_URL } from '$lib/config';
	import { tracksCache } from '$lib/tracks.svelte';

	interface Tag {
		name: string;
		track_count: number;
		total_plays: number;
	}

	interface Props {
		onTagsChange: (tags: string[]) => void;
		hiddenTags?: string[];
	}

	let { onTagsChange, hiddenTags = [] }: Props = $props();

	let tags = $state<Tag[]>([]);
	let selectedTags = new SvelteSet<string>(tracksCache.activeTags);
	let loaded = $state(false);

	// selected tags sort to the front, then by track count
	let visibleTags = $derived(
		tags
			.filter((t) => !hiddenTags.includes(t.name))
			.toSorted((a, b) => {
				const aSelected = selectedTags.has(a.name) ? 1 : 0;
				const bSelected = selectedTags.has(b.name) ? 1 : 0;
				return bSelected - aSelected || b.total_plays - a.total_plays;
			})
	);


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
				aria-pressed={selectedTags.has(tag.name)}
				onclick={() => toggle(tag.name)}
			>
				{tag.name}
				<span class="count">({tag.track_count})</span>
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
		flex: 1;
		min-width: 0;
	}

	.tag-filter-row::-webkit-scrollbar {
		display: none;
	}

	.chip {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.3rem 0.7rem;
		background: transparent;
		border: 1px solid transparent;
		color: var(--text-secondary);
		border-radius: var(--radius-full);
		font-size: var(--text-sm);
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
		scroll-snap-align: start;
	}

	.chip:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.chip.selected {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-contrast);
		font-weight: 600;
	}

	.chip:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.count {
		opacity: 0.6;
		font-size: inherit;
	}

	.clear-chip {
		color: var(--text-tertiary) !important;
		border-color: var(--border-subtle) !important;
		border-style: dashed;
		background: transparent !important;
	}

	.clear-chip:hover {
		border-color: var(--error) !important;
		color: var(--error) !important;
		background: transparent !important;
	}
</style>
