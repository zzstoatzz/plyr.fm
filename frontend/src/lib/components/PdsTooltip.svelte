<script lang="ts">
	import { preferences } from "$lib/preferences.svelte";

	let enabled = $derived(
		preferences.uiSettings.pds_audio_uploads_enabled ?? false,
	);

	let show = $state(false);
	let hideTimeout: ReturnType<typeof setTimeout> | null = null;

	function enter() {
		if (hideTimeout) {
			clearTimeout(hideTimeout);
			hideTimeout = null;
		}
		show = true;
	}

	function leave() {
		hideTimeout = setTimeout(() => {
			show = false;
			hideTimeout = null;
		}, 150);
	}
</script>

<span
	class="tooltip-wrapper"
	role="button"
	tabindex="0"
	aria-label="PDS storage info"
	aria-expanded={show}
	onmouseenter={enter}
	onmouseleave={leave}
	onfocus={enter}
	onblur={leave}
>
	<span class="tooltip-icon">?</span>
	{#if show}
		<span
			class="tooltip-content"
			role="tooltip"
			onmouseenter={enter}
			onmouseleave={leave}
		>
			{#if enabled}
				uploads are stored on your PDS.
				<a href="https://docs.plyr.fm/artists/#your-data" target="_blank" rel="noopener">learn more</a>
			{:else}
				PDS audio uploads available in <a href="/settings">settings</a>.
				<a href="https://docs.plyr.fm/artists/#your-data" target="_blank" rel="noopener">learn more</a>
			{/if}
		</span>
	{/if}
</span>

<style>
	.tooltip-wrapper {
		position: relative;
		display: inline-flex;
	}

	.tooltip-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 50%;
		border: 1px solid var(--text-tertiary);
		color: var(--text-tertiary);
		font-size: 0.7rem;
		font-weight: 600;
		cursor: help;
		line-height: 1;
	}

	.tooltip-content {
		position: absolute;
		left: 50%;
		top: calc(100% + 0.5rem);
		transform: translateX(-50%);
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		padding: 0.5rem 0.75rem;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		white-space: nowrap;
		z-index: 10;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		pointer-events: auto;
	}

	.tooltip-content a {
		color: var(--accent);
		text-decoration: none;
	}

	.tooltip-content a:hover {
		text-decoration: underline;
	}
</style>
