<script lang="ts">
	import { hasPlayableLossless } from '$lib/audio-support';

	interface Props {
		originalFileType: string | null | undefined;
	}

	let { originalFileType }: Props = $props();

	// only show if browser can play this lossless format
	let showBadge = $derived(hasPlayableLossless(originalFileType));
</script>

{#if showBadge}
	<span class="lossless-badge" title="lossless audio available">
		<svg class="lossless-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
			<!-- diamond/gem icon suggesting quality -->
			<path
				d="M8 1L14 6L8 15L2 6L8 1Z"
				stroke="currentColor"
				stroke-width="1.2"
				fill="none"
				stroke-linejoin="round"
			/>
			<path d="M2 6H14" stroke="currentColor" stroke-width="1.2" />
			<path d="M8 1L6 6L8 15L10 6L8 1Z" stroke="currentColor" stroke-width="1.2" fill="none" />
		</svg>
		<span class="lossless-label">lossless</span>
	</span>
{/if}

<style>
	.lossless-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.1rem 0.4rem;
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--accent) 20%, transparent),
			color-mix(in srgb, var(--accent) 10%, transparent)
		);
		border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
		border-radius: var(--radius-sm);
		color: var(--accent);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		white-space: nowrap;
		cursor: default;
	}

	.lossless-icon {
		width: 10px;
		height: 10px;
		flex-shrink: 0;
	}

	.lossless-label {
		line-height: 1;
	}

	/* subtle shimmer effect on hover */
	.lossless-badge:hover {
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--accent) 25%, transparent),
			color-mix(in srgb, var(--accent) 15%, transparent)
		);
		border-color: color-mix(in srgb, var(--accent) 40%, transparent);
	}
</style>
