<script lang="ts">
	import HandleSearch from '$lib/components/HandleSearch.svelte';
	import AlbumSelect from '$lib/components/AlbumSelect.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import TagInput from '$lib/components/TagInput.svelte';
	import CopyrightRightsPanel from '$lib/components/CopyrightRightsPanel.svelte';
	import type { TrackRights } from '$lib/components/CopyrightRightsPanel.svelte';
	import type { Track, FeaturedArtist, AlbumSummary } from '$lib/types';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import CopyrightFlag from '$lib/components/portal/CopyrightFlag.svelte';
	import AudioRevisionsSheet from '$lib/components/AudioRevisionsSheet.svelte';
	import { API_URL, getServerConfig } from '$lib/config';
	import { toast } from '$lib/toast.svelte';
	import { uploader } from '$lib/uploader.svelte';
	import { player } from '$lib/player.svelte';
	import { isOptimizing } from '$lib/utils/track-audio';

	// supported audio formats — matches backend AudioFormat enum + AlbumUploadForm
	const AUDIO_FILE_INPUT_ACCEPT = '.mp3,.wav,.m4a,.aiff,.aif,.flac,audio/mpeg,audio/wav,audio/mp4,audio/aiff,audio/x-aiff,audio/flac';
	const ADULT_SELF_LABELS = new Set(['sexual', 'porn']);

	type SortMode = 'recent' | 'title' | 'plays';

	interface Props {
		tracks: Track[];
		tracksTotal: number;
		tracksHasMore: boolean;
		loadingTracks: boolean;
		loadingMoreTracks: boolean;
		albums: AlbumSummary[];
		atprotofansEligible: boolean;
		onLoadMore: () => void;
		onTracksChanged: () => Promise<void>;
		q?: string;
		sort?: SortMode;
		onFilterChange?: (filters: { q: string; sort: SortMode }) => void;
	}

	let {
		tracks,
		tracksTotal,
		tracksHasMore,
		loadingTracks,
		loadingMoreTracks,
		albums,
		atprotofansEligible,
		onLoadMore,
		onTracksChanged,
		q = '',
		sort = 'recent',
		onFilterChange
	}: Props = $props();

	// search/sort controls — server-side via onFilterChange (the parent owns the
	// fetch). debounced so typing doesn't fire a request per keystroke.
	let searchInput = $state(q);
	let sortMode = $state<SortMode>(sort);
	let hasQuery = $derived(searchInput.trim().length > 0);
	let searchDebounce: ReturnType<typeof setTimeout> | undefined;

	function emitFilter() {
		onFilterChange?.({ q: searchInput.trim(), sort: sortMode });
	}

	function onSearchInput() {
		clearTimeout(searchDebounce);
		searchDebounce = setTimeout(emitFilter, 250);
	}

	// track editing state
	let editingTrackId = $state<number | null>(null);
	let savingTrackEdit = $state(false);
	let editTitle = $state('');
	let editDescription = $state('');
	let editAlbum = $state('');
	let editFeaturedArtists = $state<FeaturedArtist[]>([]);
	let editTags = $state<string[]>([]);
	let editImageFile = $state<File | null>(null);
	let editImagePreviewUrl = $state<string | null>(null);
	let editRemoveImage = $state(false);
	// audio replace state — separate flow from metadata edit because the
	// upload + transcode + PDS write can take 30s+ and has its own SSE progress
	// (surfaced via toast, not inline). a confirm dialog gates the irreversible
	// replace; previous audio is preserved in track_revisions for rollback.
	let editAudioFile = $state<File | null>(null);
	let replaceConfirm = $state<{ track: Track; file: File } | null>(null);

	// version history sheet state
	interface AudioRevision {
		id: number;
		track_id: number;
		created_at: string;
		file_type: string;
		original_file_type: string | null;
		audio_storage: string;
		duration: number | null;
		was_gated: boolean;
	}
	let revisionsSheetTrack = $state<Track | null>(null);
	let revisionsList = $state<AudioRevision[]>([]);
	let revisionsLoading = $state(false);
	let revisionsError = $state<string | null>(null);
	let restoreConfirm = $state<{ track: Track; revision: AudioRevision } | null>(null);
	let restorePending = $state(false);
	let editSupportGate = $state(false);
	let editUnlisted = $state(false);
	let editSelfLabels = $state<string[]>([]);
	let editHasSensitiveAudio = $derived(
		editSelfLabels.some((label) => ADULT_SELF_LABELS.has(label))
	);
	// copyright rights state for the inline edit form — kept in sync with the
	// CopyrightRightsPanel via bindable props.
	let editCopyrightEnabled = $state(false);
	let editCopyrightRights = $state<TrackRights>({});
	// snapshot of the on-load state so we know whether to POST/DELETE on save
	let editCopyrightWasEnabled = $state(false);
	let hasUnresolvedEditFeaturesInput = $state(false);
	let recommendedTags = $state<{name: string; score: number}[]>([]);
	let loadingRecommendedTags = $state(false);
	let recommendedTagsTrackId = $state<number | null>(null);
	let visibleRecommendedTags = $derived(
		recommendedTags.filter(r => !editTags.includes(r.name.toLowerCase()))
	);

	async function deleteTrack(trackId: number, trackTitle: string) {
		if (!confirm(`delete "${trackTitle}"?`)) return;

		try {
			const response = await fetch(`${API_URL}/tracks/${trackId}`, {
				method: 'DELETE',
				credentials: 'include'
			});

			if (response.ok) {
				await onTracksChanged();
				toast.success('track deleted');
			} else {
				const error = await response.json();
				toast.error(error.detail || 'failed to delete track');
			}
		} catch (e) {
			toast.error(`network error: ${e instanceof Error ? e.message : 'unknown error'}`);
		}
	}

	function startEditTrack(track: Track) {
		editingTrackId = track.id;
		editTitle = track.title;
		editDescription = track.description || '';
		editAlbum = track.album?.title || '';
		editFeaturedArtists = track.features || [];
		editTags = track.tags || [];
		editSupportGate =
			track.support_gate !== null &&
			track.support_gate !== undefined &&
			track.support_gate.type !== 'copyright';
		editUnlisted = track.unlisted ?? false;
		editSelfLabels = [...(track.self_labels ?? [])];
		// initialize copyright state from the track's persisted URIs.
		// we don't have the original ISWC/ISRC/masterOwner stored locally — those
		// live on the PDS records. for now we leave the form blank on open; a
		// save will overwrite them with whatever's in the form.
		editCopyrightEnabled = Boolean(track.copyright_song_uri);
		editCopyrightWasEnabled = editCopyrightEnabled;
		editCopyrightRights = {};
		fetchRecommendedTags(track.id);
	}

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

	async function fetchRecommendedTags(trackId: number) {
		loadingRecommendedTags = true;
		recommendedTags = [];
		recommendedTagsTrackId = trackId;
		try {
			const response = await fetch(
				`${API_URL}/tracks/${trackId}/recommended-tags?limit=8`,
				{ credentials: 'include' }
			);
			if (!response.ok) return;
			const data = await response.json();
			if (recommendedTagsTrackId !== trackId) return;
			if (!data.available || data.tags.length === 0) return;
			recommendedTags = data.tags;
		} catch {
			// silent — enhancement, not critical
		} finally {
			loadingRecommendedTags = false;
		}
	}

	function cancelEdit() {
		editingTrackId = null;
		editTitle = '';
		editDescription = '';
		editAlbum = '';
		editFeaturedArtists = [];
		editTags = [];
		editImageFile = null;
		if (editImagePreviewUrl) {
			URL.revokeObjectURL(editImagePreviewUrl);
		}
		editImagePreviewUrl = null;
		editRemoveImage = false;
		editSupportGate = false;
		editUnlisted = false;
		editSelfLabels = [];
		editCopyrightEnabled = false;
		editCopyrightWasEnabled = false;
		editCopyrightRights = {};
		editAudioFile = null;
		recommendedTags = [];
		loadingRecommendedTags = false;
		recommendedTagsTrackId = null;
	}

	async function selectAudioReplacement(file: File) {
		// validate against the same upload-size limit as the upload form. fetch
		// dynamically because the limit comes from server config.
		try {
			const config = await getServerConfig();
			const sizeMB = file.size / (1024 * 1024);
			if (sizeMB > config.max_upload_size_mb) {
				toast.error(`audio file exceeds ${config.max_upload_size_mb}MB limit`);
				return;
			}
		} catch {
			// config fetch failed — fall back to letting the server enforce
		}
		editAudioFile = file;
	}

	function requestReplaceAudio(track: Track) {
		// stage the (track, file) pair; the confirm dialog will fire the
		// actual replace. we don't run anything irreversible until confirmed.
		if (!editAudioFile) return;
		replaceConfirm = { track, file: editAudioFile };
	}

	async function reloadCurrentPlayingTrack(trackId: number) {
		if (player.currentTrack?.id !== trackId) return;
		try {
			const resp = await fetch(`${API_URL}/tracks/${trackId}`, {
				credentials: 'include'
			});
			if (resp.ok) {
				const fresh = await resp.json();
				player.currentTrack = { ...player.currentTrack, ...fresh };
			}
		} catch {
			// best effort — next track navigation will pick up the new src
		}
	}

	function executeReplaceAudio() {
		if (!replaceConfirm) return;
		const { track, file } = replaceConfirm;
		const trackId = track.id;

		// kick off the background upload+SSE flow. progress and outcome are
		// surfaced via toast — same pattern as the initial upload form.
		uploader.replaceAudio(trackId, file, track.title, async () => {
			// refresh local tracks so the row reflects the new file_id and r2_url
			await onTracksChanged();
			await reloadCurrentPlayingTrack(trackId);
		});

		// clear the staged file + dialog. SSE flow continues in the toast;
		// the rest of the edit form stays open for other unsaved metadata.
		editAudioFile = null;
		replaceConfirm = null;
	}

	async function openVersionHistory(track: Track) {
		revisionsSheetTrack = track;
		revisionsList = [];
		revisionsError = null;
		revisionsLoading = true;
		try {
			const resp = await fetch(`${API_URL}/tracks/${track.id}/revisions`, {
				credentials: 'include'
			});
			if (!resp.ok) {
				revisionsError = 'failed to load version history';
				return;
			}
			const body = await resp.json();
			revisionsList = body.revisions ?? [];
		} catch {
			revisionsError = 'failed to load version history';
		} finally {
			revisionsLoading = false;
		}
	}

	function requestRestoreRevision(revision: AudioRevision) {
		if (!revisionsSheetTrack) return;
		restoreConfirm = { track: revisionsSheetTrack, revision };
	}

	async function executeRestoreRevision() {
		if (!restoreConfirm) return;
		const { track, revision } = restoreConfirm;
		restorePending = true;
		try {
			const resp = await fetch(
				`${API_URL}/tracks/${track.id}/revisions/${revision.id}/restore`,
				{ method: 'POST', credentials: 'include' }
			);
			if (!resp.ok) {
				const detail = await resp.json().catch(() => ({}));
				toast.error(detail.detail ?? 'failed to restore audio');
				return;
			}
			toast.success('audio restored');
			await onTracksChanged();
			await reloadCurrentPlayingTrack(track.id);
			// refresh the sheet's revision list — the chosen one is now gone,
			// the displaced current is now in the list
			if (revisionsSheetTrack?.id === track.id) {
				await openVersionHistory(track);
			}
			restoreConfirm = null;
		} catch {
			toast.error('failed to restore audio');
		} finally {
			restorePending = false;
		}
	}

	async function saveTrackEdit(trackId: number) {
		if (savingTrackEdit) return;
		savingTrackEdit = true;
		const formData = new FormData();
		formData.append('title', editTitle);
		formData.append('description', editDescription);
		formData.append('album', editAlbum);
		if (editFeaturedArtists.length > 0) {
			const handles = editFeaturedArtists.map(a => a.handle);
			formData.append('features', JSON.stringify(handles));
		} else {
			// send empty array to clear features
			formData.append('features', JSON.stringify([]));
		}
		// always send tags (empty array clears them)
		formData.append('tags', JSON.stringify(editTags));
		// send support_gate - null to remove, or {type: "any"} to enable.
		// copyright-gated tracks have their own toggle below; leave support_gate
		// alone in that case so we don't clobber the copyright gate.
		if (!editCopyrightEnabled && !editCopyrightWasEnabled) {
			if (editSupportGate) {
				formData.append('support_gate', JSON.stringify({ type: 'any' }));
			} else {
				formData.append('support_gate', 'null');
			}
		}
		formData.append('unlisted', editUnlisted ? 'true' : 'false');
		formData.append('self_labels', JSON.stringify(editSelfLabels));
		// handle artwork: remove, replace, or leave unchanged
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
				toast.error(error.detail || 'failed to update track');
				return;
			}

			// copyright rights are saved through a dedicated endpoint, not the
			// PATCH formData. apply enable/disable transitions and field updates.
			if (editCopyrightEnabled) {
				const rightsResp = await fetch(`${API_URL}/tracks/${trackId}/copyright`, {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(editCopyrightRights)
				});
				if (!rightsResp.ok) {
					const err = await rightsResp.json().catch(() => ({}));
					toast.error(`copyright save failed: ${err.detail ?? rightsResp.statusText}`);
				}
			} else if (editCopyrightWasEnabled) {
				const dropResp = await fetch(`${API_URL}/tracks/${trackId}/copyright`, {
					method: 'DELETE',
					credentials: 'include'
				});
				if (!dropResp.ok) {
					toast.error('failed to clear copyright metadata');
				}
			}

			await onTracksChanged();
			cancelEdit();
			toast.success('track updated successfully');
		} catch (e) {
			toast.error(`network error: ${e instanceof Error ? e.message : 'unknown error'}`);
		} finally {
			savingTrackEdit = false;
		}
	}
