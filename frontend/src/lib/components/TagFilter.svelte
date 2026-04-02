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

	/** deterministic hue from tag name (0–360) */
	function tagHue(name: string): number {
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = name.charCodeAt(i) + ((hash << 5) - hash);
		}
		return ((hash % 360) + 360) % 360;
	}

	function chipStyle(name: string, selected: boolean): string {
		const hue = tagHue(name);
		if (selected) {
			return `--chip-hue: ${hue}; background: hsl(${hue} 60% 50% / 0.2); border-color: hsl(${hue} 55% 55%); color: hsl(${hue} 70% 75%);`;
		}
		return `--chip-hue: ${hue}; border-color: hsl(${hue} 30% 40% / 0.4); color: hsl(${hue} 30% 70%);`;
	}

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
				style={chipStyle(tag.name, selectedTags.has(tag.name))}
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
		background: hsl(var(--chip-hue, 0) 50% 50% / 0.1);
		border-color: hsl(var(--chip-hue, 0) 50% 55%);
	}

	.chip.selected {
		font-weight: 600;
	}

	.count {
		opacity: 0.6;
		font-size: 0.65rem;
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
