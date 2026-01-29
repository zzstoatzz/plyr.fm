<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import { PDS_AUDIO_UPLOADS_FLAG } from '$lib/config';
	import { preferences } from '$lib/preferences.svelte';
	import { toast } from '$lib/toast.svelte';

	let visible = $derived(auth.user?.enabled_flags?.includes(PDS_AUDIO_UPLOADS_FLAG) ?? false);
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

<style>
	.setting-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1.5rem;
		padding: 0.75rem 0;
	}

	.setting-info {
		flex: 1;
		min-width: 0;
	}

	.setting-info h3 {
		margin: 0 0 0.25rem;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--text-primary);
	}

	.setting-info p {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		line-height: 1.4;
	}

	.toggle-switch {
		position: relative;
		display: inline-block;
		flex-shrink: 0;
	}

	.toggle-switch input {
		opacity: 0;
		width: 0;
		height: 0;
		position: absolute;
	}

	.toggle-slider {
		display: block;
		width: 48px;
		height: 28px;
		background: var(--border-default);
		border-radius: var(--radius-full);
		position: relative;
		cursor: pointer;
		transition: background 0.2s;
	}

	.toggle-slider::after {
		content: '';
		position: absolute;
		top: 4px;
		left: 4px;
		width: 20px;
		height: 20px;
		border-radius: var(--radius-full);
		background: var(--text-secondary);
		transition: transform 0.2s, background 0.2s;
	}

	.toggle-switch input:checked + .toggle-slider {
		background: color-mix(in srgb, var(--accent) 65%, transparent);
	}

	.toggle-switch input:checked + .toggle-slider::after {
		transform: translateX(20px);
		background: var(--accent);
	}
</style>
