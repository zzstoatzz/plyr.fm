<script lang="ts">
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';
	import HandleSearch from '$lib/components/HandleSearch.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import MigrationBanner from '$lib/components/MigrationBanner.svelte';
	import BrokenTracks from '$lib/components/BrokenTracks.svelte';
	import type { Track, FeaturedArtist } from '$lib/types';
	import { API_URL, getServerConfig } from '$lib/config';
	import { uploader } from '$lib/uploader.svelte';
	import { toast } from '$lib/toast.svelte';
	import { auth } from '$lib/auth.svelte';

	// browser-compatible audio formats only
	// note: aiff/aif not supported in most browsers (safari only)
	const ACCEPTED_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a'];
	const ACCEPTED_AUDIO_MIME_TYPES = ['audio/mpeg', 'audio/wav', 'audio/mp4'];
	const FILE_INPUT_ACCEPT = [...ACCEPTED_AUDIO_EXTENSIONS, ...ACCEPTED_AUDIO_MIME_TYPES].join(',');

	function isSupportedAudioFile(name: string): boolean {
		const dotIndex = name.lastIndexOf('.');
		if (dotIndex === -1) return false;
		const ext = name.slice(dotIndex).toLowerCase();
		return ACCEPTED_AUDIO_EXTENSIONS.includes(ext);
	}

	let loading = true;
	let error = '';
	let tracks: Track[] = [];
	let loadingTracks = false;

	// upload form fields
	let title = '';
	let albumId: string | null = null;
	let albumTitle = '';
	let file: File | null = null;
	let imageFile: File | null = null;
	let featuredArtists: FeaturedArtist[] = [];

	// track editing state
	let editingTrackId: number | null = null;
	let editTitle = '';
	let editAlbum = '';
	let editFeaturedArtists: FeaturedArtist[] = [];
	let editImageFile: File | null = null;

	// profile editing state
	let displayName = '';
	let bio = '';
	let avatarUrl = '';
	let savingProfile = false;
	let profileSuccess = '';
	let profileError = '';

	onMount(async () => {
		// check if exchange_token is in URL (from OAuth callback)
		const params = new URLSearchParams(window.location.search);
		const exchangeToken = params.get('exchange_token');

		if (exchangeToken) {
			// exchange token for session_id
			try {
				const exchangeResponse = await fetch(`${API_URL}/auth/exchange`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ exchange_token: exchangeToken })
				});

				if (exchangeResponse.ok) {
					const data = await exchangeResponse.json();
					auth.setSessionId(data.session_id);
					await auth.initialize();
				}
			} catch (e) {
				console.error('failed to exchange token:', e);
			}

			// remove exchange_token from URL
			replaceState('/portal', {});
		}

		if (!auth.isAuthenticated) {
			window.location.href = '/login';
			return;
		}

		try {
			await loadMyTracks();
			await loadArtistProfile();
		} catch (e) {
			console.error('error loading portal data:', e);
			error = 'failed to load portal data';
		} finally {
			loading = false;
		}
	});

	async function loadMyTracks() {
		loadingTracks = true;
		try {
			const response = await fetch(`${API_URL}/tracks/me`, {
				headers: auth.getAuthHeaders()
			});
			if (response.ok) {
				const data = await response.json();
				tracks = data.tracks;
			}
		} catch (e) {
			console.error('failed to load tracks:', e);
		} finally {
			loadingTracks = false;
		}
	}

	async function loadArtistProfile() {
		try {
			const response = await fetch(`${API_URL}/artists/me`, {
				headers: auth.getAuthHeaders()
			});
			if (response.ok) {
				const artist = await response.json();
				displayName = artist.display_name;
				bio = artist.bio || '';
				avatarUrl = artist.avatar_url || '';
			}
		} catch (e) {
			console.error('failed to load artist profile:', e);
		}
	}

	async function saveProfile(e: SubmitEvent) {
		e.preventDefault();
		savingProfile = true;
		profileError = '';
		profileSuccess = '';

		try {
			const response = await fetch(`${API_URL}/artists/me`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					...auth.getAuthHeaders()
				},
				body: JSON.stringify({
					display_name: displayName,
					bio: bio || null,
					avatar_url: avatarUrl || null
				})
			});

			if (response.ok) {
				profileSuccess = 'profile updated successfully!';
				setTimeout(() => { profileSuccess = ''; }, 3000);
			} else {
				const errorData = await response.json();
				profileError = errorData.detail || 'failed to update profile';
			}
		} catch (e) {
			profileError = `network error: ${e instanceof Error ? e.message : 'unknown error'}`;
		} finally {
			savingProfile = false;
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

		const clearForm = () => {
			title = '';
			albumTitle = '';
			file = null;
			imageFile = null;
			featuredArtists = [];

			const fileInput = document.getElementById('file-input') as HTMLInputElement;
			if (fileInput) {
				fileInput.value = '';
			}
			const imageInput = document.getElementById('image-input') as HTMLInputElement;
			if (imageInput) {
				imageInput.value = '';
			}
		};

		uploader.upload(
			uploadFile,
			uploadTitle,
			uploadAlbum,
			uploadFeatures,
			uploadImage,
			() => {
				loadMyTracks();
			},
			{
				onSuccess: () => {
					clearForm();
				},
				onError: () => {
				}
			}
		);
	}

	async function deleteTrack(trackId: number, trackTitle: string) {
		if (!confirm(`delete "${trackTitle}"?`)) return;

		try {
			const response = await fetch(`${API_URL}/tracks/${trackId}`, {
				method: 'DELETE',
				headers: auth.getAuthHeaders()
			});

			if (response.ok) {
				await loadMyTracks();
			} else {
				const error = await response.json();
				alert(error.detail || 'failed to delete track');
			}
		} catch (e) {
			alert(`network error: ${e instanceof Error ? e.message : 'unknown error'}`);
		}
	}

	function startEditTrack(track: typeof tracks[0]) {
		editingTrackId = track.id;
		editTitle = track.title;
		editAlbum = track.album?.title || '';
		editFeaturedArtists = track.features || [];
	}

	function cancelEdit() {
		editingTrackId = null;
		editTitle = '';
		editAlbum = '';
		editFeaturedArtists = [];
		editImageFile = null;
	}

	async function saveTrackEdit(trackId: number) {
		const formData = new FormData();
		formData.append('title', editTitle);
		formData.append('album', editAlbum);
		if (editFeaturedArtists.length > 0) {
			const handles = editFeaturedArtists.map(a => a.handle);
			formData.append('features', JSON.stringify(handles));
		} else {
			// send empty array to clear features
			formData.append('features', JSON.stringify([]));
		}
		if (editImageFile) {
			formData.append('image', editImageFile);
		}

		try {
			const response = await fetch(`${API_URL}/tracks/${trackId}`, {
				method: 'PATCH',
				body: formData,
				headers: auth.getAuthHeaders()
			});

			if (response.ok) {
				await loadMyTracks();
				cancelEdit();
				toast.success('track updated successfully');
			} else {
				const error = await response.json();
				toast.error(error.detail || 'failed to update track');
			}
		} catch (e) {
			alert(`network error: ${e instanceof Error ? e.message : 'unknown error'}`);
		}
	}

	async function handleFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			const selected = target.files[0];
			if (!isSupportedAudioFile(selected.name)) {
				toast.error(`unsupported file type. supported: ${ACCEPTED_AUDIO_EXTENSIONS.join(', ')}`);
				target.value = '';
				file = null;
				return;
			}

			// validate file size
			try {
				const config = await getServerConfig();
				const sizeMB = selected.size / (1024 * 1024);
				if (sizeMB > config.max_upload_size_mb) {
					toast.error(
						`audio file too large (${sizeMB.toFixed(1)}MB). max: ${config.max_upload_size_mb}MB`
					);
					target.value = '';
					file = null;
					return;
				}
			} catch (e) {
				console.error('failed to validate file size:', e);
				// continue anyway - server will validate
			}

			file = selected;
		}
	}

	async function handleImageChange(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			const selected = target.files[0];

			// validate image size
			try {
				const config = await getServerConfig();
				const sizeMB = selected.size / (1024 * 1024);
				if (sizeMB > config.max_image_size_mb) {
					toast.error(
						`image too large (${sizeMB.toFixed(1)}MB). max: ${config.max_image_size_mb}MB`
					);
					target.value = '';
					imageFile = null;
					return;
				}
			} catch (e) {
				console.error('failed to validate image size:', e);
				// continue anyway - server will validate
			}

			imageFile = selected;
		}
	}

	async function logout() {
		await auth.logout();
		window.location.href = '/';
	}
