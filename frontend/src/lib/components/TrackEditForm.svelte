<script lang="ts">
	import TrackAccessFields from './track-edit/TrackAccessFields.svelte';
	import TrackArtworkField from './track-edit/TrackArtworkField.svelte';
	import TrackAudioEditor from './track-edit/TrackAudioEditor.svelte';
	import { onMount } from 'svelte';
	import HandleSearch from '$lib/components/HandleSearch.svelte';
	import AlbumSelect from '$lib/components/AlbumSelect.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import TagInput from '$lib/components/TagInput.svelte';
	import type { TrackRights } from '$lib/components/CopyrightRightsPanel.svelte';
	import type { Track, FeaturedArtist, AlbumSummary } from '$lib/types';
	import { API_URL } from '$lib/config';
	import { preferences } from '$lib/preferences.svelte';
	import { parsePublishing, defaultPublishing, type PublishingDefaults } from '$lib/publishing';
	import { changePublishing } from '$lib/publishing-jobs';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		track: Track;
		albums: AlbumSummary[];
		atprotofansEligible: boolean;
		onClose: () => void;
		onSaved: (track: Track) => void | Promise<void>;
		onTrackChanged?: (track: Track) => void | Promise<void>;
		onBusyChange?: (busy: boolean) => void;
		onDirtyChange?: (dirty: boolean) => void;
	}
	let { track, albums, onClose, onSaved, onTrackChanged, onBusyChange, onDirtyChange }: Props =
		$props();
	let saveError = $state<string | null>(null);
	let replaceCopyrightRights = $state(false);
	let initialDraft = $state('');
	function draftSnapshot(): string {
		return JSON.stringify([
			editTitle,
			editDescription,
			editAlbum,
			editFeaturedArtists,
			editTags,
			publishingOverride,
			editSelfLabels,
			editCopyrightRights,
			replaceCopyrightRights
		]);
	}
	onMount(() => {
		void preferences.fetch();
		startEditTrack(track);
		initialDraft = draftSnapshot();
	});
	$effect(() => {
		onBusyChange?.(savingTrackEdit || audioPending);
	});
	$effect(() => {
		onDirtyChange?.(
			Boolean(
				initialDraft &&
				(draftSnapshot() !== initialDraft ||
					editImageFile ||
					editRemoveImage ||
					audioDirty ||
					hasUnresolvedEditFeaturesInput)
			)
		);
	});

	let savingTrackEdit = $state(false);
	let editTitle = $state('');
	let editDescription = $state('');
	let editAlbum = $state('');
	let editFeaturedArtists = $state<FeaturedArtist[]>([]);
	let editTags = $state<string[]>([]);
	let editImageFile = $state<File | null>(null);
	let editRemoveImage = $state(false);

	let audioPending = $state(false);
	let audioDirty = $state(false);
	let publishingOverride = $state<PublishingDefaults | null>(null);
	let initialPublishing = $state(defaultPublishing());
	const selectedAlbum = $derived(albums.find((album) => album.title === editAlbum));
	const publishingDefaults = $derived(
		selectedAlbum?.publishing_defaults ?? preferences.publishingDefaults
	);
	const editCopyrightEnabled = $derived((publishingOverride ?? publishingDefaults).attach_rights);
	let editSelfLabels = $state<string[]>([]);

	let editCopyrightRights = $state<TrackRights>({});

	let editCopyrightWasEnabled = $state(false);
	let hasUnresolvedEditFeaturesInput = $state(false);
	let recommendedTags = $state<{ name: string; score: number }[]>([]);
	let recommendedTagsStatus = $state<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
	let recommendedTagsTrackId = $state<number | null>(null);
	let visibleRecommendedTags = $derived(
		recommendedTags.filter((r) => !editTags.includes(r.name.toLowerCase()))
	);

	function startEditTrack(track: Track) {
		editTitle = track.title;
		editDescription = track.description || '';
		editAlbum = track.album?.title || '';
		editFeaturedArtists = track.features || [];
		editTags = track.tags || [];
		initialPublishing = parsePublishing(JSON.stringify(track.publishing));
		publishingOverride = initialPublishing;
		editSelfLabels = [...(track.self_labels ?? [])];

		editCopyrightWasEnabled = initialPublishing.attach_rights;
		editCopyrightRights = {};
		fetchRecommendedTags(track.id);
	}

	async function fetchRecommendedTags(trackId: number) {
		recommendedTagsStatus = 'loading';
		recommendedTags = [];
		recommendedTagsTrackId = trackId;
		try {
			const response = await fetch(`${API_URL}/tracks/${trackId}/recommended-tags?limit=8`, {
				credentials: 'include'
			});
			if (!response.ok) throw new Error('could not load suggested tags');
			const data = await response.json();
			if (recommendedTagsTrackId !== trackId) return;
			recommendedTagsStatus = data.available ? 'ready' : 'unavailable';
			recommendedTags = data.tags;
		} catch {
			recommendedTagsStatus = 'error';
		}
	}

	function cancelEdit() {
		onClose();
	}

	async function refreshTrack(): Promise<Track> {
		const response = await fetch(`${API_URL}/tracks/${track.id}`, { credentials: 'include' });
		if (!response.ok) throw new Error('could not refresh track — try again');
		const fresh: Track = await response.json();
		return fresh;
	}

	async function saveTrackEdit(trackId: number) {
		if (savingTrackEdit || audioPending || !editTitle.trim() || hasUnresolvedEditFeaturesInput)
			return;
		savingTrackEdit = true;
		saveError = null;
		const formData = new FormData();
		formData.append('title', editTitle);
		formData.append('description', editDescription);
		if (editAlbum !== (track.album?.title ?? '')) formData.append('album', editAlbum);
		if (editFeaturedArtists.length > 0) {
			const handles = editFeaturedArtists.map((a) => a.handle);
			formData.append('features', JSON.stringify(handles));
		} else {
			formData.append('features', JSON.stringify([]));
		}

		formData.append('tags', JSON.stringify(editTags));

		formData.append('self_labels', JSON.stringify(editSelfLabels));

		if (editRemoveImage) {
			formData.append('remove_image', 'true');
		} else if (editImageFile) {
			formData.append('image', editImageFile);
		}

		try {
			const response = await fetch(`${API_URL}/tracks/${trackId}`, {
				method: 'PATCH',
				body: formData,
				credentials: 'include'
			});

			if (!response.ok) {
				const error = await response.json();
				saveError = error.detail || 'could not save changes — try again';
				return;
			}

			if (editCopyrightEnabled && (!editCopyrightWasEnabled || replaceCopyrightRights)) {
				const rightsResp = await fetch(`${API_URL}/tracks/${trackId}/copyright`, {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(editCopyrightRights)
				});
				if (!rightsResp.ok) {
					const err = await rightsResp.json().catch(() => ({}));
					saveError = `details saved, but copyright failed: ${err.detail ?? rightsResp.statusText}`;
					return;
				}
			}

			if (
				publishingOverride === null ||
				JSON.stringify(publishingOverride) !== JSON.stringify(initialPublishing)
			) {
				await changePublishing(`/tracks/${trackId}/publishing`, { settings: publishingOverride });
			}

			const fresh = await refreshTrack();
			await onSaved(fresh);
			toast.success('track updated');
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'could not save changes — try again';
		} finally {
			savingTrackEdit = false;
		}
	}
