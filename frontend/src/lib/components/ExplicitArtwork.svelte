<script lang="ts">
	import { preferences } from '$lib/preferences.svelte';

	interface Props {
		isExplicit?: boolean;
		children: import('svelte').Snippet;
		/** tooltip position - 'above' for small images, 'center' for large */
		tooltipPosition?: 'above' | 'center';
	}

	let { isExplicit = false, children, tooltipPosition = 'above' }: Props = $props();

	let shouldBlur = $derived(isExplicit && !preferences.showExplicitArtwork);
</script>

<div class="explicit-wrapper" class:blur={shouldBlur} class:tooltip-center={tooltipPosition === 'center'}>
	{@render children()}
	{#if shouldBlur}
		<div class="explicit-tooltip">
			<span>explicit artwork - enable in <a href="/portal">portal</a> or DM <a href="https://bsky.app/profile/plyr.fm" target="_blank" rel="noopener">@plyr.fm</a></span>
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

	.explicit-tooltip {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%);
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 6px;
		padding: 0.5rem 0.75rem;
		font-size: 0.75rem;
		color: var(--text-secondary);
		white-space: nowrap;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s;
		z-index: 100;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	.explicit-tooltip::after {
		content: '';
		position: absolute;
		top: 100%;
		left: 50%;
		transform: translateX(-50%);
		border: 6px solid transparent;
		border-top-color: var(--border-default);
	}

	/* centered tooltip for large images */
	.tooltip-center .explicit-tooltip {
		bottom: auto;
		top: 50%;
		transform: translate(-50%, -50%);
		padding: 0.75rem 1rem;
		font-size: 0.85rem;
		text-align: center;
		max-width: 90%;
		white-space: normal;
	}

	.tooltip-center .explicit-tooltip::after {
		display: none;
	}

	.explicit-wrapper.blur:hover .explicit-tooltip {
		opacity: 1;
		pointer-events: auto;
	}

	.explicit-tooltip a {
		color: var(--accent);
		text-decoration: none;
	}

	.explicit-tooltip a:hover {
		text-decoration: underline;
	}
</style>
