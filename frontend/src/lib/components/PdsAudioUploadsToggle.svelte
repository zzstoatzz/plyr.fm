<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import { preferences } from '$lib/preferences.svelte';
	import { toast } from '$lib/toast.svelte';

	const PDS_AUDIO_FLAG = 'pds-audio-uploads';

	let visible = $derived(auth.user?.enabled_flags?.includes(PDS_AUDIO_FLAG) ?? false);
	let enabled = $derived(preferences.uiSettings.pds_audio_uploads_enabled ?? false);

	async function handleToggle(event: Event) {
		const input = event.target as HTMLInputElement;
		const nextEnabled = input.checked;
		await preferences.updateUiSettings({ pds_audio_uploads_enabled: nextEnabled });
		toast.success(
			nextEnabled
				? 'pds audio uploads enabled (best-effort)'
				: 'pds audio uploads disabled'
		);
	}
</script>

{#if visible}
	<div class="setting-row">
		<div class="setting-info">
			<h3>store audio on your pds</h3>
			<p>attempt to store uploaded audio blobs on your pds (falls back to r2 if too large)</p>
		</div>
		<label class="toggle-switch">
			<input type="checkbox" checked={enabled} onchange={handleToggle} />
			<span class="toggle-slider"></span>
		</label>
	</div>
{/if}