</script>

<form
	class="edit-container"
	onsubmit={(event) => {
		event.preventDefault();
		void saveTrackEdit(track.id);
	}}
>
	<fieldset class="edit-fields" disabled={savingTrackEdit || audioPending}>
		<div class="edit-field-group">
			<label for="edit-title" class="edit-label">track title</label>
			<input
				id="edit-title"
				type="text"
				bind:value={editTitle}
				placeholder="track title"
				class="edit-input"
				maxlength="256"
			/>
		</div>
		<div class="edit-field-group">
			<label for="edit-description" class="edit-label">description (optional)</label>
			<textarea
				id="edit-description"
				bind:value={editDescription}
				placeholder="liner notes, show notes, credits..."
				rows="3"
				maxlength="5000"
				class="edit-input"
			></textarea>
			{#if editDescription.length > 0}
				<div class="char-count">{editDescription.length} / 5000</div>
			{/if}
		</div>
		<div class="edit-field-group">
			<label for="edit-tags" class="edit-label">tags (optional)</label>
			<TagInput
				id="edit-tags"
				tags={editTags}
				onAdd={(tag) => {
					editTags = [...editTags, tag];
				}}
				onRemove={(tag) => {
					editTags = editTags.filter((t) => t !== tag);
				}}
				placeholder="type to search tags..."
			/>
			{#if recommendedTagsStatus === 'loading'}
				<div class="suggested-tags-row">
					<span class="suggested-label">suggested</span>
					<WaveLoading size="sm" />
				</div>
			{:else if recommendedTagsStatus === 'unavailable'}
				<p class="suggested-status" role="status">suggested tags unavailable</p>
			{:else if recommendedTagsStatus === 'error'}
				<div class="suggested-tags-row">
					<span class="suggested-status" role="status">could not load suggested tags</span>
					<button
						type="button"
						class="suggested-tag-chip"
						onclick={() => fetchRecommendedTags(track.id)}>retry</button
					>
				</div>
			{:else if visibleRecommendedTags.length > 0}
				<div class="suggested-tags-row">
					<span class="suggested-label">suggested</span>
					<div class="suggested-tags">
						{#each visibleRecommendedTags as rec}
							<button
								type="button"
								class="suggested-tag-chip"
								onclick={() => {
									editTags = [...editTags, rec.name.toLowerCase()];
									recommendedTags = recommendedTags.filter((r) => r !== rec);
								}}
							>
								+ {rec.name}
							</button>
						{/each}
					</div>
				</div>
			{:else}
				<p class="suggested-status" role="status">no new suggested tags</p>
			{/if}
		</div>
		<TrackArtworkField imageUrl={track.image_url} bind:editImageFile bind:editRemoveImage />
		<div class="edit-field-group">
			<label for="edit-album" class="edit-label">album (optional)</label>
			<AlbumSelect id="edit-album" {albums} bind:value={editAlbum} placeholder="album (optional)" />
		</div>
		<div class="edit-field-group">
			<label for="edit-features" class="edit-label">featured artists (optional)</label>
			<HandleSearch
				id="edit-features"
				bind:selected={editFeaturedArtists}
				bind:hasUnresolvedInput={hasUnresolvedEditFeaturesInput}
				onAdd={(artist) => {
					editFeaturedArtists = [...editFeaturedArtists, artist];
				}}
				onRemove={(did) => {
					editFeaturedArtists = editFeaturedArtists.filter((a) => a.did !== did);
				}}
			/>
		</div>

		<TrackAccessFields
			valueLabel={JSON.stringify(publishingOverride) === JSON.stringify(initialPublishing) &&
			track.policy_origin !== 'track'
				? `saved from ${track.policy_origin === 'album' ? 'album' : 'Portal'} defaults`
				: undefined}
			{track}
			bind:publishingOverride
			{publishingDefaults}
			publishingSource={selectedAlbum?.publishing_defaults ? 'album' : 'Portal'}
			bind:editSelfLabels
			{editCopyrightEnabled}
			bind:editCopyrightRights
			bind:replaceCopyrightRights
			{editCopyrightWasEnabled}
		/>
		<TrackAudioEditor
			{track}
			{onTrackChanged}
			onBusyChange={(busy) => {
				audioPending = busy;
			}}
			onDirtyChange={(dirty) => {
				audioDirty = dirty;
			}}
		/>
	</fieldset>
	{#if saveError}<p class="save-error" role="alert">{saveError}</p>{/if}
	<div class="edit-actions">
		<button
			type="button"
			class="edit-cancel-btn"
			onclick={cancelEdit}
			disabled={savingTrackEdit || audioPending}
		>
			cancel
		</button>
		<button
			type="submit"
			class="edit-save-btn"
			disabled={savingTrackEdit ||
				audioPending ||
				hasUnresolvedEditFeaturesInput ||
				!editTitle.trim()}
			title={hasUnresolvedEditFeaturesInput
				? 'please select or clear featured artist'
				: 'save changes'}
		>
			{savingTrackEdit ? 'saving…' : 'save changes'}
		</button>
	</div>
</form>

<style>
	.edit-container {
		width: 100%;
		display: flex;
		flex-direction: column;
	}
	.edit-fields {
		border: 0;
		min-width: 0;
		margin: 0;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.edit-field-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.edit-label {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-primary);
	}
	.edit-input {
		box-sizing: border-box;
		width: 100%;
		padding: 0.625rem 0.75rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-primary);
		font-size: var(--text-lg);
		font-family: inherit;
		transition: border-color var(--motion-feedback) var(--ease-surface);
	}
	.edit-input:focus {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-color: var(--accent);
	}
	textarea.edit-input {
		resize: vertical;
		min-height: 5rem;
	}
	.char-count {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		text-align: right;
	}
	.suggested-tags-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.suggested-status {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.suggested-label {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
	}
	.suggested-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.suggested-tag-chip {
		padding: 0.3rem 0.6rem;
		background: transparent;
		border: 1px dashed var(--border-default);
		color: var(--text-secondary);
		border-radius: var(--radius-full);
		font-size: var(--text-sm);
		font-family: inherit;
		cursor: pointer;
		transition:
			color var(--motion-feedback) var(--ease-surface),
			border-color var(--motion-feedback) var(--ease-surface);
	}
	.suggested-tag-chip:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.edit-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
		position: sticky;
		bottom: 0;
		padding: 1rem 1.5rem;
		border-top: 1px solid var(--border-subtle);
		background: var(--bg-primary);
		z-index: 1;
	}
	.edit-cancel-btn,
	.edit-save-btn {
		min-height: 44px;
		padding: 0.625rem 1.25rem;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		font-size: var(--text-base);
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		transition:
			background var(--motion-feedback) var(--ease-surface),
			transform var(--motion-feedback) var(--ease-surface);
	}
	.edit-cancel-btn {
		background: transparent;
		color: var(--text-secondary);
	}
	.edit-cancel-btn:hover:not(:disabled) {
		background: var(--bg-hover);
	}
	.edit-save-btn {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-contrast);
	}
	.edit-save-btn:hover:not(:disabled) {
		background: var(--accent-hover);
	}
	.edit-cancel-btn:active:not(:disabled),
	.edit-save-btn:active:not(:disabled) {
		transform: scale(0.98);
	}
	.edit-cancel-btn:disabled,
	.edit-save-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.save-error {
		color: var(--error);
		font-size: var(--text-sm);
		margin: 0;
		padding: 0 1.5rem 1rem;
	}
	@media (max-width: 600px) {
		.edit-fields {
			padding: 1rem;
		}
		.edit-actions {
			padding: 0.875rem 1rem;
		}
		.edit-save-btn {
			flex: 1;
		}
		.save-error {
			padding: 0 1rem 1rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		button,
		.edit-input {
			transition: none;
		}
	}
</style>
