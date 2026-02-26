<script lang="ts">
	import { preferences } from "$lib/preferences.svelte";

	let enabled = $derived(preferences.uiSettings.pds_audio_uploads_enabled ?? false);
</script>

{#if !enabled}
	<p class="pds-note">
		pds audio uploads available in <a href="/settings">settings</a>
	</p>
{:else}
	<p class="pds-note">uploads will be stored on your pds</p>
{/if}

<style>
	.pds-note {
		margin-top: 0.5rem;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.pds-note a {
		color: var(--accent);
		text-decoration: none;
	}

	.pds-note a:hover {
		text-decoration: underline;
	}
</style>