</script>

{#if loading}
	<div class="loading">loading...</div>
{:else if error}
	<div class="error-container">
		<h1>{error}</h1>
		<a href="/">go home</a>
	</div>
{:else if auth.user}
	<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={logout} />
	<main>
		<MigrationBanner />
		<BrokenTracks />

		<div class="portal-header">
			<h2>artist portal</h2>
		</div>

		<section class="profile-section">
			<div class="section-header">
				<h2>profile settings</h2>
				<a href="/u/{auth.user.handle}" class="view-profile-link">view public profile</a>
			</div>

			{#if profileSuccess}
				<div class="message success">{profileSuccess}</div>
			{/if}

			{#if profileError}
				<div class="message error">{profileError}</div>
			{/if}

			<form onsubmit={saveProfile}>
				<div class="form-group">
					<label for="display-name">artist name *</label>
					<input
						id="display-name"
						type="text"
						bind:value={displayName}
						required
						disabled={savingProfile}
						placeholder="your artist name"
					/>
					<p class="hint">this is shown on all your tracks</p>
				</div>

				<div class="form-group">
					<label for="bio">bio (optional)</label>
					<textarea
						id="bio"
						bind:value={bio}
						disabled={savingProfile}
						placeholder="tell us about your music..."
						rows="4"
					></textarea>
				</div>

				<div class="form-group">
					<label for="avatar">avatar url (optional)</label>
					<input
						id="avatar"
						type="url"
						bind:value={avatarUrl}
						disabled={savingProfile}
						placeholder="https://example.com/avatar.jpg"
					/>
					{#if avatarUrl}
						<div class="avatar-preview">
							<img src={avatarUrl} alt="avatar preview" />
						</div>
					{/if}
				</div>

				<button type="submit" disabled={savingProfile || !displayName}>
					{savingProfile ? 'saving...' : 'save profile'}
				</button>
			</form>
		</section>

		<section class="upload-section">
			<h2>upload track</h2>

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
					<input
						id="album"
						type="text"
						bind:value={albumTitle}
						placeholder="album name"
					/>
				</div>

				<div class="form-group">
					<label for="features">featured artists (optional)</label>
					<HandleSearch
						bind:selected={featuredArtists}
						onAdd={(artist) => { featuredArtists = [...featuredArtists, artist]; }}
						onRemove={(did) => { featuredArtists = featuredArtists.filter(a => a.did !== did); }}
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
						<p class="file-info">{file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)</p>
					{/if}
				</div>

				<div class="form-group">
					<label for="image-input">artwork (optional)</label>
					<input
						id="image-input"
						type="file"
						accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif"
						onchange={handleImageChange}
					/>
					<p class="format-hint">supported: jpg, png, webp, gif</p>
					{#if imageFile}
						<p class="file-info">{imageFile.name} ({(imageFile.size / 1024 / 1024).toFixed(2)} MB)</p>
					{/if}
				</div>

				<button type="submit" disabled={!file} class="upload-btn">
					<span>upload track</span>
				</button>
			</form>
		</section>

		<section class="tracks-section">
			<h2>your tracks</h2>

			{#if loadingTracks}
				<div class="loading-container">
					<LoadingSpinner size="lg" />
					<p class="loading-text">loading tracks...</p>
				</div>
			{:else if tracks.length === 0}
				<p class="empty">no tracks uploaded yet</p>
			{:else}
				<div class="tracks-list">
					{#each tracks as track}
						<div class="track-item" class:editing={editingTrackId === track.id}>
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
											/>
										</div>
										<div class="edit-field-group">
											<label for="edit-album" class="edit-label">album (optional)</label>
											<input id="edit-album"
												type="text"
												bind:value={editAlbum}
												placeholder="album (optional)"
												class="edit-input"
											/>
										</div>
										<div class="edit-field-group">
											<div class="edit-label">featured artists (optional)</div>
											<HandleSearch
												bind:selected={editFeaturedArtists}
												onAdd={(artist) => { editFeaturedArtists = [...editFeaturedArtists, artist]; }}
												onRemove={(did) => { editFeaturedArtists = editFeaturedArtists.filter(a => a.did !== did); }}
											/>
										</div>
										<div class="edit-field-group">
											<label for="edit-image" class="edit-label">artwork (optional)</label>
											{#if track.image_url && !editImageFile}
												<div class="current-image-preview">
													<img src={track.image_url} alt="current artwork" />
													<span class="current-image-label">current artwork</span>
												</div>
											{/if}
											<input
												id="edit-image"
												type="file"
												accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif"
												onchange={(e) => {
													const target = e.target as HTMLInputElement;
													editImageFile = target.files?.[0] ?? null;
												}}
												class="edit-input"
											/>
											{#if editImageFile}
												<p class="file-info">{editImageFile.name} (will replace current)</p>
											{/if}
										</div>
									</div>
									<div class="edit-actions">
										<button
											class="action-btn save-btn"
											onclick={() => saveTrackEdit(track.id)}
											title="save changes"
										>
											✓
										</button>
										<button
											class="action-btn cancel-btn"
											onclick={cancelEdit}
											title="cancel"
										>
											✕
										</button>
									</div>
								</div>
							{:else}
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
								<div class="track-info">
									<div class="track-title">{track.title}</div>
									<div class="track-meta">
										{track.artist}
										{#if track.features && track.features.length > 0}
											<span class="features">feat. {track.features.map(f => f.display_name).join(', ')}</span>
										{/if}
										{#if track.album}
											<span class="separator">•</span>
											<span class="album">{track.album}</span>
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
										class="action-btn edit-btn"
										onclick={() => startEditTrack(track)}
										title="edit track"
									>
										✎
									</button>
									<button
										class="action-btn delete-btn"
										onclick={() => deleteTrack(track.id, track.title)}
										title="delete track"
									>
										×
									</button>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>
	</main>
{/if}

<style>
	.loading,
	.error-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		color: #888;
		gap: 1rem;
	}

	.error-container a {
		color: var(--accent);
		text-decoration: none;
	}

	.error-container a:hover {
		text-decoration: underline;
	}

	main {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 1rem calc(var(--player-height, 120px) + 2rem + env(safe-area-inset-bottom, 0px));
	}

	.portal-header {
		margin-bottom: 2rem;
	}

	.portal-header h2 {
		font-size: var(--text-page-heading);
		margin: 0;
	}

	.profile-section,
	.upload-section {
		margin-bottom: 3rem;
	}

	.profile-section h2,
	.upload-section h2 {
		font-size: var(--text-page-heading);
		margin-bottom: 1.5rem;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	.section-header h2 {
		margin-bottom: 0;
	}

	.view-profile-link {
		color: var(--text-secondary);
		text-decoration: none;
		font-size: 0.9rem;
		padding: 0.4rem 0.75rem;
		background: #1a1a1a;
		border-radius: 6px;
		border: 1px solid #333;
		transition: all 0.2s;
		white-space: nowrap;
	}

	.view-profile-link:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: #222;
	}

	form {
		background: #1a1a1a;
		padding: 2rem;
		border-radius: 8px;
		border: 1px solid #2a2a2a;
	}

	.form-group {
		margin-bottom: 1.5rem;
	}

	label {
		display: block;
		color: #aaa;
		margin-bottom: 0.5rem;
		font-size: 0.9rem;
	}

	input[type='text'] {
		width: 100%;
		padding: 0.75rem;
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 4px;
		color: white;
		font-size: 1rem;
		transition: all 0.2s;
	}

	input[type='text']:focus {
		outline: none;
		border-color: #3a7dff;
	}

	input[type='text']:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	textarea {
		width: 100%;
		padding: 0.75rem;
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 4px;
		color: white;
		font-size: 1rem;
		font-family: inherit;
		transition: all 0.2s;
		resize: vertical;
		min-height: 100px;
	}

	textarea:focus {
		outline: none;
		border-color: #3a7dff;
	}

	textarea:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.hint {
		margin-top: 0.5rem;
		font-size: 0.85rem;
		color: #666;
	}

	.message {
		padding: 1rem;
		border-radius: 4px;
		margin-bottom: 1.5rem;
	}

	.message.success {
		background: rgba(46, 160, 67, 0.1);
		border: 1px solid rgba(46, 160, 67, 0.3);
		color: #5ce87b;
	}

	.message.error {
		background: rgba(233, 69, 96, 0.1);
		border: 1px solid rgba(233, 69, 96, 0.3);
		color: #ff6b6b;
	}

	.avatar-preview {
		margin-top: 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.avatar-preview img {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid #333;
	}

	input[type='file'] {
		width: 100%;
		padding: 0.75rem;
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 4px;
		color: white;
		font-size: 0.9rem;
		cursor: pointer;
	}

	input[type='file']:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.format-hint {
		margin-top: 0.25rem;
		font-size: 0.8rem;
		color: #888;
	}

	.file-info {
		margin-top: 0.5rem;
		font-size: 0.85rem;
		color: #666;
	}

	button {
		width: 100%;
		padding: 0.75rem;
		background: #3a7dff;
		color: white;
		border: none;
		border-radius: 4px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	button:hover:not(:disabled) {
		background: #2868e6;
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(58, 125, 255, 0.3);
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	button:active:not(:disabled) {
		transform: translateY(0);
	}

	.tracks-section {
		margin-top: 3rem;
	}

	.tracks-section h2 {
		font-size: var(--text-page-heading);
		margin-bottom: 1.5rem;
	}

	.empty {
		color: #666;
		padding: 2rem;
		text-align: center;
		background: #1a1a1a;
		border-radius: 8px;
		border: 1px solid #2a2a2a;
	}

	.tracks-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.track-item {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 6px;
		padding: 1rem;
		transition: all 0.2s;
	}

	.track-item.editing {
		flex-direction: column;
		align-items: stretch;
	}

	.track-artwork {
		flex-shrink: 0;
		width: 48px;
		height: 48px;
		border-radius: 4px;
		overflow: hidden;
		background: #0f0f0f;
		border: 1px solid #282828;
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
		color: #555;
	}

	.track-item:hover {
		background: #222;
		border-color: #333;
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
		gap: 0.75rem;
		flex: 1;
	}

	.edit-field-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.edit-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.edit-label {
		font-size: 0.85rem;
		color: #aaa;
	}

	.track-title {
		font-weight: 600;
		font-size: 1rem;
		margin-bottom: 0.25rem;
		color: #fff;
	}

	.track-meta {
		font-size: 0.9rem;
		color: #aaa;
		margin-bottom: 0.25rem;
	}

	.separator {
		margin: 0 0.5rem;
		color: #666;
	}

	.album {
		color: #888;
	}

	.features {
		color: #8ab3ff;
		font-weight: 500;
		margin-left: 0.5rem;
	}

	.track-date {
		font-size: 0.85rem;
		color: #666;
	}

	.track-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
		margin-left: 0.75rem;
		align-self: flex-start;
	}

	.action-btn {
		width: 36px;
		height: 36px;
		padding: 0;
		background: transparent;
		border: 1px solid #444;
		border-radius: 4px;
		color: #888;
		font-size: 1.2rem;
		line-height: 1;
		cursor: pointer;
		transition: all 0.2s;
	}

	.edit-btn:hover {
		background: rgba(106, 159, 255, 0.1);
		border-color: rgba(106, 159, 255, 0.5);
		color: var(--accent);
		transform: none;
		box-shadow: none;
	}

	.delete-btn {
		font-size: 1.5rem;
	}

	.delete-btn:hover {
		background: rgba(233, 69, 96, 0.1);
		border-color: rgba(233, 69, 96, 0.5);
		color: #ff6b6b;
		transform: none;
		box-shadow: none;
	}

	.save-btn:hover {
		background: rgba(46, 160, 67, 0.1);
		border-color: rgba(46, 160, 67, 0.5);
		color: #5ce87b;
		transform: none;
		box-shadow: none;
	}

	.cancel-btn:hover {
		background: rgba(136, 136, 136, 0.1);
		border-color: rgba(136, 136, 136, 0.5);
		color: #aaa;
		transform: none;
		box-shadow: none;
	}

	.edit-input {
		width: 100%;
		padding: 0.5rem;
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 4px;
		color: white;
		font-size: 0.9rem;
	}

	.current-image-preview {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem;
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 4px;
		margin-bottom: 0.5rem;
	}

	.current-image-preview img {
		width: 48px;
		height: 48px;
		border-radius: 4px;
		object-fit: cover;
	}

	.current-image-label {
		color: #888;
		font-size: 0.85rem;
	}

	.edit-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.upload-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
	}

	.loading-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		padding: 3rem 1rem;
	}

	.loading-text {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.9rem;
	}
</style>
