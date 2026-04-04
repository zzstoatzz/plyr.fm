<script lang="ts">
	import type { AlbumSummary, Artist } from '$lib/types';
	import type { TrackEntry } from '$lib/components/TrackEntryCard.svelte';
	import TrackEntryCard from '$lib/components/TrackEntryCard.svelte';
	import PdsTooltip from '$lib/components/PdsTooltip.svelte';
	import { uploader } from '$lib/uploader.svelte';
	import { toast } from '$lib/toast.svelte';
	import { getServerConfig } from '$lib/config';

	const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aiff', '.aif', '.flac'];
	const FILE_INPUT_ACCEPT =
		'.mp3,.wav,.m4a,.aiff,.aif,.flac,audio/mpeg,audio/wav,audio/mp4,audio/aiff,audio/x-aiff,audio/flac';
	const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per track

	interface Props {
		albums: AlbumSummary[];
		artistProfile: Artist | null;
		onAlbumsReload: () => Promise<void>;
	}

	let { albums, artistProfile, onAlbumsReload }: Props = $props();

	let albumTitle = $state('');
	let coverArtFile = $state<File | null>(null);
	const initialTrack = createEmptyTrack();
	let tracks = $state<TrackEntry[]>([initialTrack]);
	let attestedRights = $state(false);
	let uploading = $state(false);
	let expandedTrackId = $state<string | null>(initialTrack.id);

	let bulkFileInputEl = $state<HTMLInputElement | null>(null);

	let albumTitleConflict = $derived(
		albumTitle.trim().length > 0 &&
			albums.some((a) => a.title.toLowerCase() === albumTitle.trim().toLowerCase()),
	);

	let completedCount = $derived(tracks.filter((t) => t.status === 'completed').length);
	let currentUploadIndex = $derived(tracks.findIndex((t) => t.status === 'uploading' || t.status === 'processing'));
	let hasUnresolvedFeatures = $derived(tracks.some((t) => t.hasUnresolvedFeaturesInput));

	let canSubmit = $derived(
		albumTitle.trim().length > 0 &&
			tracks.every((t) => t.file !== null && t.title.trim().length > 0) &&
			attestedRights &&
			!hasUnresolvedFeatures &&
			!uploading,
	);

	function createEmptyTrack(): TrackEntry {
		return {
			id: crypto.randomUUID(),
			file: null,
			title: '',
			description: '',
			tags: [],
			featuredArtists: [],
			hasUnresolvedFeaturesInput: false,
			autoTag: false,
			supportGated: false,
			status: 'pending',
			error: null,
		};
	}

	function titleFromFilename(name: string): string {
		// strip extension
		const dotIndex = name.lastIndexOf('.');
		let base = dotIndex !== -1 ? name.slice(0, dotIndex) : name;

		// strip leading track numbers (01 - , 01. , 01_, 1 - , 1. , etc.)
		base = base.replace(/^\d+\s*[-._]\s*/, '');

		// replace underscores and hyphens with spaces
		base = base.replace(/[_-]/g, ' ');

		// title-case each word
		return base
			.split(/\s+/)
			.filter((w) => w.length > 0)
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
			.join(' ');
	}

	function isSupportedAudioFile(name: string): boolean {
		const dotIndex = name.lastIndexOf('.');
		if (dotIndex === -1) return false;
		const ext = name.slice(dotIndex).toLowerCase();
		return AUDIO_EXTENSIONS.includes(ext);
	}

	function addTrack() {
		const entry = createEmptyTrack();
		tracks = [...tracks, entry];
		expandedTrackId = entry.id;
	}

	async function addTracksFromFiles(files: FileList) {
		let config;
		try {
			config = await getServerConfig();
		} catch (_e) {
			console.error('failed to fetch server config:', _e);
			toast.error('failed to validate file sizes');
			return;
		}

		const skipped: string[] = [];
		const added: TrackEntry[] = [];

		for (const file of files) {
			if (!isSupportedAudioFile(file.name)) {
				skipped.push(`${file.name} (unsupported format)`);
				continue;
			}

			const sizeMB = file.size / (1024 * 1024);
			if (sizeMB > config.max_upload_size_mb) {
				skipped.push(`${file.name} (${sizeMB.toFixed(1)}MB exceeds ${config.max_upload_size_mb}MB limit)`);
				continue;
			}

			const entry: TrackEntry = {
				id: crypto.randomUUID(),
				file,
				title: titleFromFilename(file.name),
				description: '',
				tags: [],
				featuredArtists: [],
				hasUnresolvedFeaturesInput: false,
				autoTag: false,
				supportGated: false,
				status: 'pending',
				error: null,
			};
			added.push(entry);
		}

		if (added.length > 0) {
			// replace the initial empty track if it has no file
			if (tracks.length === 1 && tracks[0].file === null && tracks[0].title === '') {
				tracks = added;
			} else {
				tracks = [...tracks, ...added];
			}
			expandedTrackId = added[0].id;
		}

		if (skipped.length > 0) {
			toast.warning(`skipped ${skipped.length} file${skipped.length > 1 ? 's' : ''}: ${skipped.join('; ')}`);
		}
	}

	function removeTrack(id: string) {
		if (tracks.length <= 1) return;

		const idx = tracks.findIndex((t) => t.id === id);
		tracks = tracks.filter((t) => t.id !== id);

		if (expandedTrackId === id) {
			// expand the next track, or the last one if we removed the last
			const nextIdx = Math.min(idx, tracks.length - 1);
			expandedTrackId = tracks[nextIdx].id;
		}
	}

	function updateTrack(id: string, field: string, value: any) {
		const idx = tracks.findIndex((t) => t.id === id);
		if (idx !== -1) {
			tracks[idx] = { ...tracks[idx], [field]: value };
		}
	}

	async function handleFileChange(id: string, file: File) {
		if (!isSupportedAudioFile(file.name)) {
			toast.error(`unsupported file type. supported: ${AUDIO_EXTENSIONS.join(', ')}`);
			return;
		}

		try {
			const config = await getServerConfig();
			const sizeMB = file.size / (1024 * 1024);
			if (sizeMB > config.max_upload_size_mb) {
				toast.error(`audio file too large (${sizeMB.toFixed(1)}MB). max: ${config.max_upload_size_mb}MB`);
				return;
			}
		} catch (_e) {
			console.error('failed to validate file size:', _e);
		}

		const idx = tracks.findIndex((t) => t.id === id);
		if (idx !== -1) {
			const track = tracks[idx];
			const updates: Partial<TrackEntry> = { file };
			if (!track.title) {
				updates.title = titleFromFilename(file.name);
			}
			tracks[idx] = { ...track, ...updates };
		}
	}

	async function handleCoverArtChange(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			const selected = target.files[0];

			try {
				const config = await getServerConfig();
				const sizeMB = selected.size / (1024 * 1024);
				if (sizeMB > config.max_image_size_mb) {
					toast.error(`image too large (${sizeMB.toFixed(1)}MB). max: ${config.max_image_size_mb}MB`);
					target.value = '';
					coverArtFile = null;
					return;
				}
			} catch (_e) {
				console.error('failed to validate image size:', _e);
			}

			coverArtFile = selected;
		}
	}

	function handleBulkFileInput(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			addTracksFromFiles(target.files);
			target.value = '';
		}
	}

	async function handleUploadAlbum(e: SubmitEvent) {
		e.preventDefault();

		if (!canSubmit) return;

		uploading = true;
		let completed = 0;
		let failed = 0;

		for (let i = 0; i < tracks.length; i++) {
			const track = tracks[i];
			tracks[i] = { ...tracks[i], status: 'uploading' };

			await new Promise<void>((resolve) => {
				let resolved = false;
				const safeResolve = () => {
					if (!resolved) {
						resolved = true;
						resolve();
					}
				};

				const timeout = setTimeout(() => {
					if (!resolved) {
						tracks[i] = { ...tracks[i], status: 'failed', error: 'upload timed out' };
						failed++;
						safeResolve();
					}
				}, UPLOAD_TIMEOUT_MS);

				uploader.upload(
					track.file!,
					track.title,
					albumTitle.trim(),
					[...track.featuredArtists],
					i === 0 ? coverArtFile : null,
					[...track.tags],
					track.supportGated,
					track.autoTag,
					track.description,
					() => {
						// SSE completed
						clearTimeout(timeout);
						tracks[i] = { ...tracks[i], status: 'completed' };
						completed++;
						onAlbumsReload();
						safeResolve();
					},
					{
						onSuccess: (_uploadId: string) => {
							// XHR upload succeeded, now processing via SSE
							tracks[i] = { ...tracks[i], status: 'processing' };
						},
						onError: (error: string) => {
							clearTimeout(timeout);
							tracks[i] = { ...tracks[i], status: 'failed', error };
							failed++;
							safeResolve();
						},
					},
				);
			});
		}

		// refresh albums so we can find the slug for the "view album" link
		await onAlbumsReload();

		if (completed > 0) {
			const albumSlug = albums.find(
				(a) => a.title.toLowerCase() === albumTitle.trim().toLowerCase(),
			)?.slug;

			toast.success(
				`${completed} of ${tracks.length} track${tracks.length > 1 ? 's' : ''} uploaded`,
				5000,
				albumSlug
					? {
							label: 'view album',
							href: `/album/${albumSlug}`,
						}
					: undefined,
			);
		}

		if (failed > 0 && completed === 0) {
			toast.error(`all ${failed} track${failed > 1 ? 's' : ''} failed to upload`);
		} else if (failed > 0) {
			toast.warning(`${failed} track${failed > 1 ? 's' : ''} failed to upload`);
		}

		uploading = false;
	}
