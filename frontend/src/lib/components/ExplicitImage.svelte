<script lang="ts">
	import { preferences } from '$lib/preferences.svelte';
	import { moderation } from '$lib/moderation.svelte';

	interface Props {
		/** image URL to check for explicit content */
		src: string | null | undefined;
		/** content to render (should include the img element) */
		children: import('svelte').Snippet;
		/** tooltip position - 'above' for small images, 'center' for large */
		tooltipPosition?: 'above' | 'center';
	}

	let { src, children, tooltipPosition = 'above' }: Props = $props();

	let isExplicit = $derived(moderation.isExplicit(src));
	let shouldBlur = $derived(isExplicit && !preferences.showExplicitArtwork);
</script>

<div class="explicit-wrapper" class:blur={shouldBlur} class:tooltip-center={tooltipPosition === 'center'}>
	{@render children()}
	{#if shouldBlur}
		<div class="explicit-tooltip">
			<span>explicit - enable in portal</span>
		</div>
	{/if}
</div>

<style>
	.explicit-wrapper {
		position: relative;
		display: contents;
	}

	.explicit-wrapper.blur {
		display: block;
		position: relative;
	}

	.explicit-wrapper.blur :global(img) {
		filter: blur(12px);
		transition: filter 0.2s;
	}

	.explicit-wrapper.blur:hover :global(img) {
		filter: blur(6px);
	}

	/* larger blur for centered tooltip (detail pages) */
	.explicit-wrapper.blur.tooltip-center :global(img) {
		filter: blur(20px);
	}

	.explicit-wrapper.blur.tooltip-center:hover :global(img) {
		filter: blur(10px);
	}

	/* default: tooltip appears above the image, aligned left (for player/small images) */
	.explicit-tooltip {
		position: absolute;
		bottom: 100%;
		left: 0;
		margin-bottom: 4px;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		padding: 0.25rem 0.5rem;
		font-size: 0.7rem;
		color: var(--text-tertiary);
		white-space: nowrap;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s;
		z-index: 100;
	}

	/* centered tooltip for large images (detail pages) */
	.tooltip-center .explicit-tooltip {
		top: 50%;
		bottom: auto;
		left: 50%;
		transform: translate(-50%, -50%);
		margin-bottom: 0;
		padding: 0.5rem 0.75rem;
		font-size: 0.8rem;
	}

	.explicit-wrapper.blur:hover .explicit-tooltip {
		opacity: 1;
	}
</style>
