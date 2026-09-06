<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import type AudioRevisionsSheet from '$lib/components/AudioRevisionsSheet.svelte';
	import { API_URL, getServerConfig } from '$lib/config';
	import { toast } from '$lib/toast.svelte';
	import { uploader, type AudioReplacementStatus } from '$lib/uploader.svelte';
	import { isOptimizing } from '$lib/utils/track-audio';
	import type { Track } from '$lib/types';
	interface Props {
		track: Track;
		onTrackChanged?: (track: Track) => void | Promise<void>;
		onBusyChange: (busy: boolean) => void;
		onDirtyChange: (dirty: boolean) => void;
	}
	let { track, onTrackChanged, onBusyChange, onDirtyChange }: Props = $props();
	const AUDIO_FILE_INPUT_ACCEPT =
		'.mp3,.wav,.m4a,.aiff,.aif,.flac,audio/mpeg,audio/wav,audio/mp4,audio/aiff,audio/x-aiff,audio/flac';
	let replacementStatus = $state<AudioReplacementStatus | null>(null);
	let audioError = $state<string | null>(null);
	let restoreError = $state<string | null>(null);
	$effect(() => {
		onBusyChange(restorePending);
	});
	$effect(() => {
		onDirtyChange(Boolean(editAudioFile));
	});
	let editAudioFile = $state<File | null>(null);
	let replaceConfirm = $state<{ track: Track; file: File } | null>(null);

	type AudioRevision = ComponentProps<typeof AudioRevisionsSheet>['revisions'][number];
	let revisionsSheetTrack = $state<Track | null>(null);
	let revisionsList = $state<AudioRevision[]>([]);
	let revisionsLoading = $state(false);
	let revisionsError = $state<string | null>(null);
	let restoreConfirm = $state<{ track: Track; revision: AudioRevision } | null>(null);
	let restorePending = $state(false);
	async function selectAudioReplacement(file: File) {
		try {
			const config = await getServerConfig();
			const sizeMB = file.size / (1024 * 1024);
			if (sizeMB > config.max_upload_size_mb) {
				audioError = `audio file exceeds ${config.max_upload_size_mb}MB limit`;
				return;
			}
		} catch {
			// The upload endpoint still enforces the size limit.
		}
		audioError = null;
		editAudioFile = file;
	}

	function requestReplaceAudio(track: Track) {
		if (!editAudioFile) return;
		replaceConfirm = { track, file: editAudioFile };
	}

	async function refreshTrack(): Promise<Track> {
		const response = await fetch(`${API_URL}/tracks/${track.id}`, { credentials: 'include' });
		if (!response.ok) throw new Error('could not refresh track — try again');
		const fresh: Track = await response.json();
		await onTrackChanged?.(fresh);
		return fresh;
	}

	function executeReplaceAudio() {
		if (!replaceConfirm) return;
		const { track, file } = replaceConfirm;
		const trackId = track.id;

		uploader.replaceAudio(
			trackId,
			file,
			track.title,
			async () => {
				await refreshTrack();
			},
			(status) => {
				replacementStatus = status;
			}
		);

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
		restoreError = null;
		try {
			const resp = await fetch(`${API_URL}/tracks/${track.id}/revisions/${revision.id}/restore`, {
				method: 'POST',
				credentials: 'include'
			});
			if (!resp.ok) {
				const detail = await resp.json().catch(() => ({}));
				restoreError = detail.detail ?? 'could not restore audio — try again';
				return;
			}
			await refreshTrack();
			toast.success('audio restored');
			replacementStatus = { type: 'success', message: 'audio restored' };

			if (revisionsSheetTrack?.id === track.id) {
				await openVersionHistory(track);
			}
			restoreConfirm = null;
		} catch {
			restoreError = 'could not restore audio — try again';
		} finally {
			restorePending = false;
		}
	}
</script>

