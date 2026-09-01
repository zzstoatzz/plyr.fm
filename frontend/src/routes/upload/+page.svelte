<script lang="ts">
	import { onMount } from "svelte";
	import { browser } from "$app/environment";
	import Header from "$lib/components/Header.svelte";
	import HandleSearch from "$lib/components/HandleSearch.svelte";
	import AlbumSelect from "$lib/components/AlbumSelect.svelte";
	import AlbumUploadForm from "$lib/components/AlbumUploadForm.svelte";
	import PdsTooltip from "$lib/components/PdsTooltip.svelte";
	import InfoTooltip from "$lib/components/InfoTooltip.svelte";
	import WaveLoading from "$lib/components/WaveLoading.svelte";
	import AudioPreview from "$lib/components/AudioPreview.svelte";
	import TagInput from "$lib/components/TagInput.svelte";
	import CopyrightRightsPanel from "$lib/components/CopyrightRightsPanel.svelte";
	import VisibilityPicker from "$lib/components/VisibilityPicker.svelte";
	import { isWebPlayableAudioFile } from "$lib/utils/web-playable";
	import type { TrackRights } from "$lib/components/CopyrightRightsPanel.svelte";
	import type { FeaturedArtist, AlbumSummary, Artist } from "$lib/types";
	import { API_URL, getServerConfig } from "$lib/config";
	import { profileLink } from "$lib/atclients";
	import { uploader } from "$lib/uploader.svelte";
	import { toast } from "$lib/toast.svelte";
	import { auth } from "$lib/auth.svelte";
	import { redirectToLogin } from "$lib/utils/auth-redirect";
	import {
		stashTrackForm,
		restoreTrackForm,
		clearTrackFormStash,
		preflightAuth,
	} from "$lib/upload-form-stash";
	import { stashUploadFiles, takeUploadFiles } from "$lib/record-stash";
	import { startPermissionedScopeUpgrade } from "$lib/uploader.svelte";
	import type { StagedTransfer } from "$lib/staged-transfer.svelte";

	const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aiff", ".aif", ".flac"];
	const AUDIO_MIME_TYPES = [
		"audio/mpeg", "audio/wav", "audio/mp4",
		"audio/aiff", "audio/x-aiff", "audio/flac",
	];
	const FILE_INPUT_ACCEPT = [...AUDIO_EXTENSIONS, ...AUDIO_MIME_TYPES].join(",");

	function isSupportedAudioFile(name: string): boolean {
		const dotIndex = name.lastIndexOf(".");
		if (dotIndex === -1) return false;
		const ext = name.slice(dotIndex).toLowerCase();
		return AUDIO_EXTENSIONS.includes(ext);
	}

	let loading = $state(true);

	// upload mode: track (single) or album (multi-track)
	let mode = $state<'track' | 'album'>(
		browser && new URLSearchParams(window.location.search).get('mode') === 'album'
			? 'album'
			: 'track'
	);

	function setMode(newMode: 'track' | 'album') {
		mode = newMode;
		const url = new URL(window.location.href);
		if (newMode === 'album') {
			url.searchParams.set('mode', 'album');
		} else {
			url.searchParams.delete('mode');
		}
		window.history.replaceState({}, '', url.toString());
	}

	// upload form fields
	let title = $state("");
	let albumTitle = $state("");
	let file = $state<File | null>(null);
	// the file's transfer into staging; nothing leaves the browser until submit
	let staged = $state<StagedTransfer | null>(null);
	let imageFile = $state<File | null>(null);
	let featuredArtists = $state<FeaturedArtist[]>([]);
	let uploadTags = $state<string[]>([]);
	let description = $state("");
	let hasUnresolvedFeaturesInput = $state(false);
	let attestedRights = $state(false);
	let autoTag = $state(false);
	let sensitiveAudio = $state(false);
	// visibility/access — one mutually-exclusive choice:
	//   public | unlisted | supporters | private
	// "private" is only offered when the PDS supports com.atproto.space.* (/auth/me).
	const VISIBILITIES = ['public', 'unlisted', 'supporters', 'private'] as const;
	type Visibility = (typeof VISIBILITIES)[number];
	let visibility = $state<Visibility>('public');

	function parseVisibility(raw: string | undefined): Visibility {
		return VISIBILITIES.find((option) => option === raw) ?? 'public';
	}
	const permissionedSupported = $derived(
		auth.user?.permissioned_spaces?.supported ?? false
	);
	const permissionedGranted = $derived(
		auth.user?.permissioned_spaces?.granted ?? false
	);
	// copyright rights metadata — orthogonal, rides on public/unlisted tracks.
	// when enabled, audio is uploaded to private storage and the backend writes
	// indiemusi song + recording records after the track is published.
	let copyrightEnabled = $state(false);
	let copyrightRights = $state<TrackRights>({});

	// albums for selection
	let albums = $state<AlbumSummary[]>([]);

	// artist profile for checking atprotofans eligibility
	let artistProfile = $state<Artist | null>(null);

	onMount(async () => {
		// wait for auth to finish loading
		while (auth.loading) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}

		if (!auth.isAuthenticated) {
			redirectToLogin();
			return;
		}

		// restore a draft stashed when the user was bounced to /login by an
		// expired-session pre-flight. files can't be serialized, so the user
		// re-attaches the audio (and cover art) — everything else is restored.
		const stashed = restoreTrackForm();
		if (stashed) {
			title = stashed.title;
			albumTitle = stashed.albumTitle;
			description = stashed.description;
			featuredArtists = stashed.featuredArtists;
			uploadTags = stashed.uploadTags;
			attestedRights = stashed.attestedRights;
			autoTag = stashed.autoTag;
			sensitiveAudio = stashed.sensitiveAudio ?? false;
			visibility = parseVisibility(stashed.visibility);
			clearTrackFormStash();
			const files = await takeUploadFiles();
			if (files) {
				chooseFile(files.file);
				imageFile = files.imageFile;
			}
			if (visibility === "private" && !permissionedGranted) {
				toast.error("not approved — your draft is still here", 6000);
			} else if (files && visibility === "private") {
				toast.success("approved — uploading your track", 4000);
				await submitUpload();
			} else if (!files) {
				toast.info(
					"your draft was restored — please reattach your audio file",
					7000,
				);
			}
		}

		await Promise.all([loadMyAlbums(), loadArtistProfile()]);
		loading = false;
	});

	function chooseFile(selected: File | null) {
		file = selected;
		staged = null;
	}

	async function loadArtistProfile() {
		if (!auth.user) return;
		try {
			const response = await fetch(
				`${API_URL}/artists/by-handle/${auth.user.handle}`,
			);
			if (response.ok) {
				artistProfile = await response.json();
			}
		} catch (_e) {
			console.error("failed to load artist profile:", _e);
		}
	}

	async function loadMyAlbums() {
		if (!auth.user) return;
		try {
			const response = await fetch(
				`${API_URL}/albums/${auth.user.handle}`,
			);
			if (response.ok) {
				const data = await response.json();
				albums = data.albums;
			}
		} catch (_e) {
			console.error("failed to load albums:", _e);
		}
	}

	// everything except the (unserializable) audio/cover files, so a draft can be
	// restored after a redirect — an expired-session bounce to /login, or the
	// one-time private-media scope-upgrade consent.
	function currentFormStash() {
		return {
			title,
			albumTitle,
			description,
			featuredArtists: [...featuredArtists],
			uploadTags: [...uploadTags],
			attestedRights,
			autoTag,
			sensitiveAudio,
			visibility,
		};
	}

	async function handleUpload(e: SubmitEvent) {
		e.preventDefault();
		await submitUpload();
	}

	async function submitUpload() {
		if (!file) return;

		// private media has no transcode step (audio is stored as-is as a PDS
		// blob), so reject non-web-playable formats here instead of uploading the
		// whole file and failing server-side.
		if (visibility === "private" && !isWebPlayableAudioFile(file.name)) {
			toast.error(
				"private tracks must be web-playable (mp3, wav, m4a, or flac) — convert aiff first",
			);
			return;
		}

		// pre-flight auth revalidation. the destructive XHR/SSE upload pipeline
		// surfaces an expired session as a generic "lost connection" error
		// (see uploader.svelte.ts — eventSource.onerror), which is misleading
		// at the worst possible moment. catch the auth state here, stash the
		// draft, and redirect to /login so the user can recover without losing
		// what they typed.
		const authStatus = await preflightAuth();
		if (authStatus === "expired") {
			stashTrackForm(currentFormStash());
			toast.error(
				"your session expired — sign in to continue your upload",
			);
			redirectToLogin("/upload");
			return;
		}
		if (authStatus === "unverified") {
			// couldn't reach /auth/me — session may be fine, but we can't tell.
			// don't redirect (might be a transient network blip), don't proceed
			// (the upload would fail anyway). user retries when they're back online.
			toast.error(
				"couldn't verify your session — check your connection and try again",
			);
			return;
		}

		const uploadFile = file;
		const uploadTitle = title;
		const uploadAlbum = albumTitle;
		const uploadFeatures = [...featuredArtists];
		const uploadImage = imageFile;
		const tagsToUpload = [...uploadTags];
		const uploadVisibility = visibility;
		const shouldAutoTag = autoTag;
		const uploadSelfLabels = sensitiveAudio ? ['sexual'] : [];
		const uploadDescription = description;

		const clearForm = () => {
			title = "";
			albumTitle = "";
			description = "";
			file = null;
			staged = null;
			imageFile = null;
			featuredArtists = [];
			uploadTags = [];
			attestedRights = false;
			autoTag = false;
			sensitiveAudio = false;
			visibility = 'public';
			copyrightEnabled = false;
			copyrightRights = {};

			const fileInput = document.getElementById("file-input");
			if (fileInput instanceof HTMLInputElement) fileInput.value = "";
			const imageInput = document.getElementById("image-input");
			if (imageInput instanceof HTMLInputElement) imageInput.value = "";
		};

		const copyrightToSend: TrackRights | null = copyrightEnabled
			? copyrightRights
			: null;

		// a private upload may bounce to the one-time scope-upgrade consent (when
		// the session doesn't yet hold the permissioned-space scope). stash the
		// draft first so it survives that redirect; cleared on success or on a
		// terminal error (the scope-upgrade path returns without firing onError).
		if (uploadVisibility === "private") {
			stashTrackForm(currentFormStash());
			if (!permissionedGranted) {
				if (!(await stashUploadFiles({ file: uploadFile, imageFile: uploadImage }))) {
					clearTrackFormStash();
					toast.error("couldn't save your draft — try again");
					return;
				}
				await startPermissionedScopeUpgrade();
				return;
			}
		}

		staged = uploader.stage(uploadFile);
		uploader.upload(
			staged,
			uploadTitle,
			uploadAlbum,
			uploadFeatures,
			uploadImage,
			tagsToUpload,
			uploadVisibility,
			shouldAutoTag,
			uploadDescription,
			// completion (SSE 'completed') — only NOW is it safe to wipe the form and
			// the stashed draft. clearing on enqueue (the progress callback below)
			// nuked the form even when the upload then failed in the worker (e.g. a
			// duplicate), losing everything the user typed.
			async () => {
				clearTrackFormStash();
				clearForm();
				await loadMyAlbums();
			},
			// enqueue / terminal-error callbacks: leave the form intact so a failed
			// upload (duplicate, worker error) is recoverable without re-typing.
			{},
			undefined, // label
			undefined, // albumId
			copyrightToSend,
			uploadSelfLabels,
		);
	}

	async function handleFileChange(e: Event & { currentTarget: HTMLInputElement }) {
		const target = e.currentTarget;
		if (target.files && target.files[0]) {
			const selected = target.files[0];
			if (!isSupportedAudioFile(selected.name)) {
				toast.error(
					`unsupported file type. supported: ${AUDIO_EXTENSIONS.join(", ")}`,
				);
				target.value = "";
				chooseFile(null);
				return;
			}

			try {
				const config = await getServerConfig();
				const sizeMB = selected.size / (1024 * 1024);
				if (sizeMB > config.max_upload_size_mb) {
					toast.error(
						`audio file too large (${sizeMB.toFixed(1)}MB). max: ${config.max_upload_size_mb}MB`,
					);
					target.value = "";
					chooseFile(null);
					return;
				}
			} catch (_e) {
				console.error("failed to validate file size:", _e);
			}

			chooseFile(selected);
		}
	}

	async function handleImageChange(e: Event & { currentTarget: HTMLInputElement }) {
		const target = e.currentTarget;
		if (target.files && target.files[0]) {
			const selected = target.files[0];

			try {
				const config = await getServerConfig();
				const sizeMB = selected.size / (1024 * 1024);
				if (sizeMB > config.max_image_size_mb) {
					toast.error(
						`image too large (${sizeMB.toFixed(1)}MB). max: ${config.max_image_size_mb}MB`,
					);
					target.value = "";
					imageFile = null;
					return;
				}
			} catch (_e) {
				console.error("failed to validate image size:", _e);
			}

			imageFile = selected;
		}
	}

	async function logout() {
		await auth.logout();
		window.location.href = "/";
	}
