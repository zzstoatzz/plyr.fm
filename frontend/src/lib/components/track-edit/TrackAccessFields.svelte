<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import { COPYRIGHT_PARADIGM_FLAG } from '$lib/config';
	import CopyrightRightsPanel from '$lib/components/CopyrightRightsPanel.svelte';
	import type { TrackRights } from '$lib/components/CopyrightRightsPanel.svelte';
	import type { Track } from '$lib/types';
	interface Props {
		track: Track;
		atprotofansEligible: boolean;
		editSupportGate: boolean;
		editUnlisted: boolean;
		editSelfLabels: string[];
		editCopyrightEnabled: boolean;
		editCopyrightRights: TrackRights;
		replaceCopyrightRights: boolean;
		editCopyrightWasEnabled: boolean;
	}
	let {
		track,
		atprotofansEligible,
		editSupportGate = $bindable(),
		editUnlisted = $bindable(),
		editSelfLabels = $bindable(),
		editCopyrightEnabled = $bindable(),
		editCopyrightRights = $bindable(),
		replaceCopyrightRights = $bindable(),
		editCopyrightWasEnabled
	}: Props = $props();
	const ADULT_SELF_LABELS = new Set(['sexual', 'porn']);
	let editHasSensitiveAudio = $derived(
		editSelfLabels.some((label) => ADULT_SELF_LABELS.has(label))
	);
	function setSensitiveAudio(enabled: boolean) {
		const nonAdult = editSelfLabels.filter((label) => !ADULT_SELF_LABELS.has(label));
		const existingAdult = editSelfLabels.filter((label) => ADULT_SELF_LABELS.has(label));
		editSelfLabels = enabled
			? [...nonAdult, ...(existingAdult.length > 0 ? existingAdult : ['sexual'])]
			: nonAdult;
	}

	function hasOperatorSensitiveLabel(track: Track): boolean {
		return (track.operator_labels ?? []).some((label) => ADULT_SELF_LABELS.has(label));
	}
</script>

<details class="advanced-section">
	<summary>visibility &amp; access</summary>
	<div class="advanced-content">
		{#if track.audio_storage === 'r2_private'}
			<p class="field-hint">download policy: {track.download_policy}. listening follows the track’s visibility.</p>
		{/if}
		{#if atprotofansEligible || track.support_gate?.type === 'any'}
			<div class="edit-field-group access-field">
				<span class="edit-label">supporter access</span>
				<label class="toggle-row">
					<input type="checkbox" bind:checked={editSupportGate} disabled={editCopyrightEnabled} />
					<span>only supporters can play this track</span>
				</label>
				{#if editSupportGate}
					<p class="field-hint">
						only users who support you via <a
							href="https://atprotofans.com"
							target="_blank"
							rel="noopener">atprotofans</a
						>
						can play this track.
						<a
							href="https://docs.plyr.fm/artists/#supporter-gated-tracks"
							target="_blank"
							rel="noopener">learn more</a
						>
					</p>
				{/if}
			</div>
		{/if}
		<div class="edit-field-group content-notice-field">
			<span class="edit-label">content notice</span>
			<label class="toggle-row">
				<input
					type="checkbox"
					checked={editHasSensitiveAudio}
					onchange={(event) => setSensitiveAudio(event.currentTarget.checked)}
				/>
				<span>contains sexually explicit audio</span>
			</label>
			<p class="field-hint">
				this notice travels with the track on ATProto. the track is hidden by default and listeners
				must opt in to sensitive audio.
			</p>
			{#if hasOperatorSensitiveLabel(track)}
				<div class="moderation-status" role="status">
					<strong>plyr.fm moderation notice active</strong>
					<span
						>removing your notice will not make this track visible by default because an independent
						moderation label remains in effect.</span
					>
				</div>
			{:else}
				<p class="field-hint">
					this changes only your notice. moderators can apply a separate notice when needed.
				</p>
			{/if}
		</div>

		<div class="edit-field-group access-field">
			<span class="edit-label">visibility</span>
			<label class="toggle-row">
				<input type="checkbox" bind:checked={editUnlisted} />
				<span>unlisted — won't appear in feeds</span>
			</label>
			{#if editUnlisted}
				<p class="field-hint">
					this track won't show up in the latest, top, or for-you feeds. it's still accessible via
					direct link, your profile, albums, playlists, and search.
				</p>
			{/if}
		</div>
	</div>
</details>
{#if auth.user?.enabled_flags?.includes(COPYRIGHT_PARADIGM_FLAG)}
	<details class="advanced-section">
		<summary>rights &amp; licensing</summary>
		<div class="advanced-content">
			{#if editCopyrightWasEnabled}
				<p class="field-hint">
					existing copyright details are preserved unless you choose to replace them.
				</p>
				<label class="toggle-row"
					><input type="checkbox" bind:checked={replaceCopyrightRights} />replace existing rights
					details</label
				>
				{#if !replaceCopyrightRights}<label class="toggle-row"
						><input type="checkbox" bind:checked={editCopyrightEnabled} />copyright licensing
						enabled</label
					>{/if}
			{/if}
			{#if !editCopyrightWasEnabled || replaceCopyrightRights}
				{#if editCopyrightWasEnabled}<p class="field-hint">
						enter the full rights details below. blank fields clear previously saved values.
					</p>{/if}
				<CopyrightRightsPanel
					bind:enabled={editCopyrightEnabled}
					bind:rights={editCopyrightRights}
					disabled={editSupportGate}
				/>
			{/if}
		</div>
	</details>
{/if}

<style>
	.edit-field-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.edit-label {
		font-size: var(--text-sm);
		font-weight: 600;
		letter-spacing: 0.015em;
		color: var(--text-primary);
	}
	.toggle-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		font-size: var(--text-base);
		color: var(--text-primary);
	}
	.toggle-row input[type='checkbox'] {
		width: 16px;
		height: 16px;
		accent-color: var(--text-primary);
	}
	.field-hint {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		line-height: 1.45;
		margin: 0;
	}
	.moderation-status {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.75rem 0.875rem;
		background: color-mix(in srgb, var(--accent) 10%, var(--bg-primary));
		border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border-subtle));
		border-radius: var(--radius-base);
		font-size: var(--text-sm);
		line-height: 1.45;
		color: var(--text-secondary);
	}
	.moderation-status strong {
		color: var(--text-primary);
		font-weight: 600;
	}
	.field-hint a {
		color: var(--text-primary);
		text-decoration: none;
	}
	.field-hint a:hover {
		text-decoration: underline;
	}
	@media (max-width: 600px) {
		.edit-field-group {
			display: flex;
			flex-direction: column;
			gap: 0.5rem;
		}
		.edit-label {
			font-size: var(--text-sm);
		}
	}
	.advanced-section {
		border-top: 1px solid var(--border-subtle);
		padding-top: 0.875rem;
	}
	.advanced-section summary {
		cursor: pointer;
		color: var(--text-primary);
		font-size: var(--text-base);
		font-weight: 600;
		padding: 0.5rem 0;
	}
	.advanced-content {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding-top: 0.75rem;
	}
	@media (prefers-reduced-motion: reduce) {
		.edit-field-group {
			display: flex;
			flex-direction: column;
			gap: 0.5rem;
		}
	}
</style>
