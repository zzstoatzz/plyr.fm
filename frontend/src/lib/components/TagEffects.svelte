<script lang="ts">
	/**
	 * TagEffects - extensible tag-based visual effects system
	 *
	 * This component renders visual effects based on track tags.
	 * Currently supports:
	 *   - "bufo": animated toad GIFs matched semantically to track title
	 *
	 * Future: This could be extended to support user-defined plugins
	 * that register custom effects for arbitrary tags.
	 */
	import BufoEasterEgg from './BufoEasterEgg.svelte';

	interface Props {
		tags: string[];
		trackTitle: string;
	}

	let { tags, trackTitle }: Props = $props();

	// registry of tag -> effect component
	// future: this could be loaded dynamically from user-defined plugins
	const hasBufo = $derived(tags.includes('bufo'));
</script>

{#if hasBufo}
	<BufoEasterEgg query={trackTitle} />
{/if}

<!--
	Future plugin system could look like:

	{#each activeEffects as effect}
		<svelte:component this={effect.component} {...effect.props} />
	{/each}

	Where activeEffects is derived from matching tags against a plugin registry.
	Each plugin would define:
	- tag: string (the tag that triggers it)
	- component: SvelteComponent (the effect to render)
	- getProps: (track) => object (how to derive props from track data)
-->
