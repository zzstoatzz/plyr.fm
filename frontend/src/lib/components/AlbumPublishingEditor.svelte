<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { updatePlylstLink } from '$lib/album-actions';
	import { auth } from '$lib/auth.svelte';
	import { COPYRIGHT_PARADIGM_FLAG } from '$lib/config';
	import { preferences } from '$lib/preferences.svelte';
	import { changePublishing } from '$lib/publishing-jobs';
	import { publishingSummary, type PublishingDefaults } from '$lib/publishing';
	import type { AlbumMetadata, Track } from '$lib/types';
	import PublishingControls from './PublishingControls.svelte';

	// the album page owns the one save action for edit mode (header ✓ and the
	// footer button both call the page's save, which calls `save()` here), so
	// this component only holds the settings draft and reports `dirty`.
	let {
		album,
		tracks,
		dirty = $bindable(false),
		onchange
	}: {
		album: AlbumMetadata;
		tracks: Track[];
		dirty?: boolean;
		onchange: (albumId: string, enabled: boolean) => void;
	} = $props();
	let override = $state<PublishingDefaults | null>(null);
	let savedOverride = $state<PublishingDefaults | null>(null);
	let plylst = $state(false);
	let savedPlylst = $state(false);
	let replaceOverrides = $state(false);
	let saving = $state(false);
	let error = $state('');
	const exceptions = $derived(tracks.filter((track) => track.policy_origin === 'track').length);
	const selectedCount = $derived(replaceOverrides ? tracks.length : tracks.length - exceptions);
	const publishingDirty = $derived(JSON.stringify(override) !== JSON.stringify(savedOverride));
	const effective = $derived(override ?? preferences.publishingDefaults);

	$effect(() => {
		dirty = publishingDirty || plylst !== savedPlylst || replaceOverrides;
	});

	onMount(() => {
		override = globalThis.structuredClone($state.snapshot(album.publishing_defaults ?? null));
		savedOverride = globalThis.structuredClone($state.snapshot(album.publishing_defaults ?? null));
		plylst = savedPlylst = album.show_plylst ?? false;
		void preferences.fetch();
	});

	/**
	 * persist the settings draft. resolves to a short summary for a toast, or
	 * null when there was nothing to save; throws (and shows the error inline)
	 * on failure so the page can keep edit mode open.
	 */
	export async function save(): Promise<string | null> {
		if (saving || !dirty) return null;
		const id = album.id;
		saving = true;
		error = '';
		let summary = 'album settings saved';
		let publishingSaved = false;
		try {
			if (publishingDirty || replaceOverrides) {
				const count = selectedCount;
				await changePublishing(`/albums/${id}/publishing`, {
					settings: override,
					replace_overrides: replaceOverrides
				});
				savedOverride = globalThis.structuredClone($state.snapshot(override));
				replaceOverrides = false;
				publishingSaved = true;
				summary = `album defaults saved; ${count} ${count === 1 ? 'track' : 'tracks'} updated`;
			}
			if (plylst !== savedPlylst) {
				await updatePlylstLink(id, plylst);
				savedPlylst = plylst;
				onchange(id, plylst);
			}
			return summary;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'could not save album settings — retry';
			throw new Error(error, { cause });
		} finally {
			if (publishingSaved) {
				await invalidateAll().catch(() => {
					error = 'settings saved; refresh to see updated track access';
				});
			}
			saving = false;
		}
	}
</script>

