<script lang="ts">
	import { hasPlayableLossless, isLosslessFormat } from '$lib/audio-support';

	interface Props {
		originalFileType: string | null | undefined;
		fileType?: string | null | undefined;
		withSeparator?: boolean;
		separatorClass?: string;
	}

	let { originalFileType, fileType, withSeparator = false, separatorClass = '' }: Props = $props();

	// show if browser can play the lossless original, or if the file type itself is lossless
	let showBadge = $derived(hasPlayableLossless(originalFileType) || isLosslessFormat(fileType));
</script>

{#if showBadge}
	{#if withSeparator}<span class={separatorClass}>•</span>{/if}
	<span class="lossless-badge" title="lossless audio">
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
	</span>
{/if}

<style>
	.lossless-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.15rem;
		color: var(--accent);
		cursor: default;
	}

	.lossless-icon {
		width: 12px;
		height: 12px;
		flex-shrink: 0;
	}
</style>
