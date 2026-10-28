<script lang="ts">
	import { preferences } from '$lib/preferences.svelte';
	import InfoTooltip from './InfoTooltip.svelte';

	let enabled = $derived(preferences.uiSettings.pds_audio_uploads_enabled ?? false);
</script>

<InfoTooltip label="PDS storage info">
	{#if enabled}
		public audio is saved on your PDS when it accepts the upload.
		<a href="https://docs.plyr.fm/artists/#your-data" target="_blank" rel="noopener">learn more</a>
	{:else}
		enable public PDS audio uploads in <a href="/settings">settings</a>.
		<a href="https://docs.plyr.fm/artists/#your-data" target="_blank" rel="noopener">learn more</a>
	{/if}
	protected audio uses a Space when your PDS supports it.
</InfoTooltip>