<section class="album-settings" aria-label="album settings">
	<h3>album settings</h3>
	<fieldset
		disabled={saving || !preferences.data}
		onchange={() => {
			error = '';
		}}
	>
		<legend class="sr-only">album settings</legend>
		<details class="access">
			<summary>
				<span
					><span class="label">listening &amp; downloads</span><span class="description"
						>{publishingSummary(effective)}</span
					></span
				><span class="edit">edit</span>
			</summary>
			<div class="access-fields">
				<label class="source-row">
					<span>settings</span>
					<select
						aria-label="settings"
						value={override === null ? 'default' : 'custom'}
						onchange={(event) => {
							override =
								event.currentTarget.value === 'default'
									? null
									: globalThis.structuredClone($state.snapshot(effective));
						}}
					>
						<option value="default">use Portal defaults</option>
						<option value="custom">custom for this album</option>
					</select>
				</label>
				{#if override}
					<PublishingControls
						bind:value={override}
						layout="rows"
						showRights={auth.user?.enabled_flags?.includes(COPYRIGHT_PARADIGM_FLAG)}
					/>
				{/if}
			</div>
		</details>
		<label class="plylst-row">
			<span
				><span class="label">plylst <small>experimental</small></span><span class="description"
					>show the waveform player link on this album</span
				></span
			><input type="checkbox" role="switch" aria-label="show plylst link" bind:checked={plylst} />
		</label>
		<details class="track-settings">
			<summary
				>track settings <span class="description"
					>{replaceOverrides
						? `all ${tracks.length} tracks will change`
						: `${exceptions} ${exceptions === 1 ? 'override' : 'overrides'} kept`}</span
				></summary
			>
			<div class="track-fields">
				<p>
					save defaults for new tracks and apply them to {selectedCount} existing {selectedCount ===
					1
						? 'track'
						: 'tracks'}.
				</p>
				{#if exceptions > 0}
					<label class="replace"
						><input type="checkbox" bind:checked={replaceOverrides} />also replace {exceptions} track
						{exceptions === 1 ? 'override' : 'overrides'}</label
					>
				{/if}
				<p>audio that was already public cannot be recalled.</p>
			</div>
		</details>
	</fieldset>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
	.album-settings {
		margin-block: 2rem;
		max-width: 44rem;
	}
	h3 {
		font-size: var(--text-xl);
		font-weight: 500;
		margin: 0;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--border-default);
	}
	fieldset {
		padding: 0;
		margin: 0;
		border: 0;
		min-width: 0;
	}
	summary,
	.plylst-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
		padding-block: 1.1rem;
		cursor: pointer;
	}
	.access > summary {
		list-style: none;
	}
	.access > summary::-webkit-details-marker {
		display: none;
	}
	.label,
	.description {
		display: block;
	}
	.description,
	small,
	p {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		line-height: 1.5;
	}
	.description {
		margin-top: 0.2rem;
	}
	small {
		font-size: var(--text-xs);
		margin-left: 0.4rem;
	}
	.edit {
		font-size: var(--text-sm);
		color: var(--accent-text);
	}
	.access,
	.plylst-row,
	.track-settings {
		border-bottom: 1px solid var(--border-default);
	}
	.access-fields,
	.track-fields {
		display: grid;
		gap: 1rem;
		padding-bottom: 1.1rem;
	}
	.source-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	select {
		padding: 0.6rem;
		background: var(--bg-secondary);
		color: var(--text-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		font: inherit;
		font-size: var(--text-sm);
		max-width: 65%;
	}
	input {
		accent-color: var(--accent);
	}
	input[role='switch'] {
		appearance: none;
		width: 2.25rem;
		height: 1.4rem;
		flex: none;
		margin: 0;
		padding: 0.15rem;
		border: 1px solid var(--border-emphasis);
		border-radius: var(--radius-full);
		background: var(--bg-secondary);
		cursor: pointer;
	}
	input[role='switch']::before {
		content: '';
		display: block;
		width: 1rem;
		height: 1rem;
		border-radius: var(--radius-full);
		background: var(--text-secondary);
	}
	input[role='switch']:checked {
		background: var(--accent);
		border-color: var(--accent);
	}
	input[role='switch']:checked::before {
		background: var(--accent-contrast);
		transform: translateX(0.8rem);
	}
	.track-settings > summary {
		display: list-item;
		font-size: var(--text-sm);
	}
	.track-settings > summary .description {
		display: inline;
		margin-left: 0.5rem;
	}
	p {
		margin: 0;
	}
	.replace {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--text-sm);
	}
	.error {
		margin-top: 1rem;
		color: var(--error);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	@media (max-width: 600px) {
		.source-row {
			align-items: stretch;
			flex-direction: column;
			gap: 0.5rem;
		}
		select {
			max-width: 100%;
			font-size: var(--text-lg);
		}
	}
</style>