</script>

<section class="tracks-section">
	<h2>your tracks</h2>

	{#if tracks.length > 0 || hasQuery}
		<div class="tracks-toolbar">
			<input
				type="search"
				class="track-search"
				placeholder="filter your tracks…"
				bind:value={searchInput}
				oninput={onSearchInput}
				aria-label="filter your tracks"
			/>
			<select class="track-sort" bind:value={sortMode} onchange={emitFilter} aria-label="sort tracks">
				<option value="recent">recent</option>
				<option value="title">title</option>
				<option value="plays">most played</option>
			</select>
		</div>
	{/if}

	{#if loadingTracks && tracks.length === 0}
		<div class="loading-container">
			<WaveLoading size="lg" message="loading tracks..." />
		</div>
	{:else if tracks.length === 0}
		<p class="empty">{hasQuery ? `no tracks match “${searchInput.trim()}”` : 'no tracks uploaded yet'}</p>
	{:else}
		<div class="tracks-list" class:refreshing={loadingTracks}>
			{#each tracks as track}
				<div class="track-item" class:editing={editingTrackId === track.id} class:copyright-flagged={track.copyright_flagged}>
					{#if editingTrackId === track.id}
						<div class="edit-container">
							<div class="edit-fields">
								<div class="edit-field-group">
									<label for="edit-title" class="edit-label">track title</label>
									<input id="edit-title"
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
									<label for="edit-album" class="edit-label">album (optional)</label>
									<AlbumSelect
										{albums}
										bind:value={editAlbum}
										placeholder="album (optional)"
									/>
								</div>
								<div class="edit-field-group">
									<div class="edit-label">featured artists (optional)</div>
									<HandleSearch
										bind:selected={editFeaturedArtists}
										bind:hasUnresolvedInput={hasUnresolvedEditFeaturesInput}
										onAdd={(artist) => { editFeaturedArtists = [...editFeaturedArtists, artist]; }}
										onRemove={(did) => { editFeaturedArtists = editFeaturedArtists.filter(a => a.did !== did); }}
									/>
								</div>
								<div class="edit-field-group">
									<label for="edit-tags" class="edit-label">tags (optional)</label>
									<TagInput
										tags={editTags}
										onAdd={(tag) => { editTags = [...editTags, tag]; }}
										onRemove={(tag) => { editTags = editTags.filter(t => t !== tag); }}
										placeholder="type to search tags..."
									/>
									{#if loadingRecommendedTags}
										<div class="suggested-tags-row">
											<span class="suggested-label">suggested</span>
											<WaveLoading size="sm" />
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
															recommendedTags = recommendedTags.filter(r => r !== rec);
														}}
													>
														+ {rec.name}
													</button>
												{/each}
											</div>
										</div>
									{/if}
								</div>
								<div class="edit-field-group">
									<span class="edit-label">artwork (optional)</span>
									<div class="artwork-editor">
										{#if editImagePreviewUrl}
											<!-- New image selected - show preview -->
											<div class="artwork-preview">
												<img src={editImagePreviewUrl} alt="new artwork preview" />
												<div class="artwork-preview-overlay">
													<button
														type="button"
														class="artwork-action-btn"
														onclick={() => {
															editImageFile = null;
															if (editImagePreviewUrl) {
																URL.revokeObjectURL(editImagePreviewUrl);
															}
															editImagePreviewUrl = null;
														}}
														title="remove selection"
													>
														<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
															<line x1="18" y1="6" x2="6" y2="18"></line>
															<line x1="6" y1="6" x2="18" y2="18"></line>
														</svg>
													</button>
												</div>
											</div>
											<span class="artwork-status">new artwork selected</span>
										{:else if editRemoveImage}
											<!-- User chose to remove artwork -->
											<div class="artwork-removed">
												<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
													<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
													<line x1="9" y1="9" x2="15" y2="15"></line>
													<line x1="15" y1="9" x2="9" y2="15"></line>
												</svg>
												<span>artwork will be removed</span>
												<button
													type="button"
													class="undo-remove-btn"
													onclick={() => { editRemoveImage = false; }}
												>
													undo
												</button>
											</div>
										{:else if track.image_url}
											<!-- Current artwork exists -->
											<div class="artwork-preview">
												<img src={track.image_url} alt="current artwork" />
												<div class="artwork-preview-overlay">
													<button
														type="button"
														class="artwork-action-btn"
														onclick={() => { editRemoveImage = true; }}
														title="remove artwork"
													>
														<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
															<polyline points="3 6 5 6 21 6"></polyline>
															<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
														</svg>
													</button>
												</div>
											</div>
											<span class="artwork-status current">current artwork</span>
										{:else}
											<!-- No artwork -->
											<div class="artwork-empty">
												<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
													<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
													<circle cx="8.5" cy="8.5" r="1.5"></circle>
													<polyline points="21 15 16 10 5 21"></polyline>
												</svg>
												<span>no artwork</span>
											</div>
										{/if}
										{#if !editRemoveImage}
											<label class="artwork-upload-btn">
												<input
													type="file"
													accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif"
													onchange={(e) => {
														const target = e.target as HTMLInputElement;
														const file = target.files?.[0];
														if (file) {
															if (file.size > 20 * 1024 * 1024) {
																toast.error('image must be under 20 MB');
																target.value = '';
																return;
															}
															editImageFile = file;
															if (editImagePreviewUrl) {
																URL.revokeObjectURL(editImagePreviewUrl);
															}
															editImagePreviewUrl = URL.createObjectURL(file);
														}
													}}
												/>
												<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
													<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
													<polyline points="17 8 12 3 7 8"></polyline>
													<line x1="12" y1="3" x2="12" y2="15"></line>
												</svg>
												{track.image_url || editImagePreviewUrl ? 'replace' : 'upload'}
											</label>
										{/if}
									</div>
								</div>
								<div class="edit-field-group">
									<span class="edit-label">audio file</span>
									<div class="audio-replace-editor">
										{#if editAudioFile}
											<div class="audio-selected">
												<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
													<path d="M9 18V5l12-2v13"></path>
													<circle cx="6" cy="18" r="3"></circle>
													<circle cx="18" cy="16" r="3"></circle>
												</svg>
												<span class="audio-filename">{editAudioFile.name}</span>
												<button
													type="button"
													class="audio-clear-btn"
													onclick={() => { editAudioFile = null; }}
													title="discard selection"
												>
													<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
														<line x1="18" y1="6" x2="6" y2="18"></line>
														<line x1="6" y1="6" x2="18" y2="18"></line>
													</svg>
												</button>
											</div>
											<button
												type="button"
												class="audio-replace-btn"
												onclick={() => requestReplaceAudio(track)}
											>
												replace audio
											</button>
										{:else}
											<div class="audio-current">
												<span class="audio-current-label">
													current: {track.file_type}{track.original_file_type && track.original_file_type !== track.file_type ? ` (transcoded from ${track.original_file_type})` : ''}{isOptimizing(track) ? ' · optimizing — mp3 will land on your PDS shortly' : track.audio_storage === 'both' || track.audio_storage === 'pds' ? ' · stored on your PDS' : ' · stored on plyr.fm'}
												</span>
											</div>
											<label class="audio-upload-btn">
												<input
													type="file"
													accept={AUDIO_FILE_INPUT_ACCEPT}
													onchange={(e) => {
														const target = e.target as HTMLInputElement;
														const file = target.files?.[0];
														if (file) {
															void selectAudioReplacement(file);
														}
														target.value = '';
													}}
												/>
												<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
													<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
													<polyline points="17 8 12 3 7 8"></polyline>
													<line x1="12" y1="3" x2="12" y2="15"></line>
												</svg>
												choose new file
											</label>
											<button
												type="button"
												class="audio-history-btn"
												onclick={() => openVersionHistory(track)}
												title="view previous audio versions"
											>
												<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
													<path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path>
													<polyline points="3 3 3 8 8 8"></polyline>
													<polyline points="12 7 12 12 15 14"></polyline>
												</svg>
												version history
											</button>
										{/if}
										<p class="audio-replace-hint">
											choose a new file, then confirm. uploading runs in the background and the previous audio is kept in version history so you can roll back. likes, comments, plays, and the track URL stay the same.
										</p>
									</div>
								</div>
								{#if atprotofansEligible || (track.support_gate && track.support_gate.type !== 'copyright')}
									<div class="edit-field-group access-field">
										<span class="edit-label">supporter access</span>
										<label class="toggle-row">
											<input
												type="checkbox"
												bind:checked={editSupportGate}
												disabled={editCopyrightEnabled}
											/>
											<span>only supporters can play this track</span>
										</label>
										{#if editSupportGate}
											<p class="field-hint">
												only users who support you via <a href="https://atprotofans.com" target="_blank" rel="noopener">atprotofans</a> can play this track. <a href="https://docs.plyr.fm/artists/#supporter-gated-tracks" target="_blank" rel="noopener">learn more</a>
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
											onchange={(event) => setSensitiveAudio((event.target as HTMLInputElement).checked)}
										/>
										<span>contains sexually explicit audio</span>
									</label>
									<p class="field-hint">
										this notice travels with the track on ATProto. the track is hidden by default and listeners must opt in to sensitive audio.
									</p>
									{#if hasOperatorSensitiveLabel(track)}
										<div class="moderation-status" role="status">
											<strong>plyr.fm moderation notice active</strong>
											<span>removing your notice will not make this track visible by default because an independent moderation label remains in effect.</span>
										</div>
									{:else}
										<p class="field-hint">
											this changes only your notice. moderators can apply a separate notice when needed.
										</p>
									{/if}
								</div>
								<CopyrightRightsPanel
									bind:enabled={editCopyrightEnabled}
									bind:rights={editCopyrightRights}
									disabled={editSupportGate}
								/>
								<div class="edit-field-group access-field">
									<span class="edit-label">visibility</span>
									<label class="toggle-row">
										<input
											type="checkbox"
											bind:checked={editUnlisted}
										/>
										<span>unlisted — won't appear in feeds</span>
									</label>
									{#if editUnlisted}
										<p class="field-hint">
											this track won't show up in the latest, top, or for-you feeds. it's still accessible via direct link, your profile, albums, playlists, and search.
										</p>
									{/if}
								</div>
							</div>
							<div class="edit-actions">
								<button
									type="button"
									class="edit-cancel-btn"
									onclick={cancelEdit}
									disabled={savingTrackEdit}
								>
									cancel
								</button>
								<button
									type="button"
									class="edit-save-btn"
									onclick={() => saveTrackEdit(track.id)}
									disabled={savingTrackEdit || hasUnresolvedEditFeaturesInput}
									title={hasUnresolvedEditFeaturesInput ? "please select or clear featured artist" : "save changes"}
								>
									{savingTrackEdit ? 'saving...' : 'save changes'}
								</button>
							</div>
						</div>
					{:else}
						<div class="track-artwork-col">
							<div class="track-artwork">
								{#if track.image_url}
									<img src={track.image_url} alt="{track.title} artwork" />
								{:else}
									<div class="track-artwork-placeholder">
										<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
											<path d="M9 18V5l12-2v13"></path>
											<circle cx="6" cy="18" r="3"></circle>
											<circle cx="18" cy="16" r="3"></circle>
										</svg>
									</div>
								{/if}
							</div>
							<a href="/track/{track.id}" class="track-view-link" title="view track page">view</a>
						</div>
						<div class="track-info">
							<div class="track-title">
								{track.title}
								{#if track.support_gate}
									<span class="support-gate-badge" title="supporters only">
										<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
											<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
										</svg>
									</span>
								{/if}
								{#if track.copyright_flagged}
									<CopyrightFlag
										match={track.copyright_match}
										recordUrl={track.atproto_record_url}
									/>
								{/if}
							</div>
							<div class="track-meta">
								{#if track.features && track.features.length > 0}
									<div class="meta-features" title={`feat. ${track.features.map(f => f.display_name).join(', ')}`}>
										<span class="features-label">feat.</span>
										<span class="features-list">{track.features.map(f => f.display_name).join(', ')}</span>
									</div>
								{/if}
								{#if track.album}
									<div class="meta-album" title={track.album.title}>
										<svg class="album-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
											<rect x="2" y="2" width="12" height="12" stroke="currentColor" stroke-width="1.5" fill="none" />
											<circle cx="8" cy="8" r="2.5" fill="currentColor" />
										</svg>
										<a href="/u/{track.artist_handle}/album/{track.album.slug}" class="album-link">
											{track.album.title}
										</a>
									</div>
								{/if}
								{#if track.tags && track.tags.length > 0}
									<div class="meta-tags">
										{#each track.tags as tag}
											<a href="/tag/{encodeURIComponent(tag)}" class="meta-tag">{tag}</a>
										{/each}
									</div>
								{/if}
							</div>
							{#if track.created_at}
								<div class="track-date">
									{new Date(track.created_at).toLocaleDateString()}
								</div>
							{/if}
						</div>
						<div class="track-actions">
							<button
								type="button"
								class="track-action-btn edit"
								onclick={() => startEditTrack(track)}
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
									<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
								</svg>
								edit
							</button>
							<button
								type="button"
								class="track-action-btn delete"
								onclick={() => deleteTrack(track.id, track.title)}
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<polyline points="3 6 5 6 21 6"></polyline>
									<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
								</svg>
								delete
							</button>
						</div>
					{/if}
				</div>
			{/each}
		</div>

		{#if tracksHasMore}
			<button
				class="load-more-btn"
				onclick={onLoadMore}
				disabled={loadingMoreTracks}
			>
				{loadingMoreTracks ? 'loading...' : `load more (${tracks.length} of ${tracksTotal})`}
			</button>
		{/if}
	{/if}
</section>

<!-- audio replace confirmation: gates the irreversible upload -->
<ConfirmDialog
	open={replaceConfirm !== null}
	title="replace audio?"
	body={replaceConfirm
		? `this will swap the audio file for "${replaceConfirm.track.title}". the previous audio will be saved in version history so you can roll back. likes, comments, plays, and the track URL won't change.`
		: ''}
	confirmText="replace"
	cancelText="cancel"
	onConfirm={executeReplaceAudio}
	onCancel={() => { replaceConfirm = null; }}
/>

<!-- version history sheet: lists previous audio versions with restore -->
<AudioRevisionsSheet
	open={revisionsSheetTrack !== null}
	trackTitle={revisionsSheetTrack?.title ?? ''}
	revisions={revisionsList}
	loading={revisionsLoading}
	error={revisionsError}
	onClose={() => {
		revisionsSheetTrack = null;
		revisionsList = [];
		revisionsError = null;
	}}
	onRestore={requestRestoreRevision}
/>

<!-- restore confirmation: gates the swap-back-to-old-audio -->
<ConfirmDialog
	open={restoreConfirm !== null}
	title="restore this version?"
	body={restoreConfirm
		? `this will make the selected version the live audio for "${restoreConfirm.track.title}". the current audio will move into version history.`
		: ''}
	confirmText="restore"
	cancelText="cancel"
	pending={restorePending}
	pendingText="restoring..."
	onConfirm={executeRestoreRevision}
	onCancel={() => { restoreConfirm = null; }}
/>

<style>
	/* shared page-level primitives — duplicated here because Svelte scoped CSS
	   does not cross the component boundary; the parent keeps its own copies for
	   the remaining sections. */
	.empty {
		color: var(--text-muted);
		padding: 2rem;
		text-align: center;
		background: var(--bg-tertiary);
		border-radius: var(--radius-md);
		border: 1px solid var(--border-subtle);
	}

	.loading-container {
		display: flex;
		justify-content: center;
		padding: 3rem 1rem;
	}

	.char-count {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		text-align: right;
	}

	.load-more-btn {
		display: block;
		width: 100%;
		padding: 0.75rem;
		margin-top: 1rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-secondary);
		font-size: var(--text-sm);
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
	}

	.load-more-btn:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}

	.load-more-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.tracks-section {
		margin-top: 3rem;
	}

	.tracks-section h2 {
		font-size: var(--text-page-heading);
		margin-bottom: 1.5rem;
	}

	/* search + sort row — inline above the list, no surrounding surface; the
	   input/select are the only chrome (they match the track cards below) */
	.tracks-toolbar {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.track-search {
		flex: 1;
		min-width: 0;
		padding: 0.55rem 0.75rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--text-base);
		transition: border-color 0.15s;
	}

	.track-search:focus {
		outline: none;
		border-color: var(--accent);
	}

	.track-sort {
		flex-shrink: 0;
		padding: 0.55rem 0.6rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}

	.track-sort:focus {
		outline: none;
		border-color: var(--accent);
	}

	.tracks-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	/* while a filter/sort reload is in flight, dim the prior results instead of
	   blanking to a spinner — keeps the search box and list in place */
	.tracks-list.refreshing {
		opacity: 0.5;
		transition: opacity 0.15s;
	}

	.track-item {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-base);
		padding: 1rem;
		transition: all 0.2s;
	}

	.track-item.editing {
		flex-direction: column;
		align-items: stretch;
	}

	.track-item.copyright-flagged {
		background: color-mix(in srgb, var(--warning) 8%, transparent);
		border-color: color-mix(in srgb, var(--warning) 30%, transparent);
	}

	.track-item.copyright-flagged .track-title {
		color: var(--warning);
	}

	.track-item.copyright-flagged .track-artwork img,
	.track-item.copyright-flagged .track-artwork-placeholder {
		opacity: 0.6;
	}

	.track-artwork-col {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		flex-shrink: 0;
	}

	.track-artwork {
		width: 48px;
		height: 48px;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--bg-primary);
		border: 1px solid var(--border-subtle);
	}

	.track-artwork img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.track-artwork-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}

	.track-view-link {
		font-size: var(--text-xs);
		color: var(--text-muted);
		text-decoration: none;
		transition: color 0.15s;
	}

	.track-view-link:hover {
		color: var(--accent);
	}

	.track-item:hover {
		background: var(--bg-hover);
		border-color: var(--border-default);
	}

	.track-info {
		flex: 1;
		min-width: 0;
	}

	.edit-container {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.edit-fields {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		flex: 1;
	}

	.edit-field-group {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 1rem;
		background: color-mix(in srgb, var(--bg-primary) 78%, var(--bg-tertiary));
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-base);
		transition: border-color 0.15s, background 0.15s;
	}

	.edit-field-group:focus-within {
		background: var(--bg-primary);
		border-color: color-mix(in srgb, var(--accent) 55%, var(--border-default));
	}

	.content-notice-field {
		border-left: 3px solid var(--accent);
		background: color-mix(in srgb, var(--accent) 6%, var(--bg-primary));
	}

	.access-field {
		background: color-mix(in srgb, var(--bg-primary) 88%, var(--bg-tertiary));
	}

	.suggested-tags-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 24px;
	}

	.suggested-label {
		font-size: var(--text-xs, 0.75rem);
		color: var(--text-tertiary);
		letter-spacing: 0.02em;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.suggested-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.suggested-tag-chip {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.5rem;
		background: transparent;
		border: 1px dashed color-mix(in srgb, var(--accent) 30%, transparent);
		color: var(--text-secondary);
		border-radius: var(--radius-xl);
		font-size: var(--text-sm);
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
	}

	.suggested-tag-chip:hover {
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		border-color: var(--accent);
		color: var(--accent);
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

	.toggle-row input[type="checkbox"] {
		width: 16px;
		height: 16px;
		accent-color: var(--accent);
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
		color: var(--accent);
		text-decoration: none;
	}

	.field-hint a:hover {
		text-decoration: underline;
	}

	.track-title {
		font-weight: 600;
		font-size: var(--text-lg);
		margin-bottom: 0.25rem;
		color: var(--text-primary);
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.support-gate-badge {
		display: inline-flex;
		align-items: center;
		color: var(--accent);
		flex-shrink: 0;
	}


	.track-meta {
		font-size: var(--text-base);
		color: var(--text-secondary);
		margin-bottom: 0.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.meta-features,
	.meta-album {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		width: 100%;
		min-width: 0;
	}

	.features-label {
		color: var(--accent-hover);
		font-weight: 600;
	}

	.features-list {
		color: var(--accent-hover);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.meta-album {
		color: var(--text-tertiary);
	}

	.album-link {
		color: var(--text-tertiary);
		text-decoration: none;
		transition: color 0.2s;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.album-link:hover {
		color: var(--accent);
	}

	.album-icon {
		width: 14px;
		height: 14px;
		opacity: 0.7;
		flex-shrink: 0;
	}

	.meta-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.meta-tag {
		display: inline-block;
		padding: 0.1rem 0.4rem;
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		color: var(--accent-hover);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		font-weight: 500;
		text-decoration: none;
		transition: all 0.15s;
	}

	.meta-tag:hover {
		background: color-mix(in srgb, var(--accent) 25%, transparent);
		color: var(--accent-hover);
	}

	.track-date {
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	.track-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
		margin-left: 0.75rem;
		align-self: flex-start;
	}

	/* track action buttons (edit/delete in non-editing state) */
	.track-action-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.65rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-full);
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		font-family: inherit;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
		width: auto;
	}

	.track-action-btn:hover {
		transform: none;
		box-shadow: none;
		border-color: var(--border-emphasis);
		color: var(--text-secondary);
	}

	.track-action-btn.delete:hover {
		color: var(--text-secondary);
	}

	/* edit mode action buttons */
	.edit-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border-subtle);
		margin-top: 0.5rem;
	}

	.edit-cancel-btn {
		padding: 0.6rem 1.25rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-secondary);
		font-size: var(--text-base);
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
		width: auto;
	}

	.edit-cancel-btn:hover {
		border-color: var(--text-tertiary);
		background: var(--bg-hover);
		transform: none;
		box-shadow: none;
	}

	.edit-save-btn {
		padding: 0.6rem 1.25rem;
		background: transparent;
		border: 1px solid var(--accent);
		border-radius: var(--radius-base);
		color: var(--accent);
		font-size: var(--text-base);
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
		width: auto;
	}

	.edit-save-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--accent) 8%, transparent);
	}

	.edit-save-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.edit-input {
		width: 100%;
		padding: 0.5rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: var(--text-base);
		font-family: inherit;
	}

	textarea.edit-input {
		resize: vertical;
		min-height: 4rem;
	}

	/* artwork editor */
	.artwork-editor {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
	}

	.artwork-preview {
		position: relative;
		width: 80px;
		height: 80px;
		border-radius: var(--radius-base);
		overflow: hidden;
		flex-shrink: 0;
	}

	.artwork-preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.artwork-preview-overlay {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.artwork-preview:hover .artwork-preview-overlay {
		opacity: 1;
	}

	.artwork-action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background: rgba(255, 255, 255, 0.15);
		border: none;
		border-radius: var(--radius-full);
		color: white;
		cursor: pointer;
		transition: all 0.15s;
	}

	.artwork-action-btn:hover {
		background: var(--error);
		transform: scale(1.1);
		box-shadow: none;
	}

	.artwork-status {
		font-size: var(--text-sm);
		color: var(--accent);
		font-weight: 500;
	}

	.artwork-status.current {
		color: var(--text-tertiary);
		font-weight: 400;
	}

	.artwork-removed {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		color: var(--text-tertiary);
	}

	.artwork-removed span {
		font-size: var(--text-sm);
	}

	.undo-remove-btn {
		padding: 0.25rem 0.75rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-full);
		color: var(--accent);
		font-size: var(--text-sm);
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
		width: auto;
	}

	.undo-remove-btn:hover {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		transform: none;
		box-shadow: none;
	}

	.artwork-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		color: var(--text-tertiary);
	}

	.artwork-empty span {
		font-size: var(--text-sm);
	}

	.artwork-upload-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.85rem;
		background: transparent;
		border: 1px solid var(--accent);
		border-radius: var(--radius-full);
		color: var(--accent);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
		margin-left: auto;
	}

	.artwork-upload-btn:hover {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}

	.artwork-upload-btn input {
		display: none;
	}

	.audio-replace-editor {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
	}

	.audio-current {
		flex: 1 1 auto;
		min-width: 0;
	}

	.audio-current-label {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	.audio-selected {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.65rem;
		background: color-mix(in srgb, var(--accent) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		border-radius: var(--radius-md);
		color: var(--accent);
		font-size: var(--text-sm);
		max-width: 100%;
		min-width: 0;
		flex: 1 1 auto;
	}

	.audio-filename {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.audio-clear-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.15rem;
		background: transparent;
		border: none;
		color: var(--accent);
		font-family: inherit;
		opacity: 0.7;
		cursor: pointer;
		transition: opacity 0.15s;
		margin-left: auto;
	}

	.audio-clear-btn:hover {
		opacity: 1;
	}

	.audio-upload-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.85rem;
		background: transparent;
		border: 1px solid var(--accent);
		border-radius: var(--radius-full);
		color: var(--accent);
		font-family: inherit;
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
		margin-left: auto;
	}

	.audio-upload-btn:hover {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}

	.audio-upload-btn input {
		display: none;
	}

	.audio-replace-btn {
		padding: 0.5rem 0.95rem;
		background: var(--accent);
		border: 1px solid var(--accent);
		border-radius: var(--radius-full);
		color: var(--bg);
		font-family: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		transition: filter 0.15s;
	}

	.audio-replace-btn:hover {
		filter: brightness(1.1);
	}

	.audio-history-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.7rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-full);
		color: var(--text-secondary);
		font-family: inherit;
		font-size: var(--text-xs);
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.audio-history-btn:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
		border-color: var(--text-secondary);
	}

	.audio-replace-hint {
		flex-basis: 100%;
		margin: 0.35rem 0 0;
		font-size: var(--text-xs);
		color: var(--text-tertiary);
	}

	.edit-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	@media (max-width: 600px) {
		.tracks-section h2 {
			font-size: var(--text-xl);
		}

		.tracks-section {
			margin-top: 2rem;
		}

		.tracks-list {
			gap: 0.5rem;
		}

		.track-item {
			padding: 0.75rem;
			gap: 0.75rem;
		}

		.track-artwork-col {
			gap: 0.25rem;
		}

		.track-artwork {
			width: 40px;
			height: 40px;
		}

		.track-view-link {
			font-size: 0.65rem;
		}

		.track-title {
			font-size: var(--text-base);
		}

		.track-meta {
			font-size: var(--text-sm);
		}

		.track-date {
			font-size: var(--text-xs);
		}

		.track-actions {
			margin-left: 0.5rem;
			gap: 0.35rem;
			flex-direction: column;
		}

		.track-action-btn {
			padding: 0.35rem 0.55rem;
			font-size: var(--text-xs);
		}

		.track-action-btn svg {
			width: 12px;
			height: 12px;
		}

		/* edit mode mobile */
		.edit-container {
			gap: 0.75rem;
		}

		.edit-fields {
			gap: 0.75rem;
		}

		.edit-field-group {
			padding: 0.875rem;
		}

		.edit-label {
			font-size: var(--text-sm);
		}

		.edit-input {
			padding: 0.45rem 0.5rem;
			font-size: var(--text-sm);
		}

		.edit-actions {
			gap: 0.5rem;
			flex-direction: column;
		}

		.edit-cancel-btn,
		.edit-save-btn {
			width: 100%;
			padding: 0.6rem;
			font-size: var(--text-sm);
		}

		/* artwork editor mobile */
		.artwork-editor {
			flex-direction: column;
			gap: 0.75rem;
			padding: 0.65rem;
		}

		.artwork-preview {
			width: 64px;
			height: 64px;
		}

		.artwork-upload-btn {
			margin-left: 0;
		}
	}
</style>
