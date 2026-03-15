<script lang="ts">
	import { preferences } from "$lib/preferences.svelte";
	import InfoTooltip from "./InfoTooltip.svelte";

	let enabled = $derived(
		preferences.uiSettings.pds_audio_uploads_enabled ?? false,
	);
</script>

<InfoTooltip label="PDS storage info">
	{#if enabled}
		uploads are stored on your PDS.
		<a href="https://docs.plyr.fm/artists/#your-data" target="_blank" rel="noopener">learn more</a>
	{:else}
		PDS audio uploads available in <a href="/settings">settings</a>.
		<a href="https://docs.plyr.fm/artists/#your-data" target="_blank" rel="noopener">learn more</a>
	{/if}
</InfoTooltip>