<details class="advanced-section">
	<summary>audio &amp; version history</summary>
	<div class="advanced-content">
		{#if replacementStatus}<p
				class="replacement-status"
				class:failed={replacementStatus.type === 'error'}
				role={replacementStatus.type === 'error' ? 'alert' : 'status'}
			>
				{replacementStatus.message}
			</p>{/if}
		{#if audioError}<p class="save-error" role="alert">{audioError}</p>{/if}
		<div class="edit-field-group">
			<span class="edit-label">audio file</span>
			<div class="audio-replace-editor">
				{#if editAudioFile}
					<div class="audio-selected">
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<path d="M9 18V5l12-2v13"></path>
							<circle cx="6" cy="18" r="3"></circle>
							<circle cx="18" cy="16" r="3"></circle>
						</svg>
						<span class="audio-filename">{editAudioFile.name}</span>
						<button
							type="button"
							class="audio-clear-btn"
							onclick={() => {
								editAudioFile = null;
							}}
							title="discard selection"
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
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
							current: {track.file_type}{track.original_file_type &&
							track.original_file_type !== track.file_type
								? ` (transcoded from ${track.original_file_type})`
								: ''}{isOptimizing(track)
								? ' · optimizing — mp3 will land on your PDS shortly'
								: track.audio_storage === 'both' || track.audio_storage === 'pds'
									? ' · stored on your PDS'
									: ' · stored on plyr.fm'}
						</span>
					</div>
					<label class="audio-upload-btn">
						<input
							type="file"
							accept={AUDIO_FILE_INPUT_ACCEPT}
							onchange={(e) => {
								const target = e.currentTarget;
								const file = target.files?.[0];
								if (file) {
									void selectAudioReplacement(file);
								}
								target.value = '';
							}}
						/>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
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
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
						>
							<path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path>
							<polyline points="3 3 3 8 8 8"></polyline>
							<polyline points="12 7 12 12 15 14"></polyline>
						</svg>
						version history
					</button>
				{/if}
				<p class="audio-replace-hint">
					choose a new file, then confirm. uploading runs in the background and the previous audio
					is kept in version history so you can roll back. likes, comments, plays, and the track URL
					stay the same.
				</p>
			</div>
		</div>
	</div>
	{#if revisionsSheetTrack}
		<section class="version-history" aria-label="audio version history">
			<div class="history-heading">
				<span>previous audio</span><button
					type="button"
					class="audio-history-btn"
					onclick={() => {
						revisionsSheetTrack = null;
					}}>close history</button
				>
			</div>
			{#if revisionsLoading}<p class="audio-replace-hint" role="status">loading versions…</p>
			{:else if revisionsError}<p class="save-error" role="alert">{revisionsError}</p>
				<button type="button" class="audio-history-btn" onclick={() => openVersionHistory(track)}
					>retry</button
				>
			{:else if revisionsList.length === 0}<p class="audio-replace-hint">
					no previous audio versions
				</p>
			{:else}<ul>
					{#each revisionsList as revision (revision.id)}<li>
							<span
								>{new Date(revision.created_at).toLocaleString()} · {revision.original_file_type ??
									revision.file_type}{revision.duration
									? ` · ${Math.round(revision.duration)}s`
									: ''}</span
							><button
								type="button"
								class="audio-history-btn"
								onclick={() => requestRestoreRevision(revision)}>restore</button
							>
						</li>{/each}
				</ul>{/if}
		</section>
	{/if}
</details>
<ConfirmDialog
	open={replaceConfirm !== null}
	title="replace audio?"
	body={replaceConfirm
		? `this will swap the audio file for "${replaceConfirm.track.title}". the previous audio will be saved in version history so you can roll back. likes, comments, plays, and the track URL won't change.`
		: ''}
	confirmText="replace"
	cancelText="cancel"
	onConfirm={executeReplaceAudio}
	onCancel={() => {
		replaceConfirm = null;
	}}
/>

<ConfirmDialog
	open={restoreConfirm !== null}
	title="restore this version?"
	body={restoreConfirm
		? `${restoreError ? `${restoreError}\n\n` : ''}this will make the selected version the live audio for "${restoreConfirm.track.title}". the current audio will move into version history.`
		: ''}
	confirmText="restore"
	cancelText="cancel"
	pending={restorePending}
	pendingText="restoring..."
	onConfirm={executeRestoreRevision}
	onCancel={() => {
		restoreConfirm = null;
	}}
/>

<style>
	.edit-field-group {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 1rem;
		background: color-mix(in srgb, var(--bg-primary) 78%, var(--bg-tertiary));
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-base);
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.edit-field-group:focus-within {
		background: var(--bg-primary);
		border-color: color-mix(in srgb, var(--accent) 55%, var(--border-default));
	}
	.edit-label {
		font-size: var(--text-sm);
		font-weight: 600;
		letter-spacing: 0.015em;
		color: var(--text-primary);
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
		color: var(--text-primary);
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
		color: var(--text-primary);
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
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.85rem;
		background: transparent;
		border: 1px solid var(--accent);
		border-radius: var(--radius-full);
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		transition:
			background var(--motion-feedback) var(--ease-surface),
			border-color var(--motion-feedback) var(--ease-surface);
		margin-left: auto;
	}
	.audio-upload-btn:hover {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}
	.audio-upload-btn input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}
	.audio-replace-btn {
		padding: 0.5rem 0.95rem;
		background: var(--accent);
		border: 1px solid var(--accent);
		border-radius: var(--radius-full);
		color: var(--accent-contrast);
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
		transition:
			background var(--motion-feedback) var(--ease-surface),
			border-color var(--motion-feedback) var(--ease-surface);
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
	@media (max-width: 600px) {
		.edit-field-group {
			padding: 0.875rem;
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
	.save-error {
		color: var(--error);
		font-size: var(--text-sm);
		margin: 0;
	}
	@media (prefers-reduced-motion: reduce) {
		.edit-field-group {
			transition: none;
		}
	}
	.version-history {
		border-top: 1px solid var(--border-subtle);
		margin-top: 1rem;
		padding-top: 1rem;
		font-size: var(--text-sm);
	}
	.history-heading,
	.version-history li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.version-history ul {
		list-style: none;
		padding: 0;
		margin: 0.75rem 0 0;
	}
	.version-history li {
		padding: 0.5rem 0;
		color: var(--text-secondary);
	}
	.audio-upload-btn:focus-within {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.replacement-status {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--text-sm);
		line-height: 1.4;
	}
	.replacement-status.failed {
		color: var(--error);
	}
</style>
