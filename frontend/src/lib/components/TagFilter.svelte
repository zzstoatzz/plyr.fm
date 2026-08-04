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

	// the selected chips render from the selection itself, not the fetched tag
	// list — a selection restored from a previous session may not be in the
	// current top tags, and it must still be visible and deselectable. counts
	// come from the fetched list when known.
	let selectedList = $derived(
		[...selectedTags].map(
			(name) => tags.find((t) => t.name === name) ?? { name, track_count: null }
		)
	);

	// the scroller holds only what isn't already pinned, by popularity
	let unselectedTags = $derived(
		tags
			.filter((t) => !hiddenTags.includes(t.name) && !selectedTags.has(t.name))
			.toSorted((a, b) => b.total_plays - a.total_plays)
	);

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

{#if loaded && (unselectedTags.length > 0 || selectedTags.size > 0)}
	<div class="tag-filter-row">
		{#if selectedTags.size > 0}
			<!-- the active selection is pinned: clear + every selected chip stay
			     visible (and individually deselectable) no matter how far the
			     tag scroller is scrolled -->
			<div class="pinned">
				<button type="button" class="chip clear-chip" onclick={clearSelection}>
					clear
				</button>
				{#each selectedList as tag (tag.name)}
					<button
						type="button"
						class="chip selected"
						style={chipStyle(tag.name, true)}
						onclick={() => toggle(tag.name)}
						title={`deselect ${tag.name}`}
					>
						{tag.name}
						{#if tag.track_count !== null}
							<span class="count">({tag.track_count})</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
		<div class="scroller">
			{#each unselectedTags as tag (tag.name)}
				<button
					type="button"
					class="chip"
					style={chipStyle(tag.name, false)}
					onclick={() => toggle(tag.name)}
				>
					{tag.name}
					<span class="count">({tag.track_count})</span>
				</button>
			{/each}
		</div>
	</div>
{/if}

<style>
	.tag-filter-row {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding-bottom: 0.25rem;
		flex: 1;
		min-width: 0;
	}

	/* the active selection: never scrolls away. wraps onto more lines when many
	   tags are selected, and yields at most ~2/3 of the row so the scroller
	   always keeps discoverable space. */
	.pinned {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		flex: 0 1 auto;
		max-width: 66%;
		padding-right: 0.5rem;
		border-right: 1px solid var(--border-subtle);
	}

	.scroller {
		display: flex;
		gap: 0.5rem;
		overflow-x: auto;
		scrollbar-width: none;
		scroll-snap-type: x proximity;
		flex: 1;
		min-width: 0;
	}

	.scroller::-webkit-scrollbar {
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
