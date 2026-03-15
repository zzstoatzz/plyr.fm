<script lang="ts">
	import { preferences } from "$lib/preferences.svelte";

	let enabled = $derived(
		preferences.uiSettings.pds_audio_uploads_enabled ?? false,
	);
</script>

<span class="tooltip-wrapper">
	<span class="tooltip-icon">?</span>
	<span class="tooltip-content">
		{#if enabled}
			uploads are stored on your PDS.
			<a href="https://docs.plyr.fm/artists/#your-data" target="_blank" rel="noopener">learn more</a>
		{:else}
			PDS audio uploads available in <a href="/settings">settings</a>.
			<a href="https://docs.plyr.fm/artists/#your-data" target="_blank" rel="noopener">learn more</a>
		{/if}
	</span>
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
		display: none;
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
	}

	.tooltip-wrapper:hover .tooltip-content {
		display: block;
	}

	.tooltip-content a {
		color: var(--accent);
		text-decoration: none;
	}

	.tooltip-content a:hover {
		text-decoration: underline;
	}
</style>
