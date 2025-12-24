<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import Header from "$lib/components/Header.svelte";
	import HandleSearch from "$lib/components/HandleSearch.svelte";
	import AlbumSelect from "$lib/components/AlbumSelect.svelte";
	import WaveLoading from "$lib/components/WaveLoading.svelte";
	import TagInput from "$lib/components/TagInput.svelte";
	import type { FeaturedArtist, AlbumSummary, Artist } from "$lib/types";
	import { API_URL, getServerConfig } from "$lib/config";
	import { uploader } from "$lib/uploader.svelte";
	import { toast } from "$lib/toast.svelte";
	import { auth } from "$lib/auth.svelte";

	// browser-compatible audio formats only
	const ACCEPTED_AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a"];
	const ACCEPTED_AUDIO_MIME_TYPES = ["audio/mpeg", "audio/wav", "audio/mp4"];
	const FILE_INPUT_ACCEPT = [
		...ACCEPTED_AUDIO_EXTENSIONS,
		...ACCEPTED_AUDIO_MIME_TYPES,
	].join(",");

	function isSupportedAudioFile(name: string): boolean {
		const dotIndex = name.lastIndexOf(".");
		if (dotIndex === -1) return false;
		const ext = name.slice(dotIndex).toLowerCase();
		return ACCEPTED_AUDIO_EXTENSIONS.includes(ext);
	}

	let loading = $state(true);

	// upload form fields
	let title = $state("");
	let albumTitle = $state("");
	let file = $state<File | null>(null);
	let imageFile = $state<File | null>(null);
	let featuredArtists = $state<FeaturedArtist[]>([]);
	let uploadTags = $state<string[]>([]);
	let hasUnresolvedFeaturesInput = $state(false);
	let attestedRights = $state(false);
	let supportGated = $state(false);

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
			goto("/login");
			return;
		}

		await Promise.all([loadMyAlbums(), loadArtistProfile()]);
		loading = false;
	});

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

	function handleUpload(e: SubmitEvent) {
		e.preventDefault();
		if (!file) return;

		const uploadFile = file;
		const uploadTitle = title;
		const uploadAlbum = albumTitle;
		const uploadFeatures = [...featuredArtists];
		const uploadImage = imageFile;
		const tagsToUpload = [...uploadTags];
		const isGated = supportGated;

		const clearForm = () => {
			title = "";
			albumTitle = "";
			file = null;
			imageFile = null;
			featuredArtists = [];
			uploadTags = [];
			attestedRights = false;
			supportGated = false;

			const fileInput = document.getElementById(
				"file-input",
			) as HTMLInputElement;
			if (fileInput) fileInput.value = "";
			const imageInput = document.getElementById(
				"image-input",
			) as HTMLInputElement;
			if (imageInput) imageInput.value = "";
		};

		uploader.upload(
			uploadFile,
			uploadTitle,
			uploadAlbum,
			uploadFeatures,
			uploadImage,
			tagsToUpload,
			isGated,
			async () => {
				await loadMyAlbums();
			},
			{
				onSuccess: () => {
					clearForm();
				},
				onError: () => {},
			},
		);
	}

	async function handleFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			const selected = target.files[0];
			if (!isSupportedAudioFile(selected.name)) {
				toast.error(
					`unsupported file type. supported: ${ACCEPTED_AUDIO_EXTENSIONS.join(", ")}`,
				);
				target.value = "";
				file = null;
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
					file = null;
					return;
				}
			} catch (_e) {
				console.error("failed to validate file size:", _e);
			}

			file = selected;
		}
	}

	async function handleImageChange(e: Event) {
		const target = e.target as HTMLInputElement;
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
	<title>upload track • plyr</title>
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
			<h2>upload track</h2>
		</div>

		<form onsubmit={handleUpload}>
			<div class="form-group">
				<label for="title">track title</label>
				<input
					id="title"
					type="text"
					bind:value={title}
					required
					placeholder="my awesome song"
				/>
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
			</div>

			<div class="form-group">
				<label for="file-input">audio file</label>
				<input
					id="file-input"
					type="file"
					accept={FILE_INPUT_ACCEPT}
					onchange={handleFileChange}
					required
				/>
				<p class="format-hint">supported: mp3, wav, m4a</p>
				{#if file}
					<p class="file-info">
						{file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
					</p>
				{/if}
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

			<div class="form-group supporter-gating">
				{#if artistProfile?.support_url}
					<label class="checkbox-label">
						<input
							type="checkbox"
							bind:checked={supportGated}
						/>
						<span class="checkbox-text">
							<svg class="heart-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
								<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
							</svg>
							supporters only
						</span>
					</label>
					<p class="gating-note">
						only users who support you via <a href={artistProfile.support_url} target="_blank" rel="noopener">atprotofans</a> can play this track
					</p>
				{:else}
					<div class="gating-disabled">
						<span class="gating-disabled-icon">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
							</svg>
						</span>
						<span class="gating-disabled-text">
							want to gate tracks for supporters? <a href="https://atprotofans.com" target="_blank" rel="noopener">set up atprotofans</a>, then enable it in your <a href="/portal">portal</a>
						</span>
					</div>
				{/if}
			</div>

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
						href="https://bsky.app/profile/zzstoatzz.io"
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
				<span>upload track</span>
			</button>

		</form>
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

	form {
		background: var(--bg-tertiary);
		padding: 2rem;
		border-radius: 8px;
		border: 1px solid var(--border-subtle);
	}

	.form-group {
		margin-bottom: 1.5rem;
	}

	label {
		display: block;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
		font-size: 0.9rem;
	}

	input[type="text"] {
		width: 100%;
		padding: 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-primary);
		font-size: 1rem;
		font-family: inherit;
		transition: all 0.2s;
	}

	input[type="text"]:focus {
		outline: none;
		border-color: var(--accent);
	}

	input[type="file"] {
		width: 100%;
		padding: 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-primary);
		font-size: 0.9rem;
		font-family: inherit;
		cursor: pointer;
	}

	.format-hint {
		margin-top: 0.25rem;
		font-size: 0.8rem;
		color: var(--text-tertiary);
	}

	.file-info {
		margin-top: 0.5rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	button {
		width: 100%;
		padding: 0.75rem;
		background: var(--accent);
		color: var(--text-primary);
		border: none;
		border-radius: 4px;
		font-size: 1rem;
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
		border-radius: 4px;
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
		font-size: 0.95rem;
		color: var(--text-primary);
		line-height: 1.4;
	}

	.attestation-note {
		margin-top: 0.75rem;
		margin-left: 2rem;
		font-size: 0.8rem;
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

	.supporter-gating {
		background: color-mix(in srgb, var(--accent) 8%, var(--bg-primary));
		padding: 1rem;
		border-radius: 4px;
		border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border-default));
	}

	.supporter-gating .checkbox-text {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	.supporter-gating .heart-icon {
		color: var(--accent);
	}

	.gating-note {
		margin-top: 0.5rem;
		margin-left: 2rem;
		font-size: 0.8rem;
		color: var(--text-tertiary);
		line-height: 1.4;
	}

	.gating-note a {
		color: var(--accent);
		text-decoration: none;
	}

	.gating-note a:hover {
		text-decoration: underline;
	}

	.gating-disabled {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		color: var(--text-muted);
	}

	.gating-disabled-icon {
		flex-shrink: 0;
		margin-top: 0.1rem;
	}

	.gating-disabled-text {
		font-size: 0.85rem;
		line-height: 1.4;
	}

	.gating-disabled-text a {
		color: var(--accent);
		text-decoration: none;
	}

	.gating-disabled-text a:hover {
		text-decoration: underline;
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
			font-size: 1.25rem;
		}
	}
</style>