</script>

<form onsubmit={handleUploadAlbum}>
	<div class="form-group">
		<label for="album-title">album title</label>
		<input
			id="album-title"
			type="text"
			bind:value={albumTitle}
			required
			maxlength="256"
			placeholder="album title"
			disabled={uploading}
		/>
		{#if albumTitleConflict}
			<p class="title-warning">an album with this title already exists — tracks will be added to it</p>
		{/if}
	</div>

	<div class="form-group">
		<label for="cover-art" class="label-with-tooltip">
			cover art (optional)
			<PdsTooltip />
		</label>
		<input
			id="cover-art"
			type="file"
			accept="image/*"
			onchange={handleCoverArtChange}
			disabled={uploading}
		/>
		<p class="format-hint">supported: jpg, png, webp, gif</p>
		{#if coverArtFile}
			<p class="file-info">
				{coverArtFile.name} ({(coverArtFile.size / 1024 / 1024).toFixed(2)} MB)
			</p>
		{/if}
	</div>

	<div class="tracks-section">
		<span class="tracks-label">tracks</span>
		<div class="track-list">
			{#each tracks as track, i (track.id)}
				<TrackEntryCard
					entry={track}
					index={i}
					expanded={expandedTrackId === track.id}
					{artistProfile}
					disabled={uploading}
					onUpdate={(field, value) => updateTrack(track.id, field, value)}
					onRemove={() => removeTrack(track.id)}
					onToggle={() => (expandedTrackId = expandedTrackId === track.id ? null : track.id)}
					onFileChange={(file) => handleFileChange(track.id, file)}
				/>
			{/each}
		</div>

		<div class="button-bar">
			<button
				type="button"
				class="secondary-btn"
				disabled={uploading}
				onclick={() => bulkFileInputEl?.click()}
			>
				choose files
			</button>
			<button type="button" class="secondary-btn" disabled={uploading} onclick={addTrack}>
				+ add track
			</button>
		</div>

		<input
			bind:this={bulkFileInputEl}
			type="file"
			accept={FILE_INPUT_ACCEPT}
			multiple
			class="hidden-input"
			onchange={handleBulkFileInput}
		/>
	</div>

	{#if uploading}
		<div class="upload-progress">
			{#if currentUploadIndex >= 0}
				<p class="progress-text">
					uploading track {currentUploadIndex + 1} of {tracks.length}...
				</p>
			{:else}
				<p class="progress-text">
					{completedCount} of {tracks.length} track{tracks.length > 1 ? 's' : ''} completed
				</p>
			{/if}
			<div class="progress-bar-bg">
				<div
					class="progress-bar-fill"
					style="width: {(completedCount / tracks.length) * 100}%"
				></div>
			</div>
		</div>
	{/if}

	<div class="form-group attestation">
		<label class="checkbox-label">
			<input
				type="checkbox"
				bind:checked={attestedRights}
				required
				disabled={uploading}
			/>
			<span class="checkbox-text">
				I have the right to distribute this content, I am not
				knowingly infringing on copyright or otherwise stealing
				from artists.
			</span>
		</label>
		<p class="attestation-note">
			Content appearing on other platforms (YouTube, SoundCloud,
			Internet Archive, etc.) does not mean it's licensed for
			redistribution. You should own the rights or have explicit
			permission, or the content may be removed to keep plyr.fm in
			compliance. For any questions or concerns, please DM
			<a
				href="https://bsky.app/profile/zzstoatzz.io"
				target="_blank"
				rel="noopener">@zzstoatzz.io</a
			> :) have a nice day!
		</p>
	</div>

	<button
		type="submit"
		disabled={!canSubmit}
		class="upload-btn"
		title={!albumTitle.trim()
			? 'please enter an album title'
			: !tracks.every((t) => t.file && t.title.trim())
				? 'every track needs a file and title'
				: hasUnresolvedFeatures
					? 'please select or clear featured artists'
					: !attestedRights
						? 'please confirm you have distribution rights'
						: ''}
	>
		{#if uploading}
			uploading...
		{:else}
			upload album ({tracks.length} track{tracks.length > 1 ? 's' : ''})
		{/if}
	</button>
</form>

<style>
	form {
		background: var(--bg-tertiary);
		padding: 2rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-subtle);
	}

	.form-group {
		margin-bottom: 1.5rem;
	}

	label {
		display: block;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
		font-size: var(--text-base);
	}

	.label-with-tooltip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	input[type='text'] {
		width: 100%;
		padding: 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: var(--text-lg);
		font-family: inherit;
		transition: all 0.2s;
	}

	input[type='text']:focus {
		outline: none;
		border-color: var(--accent);
	}

	input[type='text']:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	input[type='file'] {
		width: 100%;
		padding: 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: var(--text-base);
		font-family: inherit;
		cursor: pointer;
	}

	input[type='file']:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.format-hint {
		margin-top: 0.25rem;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	.file-info {
		margin-top: 0.5rem;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	.title-warning {
		margin-top: 0.375rem;
		font-size: var(--text-sm);
		color: var(--warning, #e6a817);
	}

	.tracks-section {
		margin-bottom: 1.5rem;
	}

	.tracks-label {
		display: block;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
		font-size: var(--text-base);
	}

	.track-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.button-bar {
		display: flex;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}

	.secondary-btn {
		padding: 0.625rem 1.25rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: var(--text-base);
		font-family: inherit;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.secondary-btn:hover:not(:disabled) {
		border-color: var(--text-tertiary);
		background: var(--bg-hover);
	}

	.secondary-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.hidden-input {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.upload-progress {
		margin-bottom: 1.5rem;
		padding: 1rem;
		background: var(--bg-primary);
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-default);
	}

	.progress-text {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
	}

	.progress-bar-bg {
		width: 100%;
		height: 4px;
		background: var(--border-subtle);
		border-radius: 2px;
		overflow: hidden;
	}

	.progress-bar-fill {
		height: 100%;
		background: var(--accent);
		border-radius: 2px;
		transition: width 0.3s ease;
	}

	.attestation {
		background: var(--bg-primary);
		padding: 1rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-default);
	}

	.checkbox-label {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		cursor: pointer;
		margin-bottom: 0;
	}

	.checkbox-label input[type='checkbox'] {
		width: 1.25rem;
		height: 1.25rem;
		margin-top: 0.1rem;
		flex-shrink: 0;
		accent-color: var(--accent);
		cursor: pointer;
	}

	.checkbox-label input[type='checkbox']:disabled {
		cursor: not-allowed;
	}

	.checkbox-text {
		font-size: var(--text-base);
		color: var(--text-primary);
		line-height: 1.4;
	}

	.attestation-note {
		margin-top: 0.75rem;
		margin-left: 2rem;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		line-height: 1.4;
	}

	.attestation-note a {
		color: var(--accent);
		text-decoration: none;
	}

	.attestation-note a:hover {
		text-decoration: underline;
	}

	.upload-btn {
		width: 100%;
		padding: 0.75rem;
		background: var(--accent);
		color: var(--text-primary);
		border: none;
		border-radius: var(--radius-sm);
		font-size: var(--text-lg);
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
	}

	.upload-btn:hover:not(:disabled) {
		background: var(--accent-hover);
		transform: translateY(-1px);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	.upload-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	.upload-btn:active:not(:disabled) {
		transform: translateY(0);
	}

	@media (max-width: 768px) {
		form {
			padding: 1.25rem;
		}

		.button-bar {
			flex-direction: column;
		}

		input[type='text'] {
			font-size: 16px; /* prevents zoom on iOS */
		}
	}
</style>