</script>

<svelte:head>
	<title>upload {mode === 'album' ? 'album' : 'track'} • plyr</title>
</svelte:head>

{#if loading}
	<div class="loading">
		<WaveLoading size="lg" message="loading..." />
	</div>
{:else}
	<Header
		user={auth.user}
		isAuthenticated={auth.isAuthenticated}
		onLogout={logout}
	/>
	<main>
		<div class="section-header">
			<h2>upload {mode === 'album' ? 'album' : 'track'}</h2>
		</div>

		<div class="mode-toggle">
			<button
				type="button"
				class="mode-btn"
				class:active={mode === 'track'}
				onclick={() => setMode('track')}
			>track</button>
			<button
				type="button"
				class="mode-btn"
				class:active={mode === 'album'}
				onclick={() => setMode('album')}
			>album</button>
		</div>

		{#if mode === 'track'}
		<form onsubmit={handleUpload}>
			<div class="form-group">
				<label for="title">track title</label>
				<input
					id="title"
					type="text"
					bind:value={title}
					required
					maxlength="256"
					placeholder="my awesome song"
				/>
			</div>

			<div class="form-group">
				<label for="file-input" class="label-with-tooltip">
					audio file
					<PdsTooltip />
				</label>
				<input
					id="file-input"
					type="file"
					accept={FILE_INPUT_ACCEPT}
					onchange={handleFileChange}
					required
				/>
				<p class="format-hint">
					supported: {AUDIO_EXTENSIONS.map(e => e.slice(1)).join(", ")}
				</p>
				{#if file}
					<div class="file-preview">
						<AudioPreview source={file} transfer={staged} />
					</div>
				{/if}
			</div>

			<div class="form-group">
				<label for="description">description (optional)</label>
				<textarea
					id="description"
					bind:value={description}
					placeholder="liner notes, show notes, credits..."
					rows="3"
					maxlength="5000"
				></textarea>
				{#if description.length > 0}
					<div class="char-count">{description.length} / 5000</div>
				{/if}
			</div>

			<div class="form-group">
				<label for="album">album (optional)</label>
				<AlbumSelect {albums} bind:value={albumTitle} />
			</div>

			<div class="form-group">
				<label for="features">featured artists (optional)</label>
				<HandleSearch
					bind:selected={featuredArtists}
					bind:hasUnresolvedInput={hasUnresolvedFeaturesInput}
					onAdd={(artist) => {
						featuredArtists = [...featuredArtists, artist];
					}}
					onRemove={(did) => {
						featuredArtists = featuredArtists.filter(
							(a) => a.did !== did,
						);
					}}
				/>
			</div>

			<div class="form-group">
				<label for="upload-tags">tags (optional)</label>
				<TagInput
					tags={uploadTags}
					onAdd={(tag) => {
						uploadTags = [...uploadTags, tag];
					}}
					onRemove={(tag) => {
						uploadTags = uploadTags.filter((t) => t !== tag);
					}}
					placeholder="type to search tags..."
				/>
				<label class="checkbox-label" style="margin-top: 0.75rem;">
					<input type="checkbox" bind:checked={autoTag} />
					<span class="checkbox-text">auto-tag with recommended genres</span>
					<InfoTooltip label="auto-tagging info">
						ML genre classification suggests tags from your audio.
						<a href="https://docs.plyr.fm/artists/#auto-tagging" target="_blank" rel="noopener">learn more</a>
					</InfoTooltip>
				</label>
			</div>

			<div class="form-group">
				<label for="image-input">artwork (optional)</label>
				<input
					id="image-input"
					type="file"
					accept="image/*"
					onchange={handleImageChange}
				/>
				<p class="format-hint">supported: jpg, png, webp, gif</p>
				{#if imageFile}
					<p class="file-info">
						{imageFile.name} ({(
							imageFile.size /
							1024 /
							1024
						).toFixed(2)} MB)
					</p>
				{/if}
			</div>

			<CopyrightRightsPanel
				bind:enabled={copyrightEnabled}
				bind:rights={copyrightRights}
				disabled={visibility !== 'public' && visibility !== 'unlisted'}
			/>

			<fieldset class="form-group content-notice-card">
				<legend>content notice</legend>
				<label class="content-notice-row checkbox-label">
					<input type="checkbox" bind:checked={sensitiveAudio} />
					<span class="access-body">
						<span class="checkbox-text">contains sexually explicit audio</span>
						<span class="access-note">hidden by default; listeners must sign in and choose to hear sensitive audio. the notice travels with this track on ATProto.</span>
					</span>
				</label>
			</fieldset>

			<VisibilityPicker
				bind:visibility
				supportUrl={artistProfile?.support_url}
				showPrivate={permissionedSupported}
				restrictedToPublic={copyrightEnabled}
				privateGranted={permissionedGranted}
			/>

			<div class="form-group attestation">
				<label class="checkbox-label">
					<input
						type="checkbox"
						bind:checked={attestedRights}
						required
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
						href={profileLink('zzstoatzz.io')}
						target="_blank"
						rel="noopener">@zzstoatzz.io</a
					> :) have a nice day!
				</p>
			</div>

			<button
				type="submit"
				disabled={!file ||
					hasUnresolvedFeaturesInput ||
					!attestedRights}
				class="upload-btn"
				title={hasUnresolvedFeaturesInput
					? "please select or clear featured artist"
					: !attestedRights
						? "please confirm you have distribution rights"
						: ""}
			>
				<span
					>{visibility === "private" && !permissionedGranted
						? "approve private media"
						: "upload track"}</span
				>
			</button>

		</form>
		{:else}
		<AlbumUploadForm
			{albums}
			{artistProfile}
			onAlbumsReload={loadMyAlbums}
		/>
		{/if}
	</main>
{/if}

<style>
	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		color: var(--text-tertiary);
		gap: 1rem;
	}

	main {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 1rem
			calc(
				var(--player-height, 120px) + 2rem +
					env(safe-area-inset-bottom, 0px)
			);
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.section-header h2 {
		font-size: var(--text-page-heading);
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}

	.mode-toggle {
		display: flex;
		gap: 0;
		margin-bottom: 1.5rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
		padding: 0.25rem;
		width: fit-content;
	}

	.mode-btn {
		width: auto;
		padding: 0.5rem 1.25rem;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--text-tertiary);
		font-size: var(--text-base);
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
	}

	.mode-btn:hover {
		transform: none;
		box-shadow: none;
	}

	.mode-btn:hover:not(.active) {
		color: var(--text-secondary);
		background: transparent;
	}

	.mode-btn.active {
		background: var(--accent);
		color: var(--text-primary);
	}

	.mode-btn.active:hover {
		background: var(--accent);
	}

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

	input[type="text"] {
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

	input[type="text"]:focus {
		outline: none;
		border-color: var(--accent);
	}

	textarea {
		width: 100%;
		padding: 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: var(--text-base);
		font-family: inherit;
		transition: all 0.2s;
		resize: vertical;
		min-height: 4rem;
	}

	textarea:focus {
		outline: none;
		border-color: var(--accent);
	}

	input[type="file"] {
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

	.label-with-tooltip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	.format-hint {
		margin-top: 0.25rem;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	.char-count {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		text-align: right;
	}

	.file-info {
		margin-top: 0.5rem;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	.file-preview {
		margin-top: 0.75rem;
	}

	button {
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
	}

	button:hover:not(:disabled) {
		background: var(--accent-hover);
		transform: translateY(-1px);
		box-shadow: 0 4px 12px
			color-mix(in srgb, var(--accent) 30%, transparent);
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	button:active:not(:disabled) {
		transform: translateY(0);
	}

	.upload-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
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

	.checkbox-label input[type="checkbox"] {
		width: 1.25rem;
		height: 1.25rem;
		margin-top: 0.1rem;
		flex-shrink: 0;
		accent-color: var(--accent);
		cursor: pointer;
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

	/* grouped "visibility & access" card: one bordered container, the toggles
	   stacked as rows with subtle dividers and a persistent note under each */

	.content-notice-card {
		padding: 0;
		border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border-default));
		border-radius: var(--radius-sm);
		min-width: 0;
	}

	.content-notice-card legend {
		margin-left: 0.75rem;
		padding: 0 0.4rem;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.content-notice-row {
		padding: 0.875rem 1rem;
		margin: 0;
	}





	.access-body {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}



	.access-note {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		line-height: 1.4;
	}



	@media (max-width: 768px) {
		main {
			padding: 0 0.75rem
				calc(
					var(--player-height, 120px) + 1.5rem +
						env(safe-area-inset-bottom, 0px)
				);
		}

		form {
			padding: 1.25rem;
		}

		.section-header h2 {
			font-size: var(--text-2xl);
		}
	}
</style>
