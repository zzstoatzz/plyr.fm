<script lang="ts">
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';
	import HandleSearch from '$lib/components/HandleSearch.svelte';
	import AlbumSelect from '$lib/components/AlbumSelect.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import MigrationBanner from '$lib/components/MigrationBanner.svelte';
	import BrokenTracks from '$lib/components/BrokenTracks.svelte';
	import type { Track, FeaturedArtist, AlbumSummary } from '$lib/types';
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

	let loading = $state(true);
	let error = $state('');
	let tracks = $state<Track[]>([]);
	let loadingTracks = $state(false);

	// upload form fields
	let title = $state('');
	let albumTitle = $state('');
	let file = $state<File | null>(null);
	let imageFile = $state<File | null>(null);
	let featuredArtists = $state<FeaturedArtist[]>([]);
	let hasUnresolvedFeaturesInput = $state(false);

	// track editing state
	let editingTrackId = $state<number | null>(null);
	let editTitle = $state('');
	let editAlbum = $state('');
	let editFeaturedArtists = $state<FeaturedArtist[]>([]);
	let editImageFile = $state<File | null>(null);
	let hasUnresolvedEditFeaturesInput = $state(false);

	// profile editing state
	let displayName = $state('');
	let bio = $state('');
	let avatarUrl = $state('');
	let savingProfile = $state(false);
	let profileSuccess = $state('');
	let profileError = $state('');

	// album management state
	let albums = $state<AlbumSummary[]>([]);
	let loadingAlbums = $state(false);
	let editingAlbumId = $state<string | null>(null);
	let editAlbumCoverFile = $state<File | null>(null);

	// export state
	let exportingMedia = $state(false);

	onMount(async () => {
		// check if exchange_token is in URL (from OAuth callback)
		const params = new URLSearchParams(window.location.search);
		const exchangeToken = params.get('exchange_token');

		if (exchangeToken) {
			// exchange token for session_id (cookie is set automatically by backend)
			try {
				const exchangeResponse = await fetch(`${API_URL}/auth/exchange`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({ exchange_token: exchangeToken })
				});

				if (exchangeResponse.ok) {
					await auth.initialize();
				}
			} catch (_e) {
				console.error('failed to exchange token:', _e);
			}

			// remove exchange_token from URL
			replaceState('/portal', {});
		}

		// wait for auth to finish loading (synced from layout)
		while (auth.loading) {
			await new Promise(resolve => setTimeout(resolve, 50));
		}

		if (!auth.isAuthenticated) {
			window.location.href = '/login';
			return;
		}

		try {
			await loadMyTracks();
			await loadArtistProfile();
			await loadMyAlbums();
		} catch (_e) {
			console.error('error loading portal data:', _e);
			error = 'failed to load portal data';
		} finally {
			loading = false;
		}
	});

	async function loadMyTracks() {
		loadingTracks = true;
		try {
			const response = await fetch(`${API_URL}/tracks/me`, {
				credentials: 'include'
			});
			if (response.ok) {
				const data = await response.json();
				tracks = data.tracks;
			}
		} catch (_e) {
			console.error('failed to load tracks:', _e);
		} finally {
			loadingTracks = false;
		}
	}

	async function loadArtistProfile() {
		try {
			const response = await fetch(`${API_URL}/artists/me`, {
				credentials: 'include'
			});
			if (response.ok) {
				const artist = await response.json();
				displayName = artist.display_name;
				bio = artist.bio || '';
				avatarUrl = artist.avatar_url || '';
			}
		} catch (_e) {
			console.error('failed to load artist profile:', _e);
		}
	}

	async function loadMyAlbums() {
		if (!auth.user) return;
		loadingAlbums = true;
		try {
			const response = await fetch(`${API_URL}/albums/${auth.user.handle}`);
			if (response.ok) {
				const data = await response.json();
				albums = data.albums;
			}
		} catch (_e) {
			console.error('failed to load albums:', _e);
		} finally {
			loadingAlbums = false;
		}
	}

	async function uploadAlbumCover(albumId: string) {
		if (!editAlbumCoverFile) {
			toast.error('no cover art selected');
			return;
		}

		const formData = new FormData();
		formData.append('image', editAlbumCoverFile);

		try {
			const response = await fetch(`${API_URL}/albums/${albumId}/cover`, {
				method: 'POST',
				credentials: 'include',
				body: formData
			});

			if (response.ok) {
				toast.success('album cover updated');
				editingAlbumId = null;
				editAlbumCoverFile = null;
				await loadMyAlbums();
			} else {
				const data = await response.json();
				toast.error(data.detail || 'failed to upload cover');
			}
		} catch (_e) {
			console.error('failed to upload album cover:', _e);
			toast.error('failed to upload cover art');
		}
	}

	function startEditingAlbum(albumId: string) {
		editingAlbumId = albumId;
		editAlbumCoverFile = null;
	}

	function cancelEditAlbum() {
		editingAlbumId = null;
		editAlbumCoverFile = null;
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
					'Content-Type': 'application/json'
				},
				credentials: 'include',
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
			async () => {
				await loadMyTracks();
				await loadMyAlbums();
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
				credentials: 'include'
			});

			if (response.ok) {
				await loadMyTracks();
				await loadMyAlbums();
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
				credentials: 'include'
			});

			if (response.ok) {
				await loadMyTracks();
				await loadMyAlbums();
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
			} catch (_e) {
				console.error('failed to validate file size:', _e);
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
			} catch (_e) {
				console.error('failed to validate image size:', _e);
				// continue anyway - server will validate
			}

			imageFile = selected;
		}
	}

	async function logout() {
		await auth.logout();
		window.location.href = '/';
	}

	async function exportAllMedia() {
		if (exportingMedia) return;

		const trackCount = tracks.length;
		const exportMsg = trackCount === 1 ? 'preparing export of your track...' : `preparing export of ${trackCount} tracks...`;
		
		// 0 means infinite/persist until dismissed
		const toastId = toast.info(exportMsg, 0);

		exportingMedia = true;
		try {
			// start the export
			const response = await fetch(`${API_URL}/exports/media`, {
				method: 'POST',
				credentials: 'include'
			});

			if (!response.ok) {
				const error = await response.json();
				toast.dismiss(toastId);
				toast.error(error.detail || 'failed to start export');
				exportingMedia = false;
				return;
			}

			const result = await response.json();
			const exportId = result.export_id;

			// subscribe to progress updates via SSE
			const eventSource = new EventSource(`${API_URL}/exports/${exportId}/progress`);

			eventSource.onmessage = async (event) => {
				const update = JSON.parse(event.data);

				// show progress messages
				if (update.message && update.status === 'processing') {
					const progressInfo = update.total_count
						? ` (${update.processed_count}/${update.total_count})`
						: '';
					toast.update(toastId, `${update.message}${progressInfo}`);
				}

				if (update.status === 'completed') {
					eventSource.close();
					exportingMedia = false;

					// update toast to show download is starting
					toast.update(toastId, 'download starting...');
					
					if (update.download_url) {
						// Trigger download directly from R2
						const a = document.createElement('a');
						a.href = update.download_url;
						a.download = `plyr-tracks-${new Date().toISOString().split('T')[0]}.zip`;
						document.body.appendChild(a);
						a.click();
						document.body.removeChild(a);
						
						toast.dismiss(toastId);
						toast.success(`${update.processed_count || trackCount} ${trackCount === 1 ? 'track' : 'tracks'} exported successfully`);
					} else {
						toast.dismiss(toastId);
						toast.error('export completed but download url missing');
					}
				}

				if (update.status === 'failed') {
					eventSource.close();
					toast.dismiss(toastId);
					exportingMedia = false;

					const errorMsg = update.error || 'export failed';
					toast.error(errorMsg);
				}
			};

			eventSource.onerror = () => {
				eventSource.close();
				toast.dismiss(toastId);
				exportingMedia = false;
				toast.error('lost connection to server');
			};

		} catch (e) {
			console.error('export failed:', e);
			toast.dismiss(toastId);
			toast.error('failed to start export');
			exportingMedia = false;
		}
	}
</script>

{#if loading}
	<div class="loading">
		<WaveLoading size="lg" message="loading..." />
	</div>
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
					<AlbumSelect
						{albums}
						bind:value={albumTitle}
					/>
				</div>

				<div class="form-group">
					<label for="features">featured artists (optional)</label>
					<HandleSearch
						bind:selected={featuredArtists}
						bind:hasUnresolvedInput={hasUnresolvedFeaturesInput}
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

				<button type="submit" disabled={!file || hasUnresolvedFeaturesInput} class="upload-btn" title={hasUnresolvedFeaturesInput ? "please select or clear featured artist" : ""}>
					<span>upload track</span>
				</button>
			</form>
		</section>

		<section class="tracks-section">
			<h2>your tracks</h2>

			{#if loadingTracks}
				<div class="loading-container">
					<WaveLoading size="lg" message="loading tracks..." />
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
											disabled={hasUnresolvedEditFeaturesInput}
											title={hasUnresolvedEditFeaturesInput ? "please select or clear featured artist" : "save changes"}
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
										<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<polyline points="3 6 5 6 21 6"></polyline>
											<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
											<line x1="10" y1="11" x2="10" y2="17"></line>
											<line x1="14" y1="11" x2="14" y2="17"></line>
										</svg>
									</button>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<section class="albums-section">
			<h2>your albums</h2>

			{#if loadingAlbums}
				<div class="loading-container">
					<WaveLoading size="lg" message="loading albums..." />
				</div>
			{:else if albums.length === 0}
				<p class="empty">no albums yet - upload tracks with album names to create albums</p>
			{:else}
				<div class="albums-grid">
					{#each albums as album}
						<div class="album-card" class:editing={editingAlbumId === album.id}>
							{#if editingAlbumId === album.id}
								<div class="album-edit-container">
									<div class="album-edit-preview">
										{#if album.image_url && !editAlbumCoverFile}
											<img src={album.image_url} alt="{album.title} cover" class="album-cover" />
										{:else if editAlbumCoverFile}
											<div class="album-cover-placeholder">
												<span class="file-name">{editAlbumCoverFile.name}</span>
												<span class="file-size">({(editAlbumCoverFile.size / 1024 / 1024).toFixed(2)} MB)</span>
											</div>
										{:else}
											<div class="album-cover-placeholder">
												<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
													<rect x="3" y="3" width="18" height="18" stroke="currentColor" stroke-width="1.5" fill="none"/>
													<circle cx="12" cy="12" r="4" fill="currentColor"/>
												</svg>
											</div>
										{/if}
									</div>
									<div class="album-edit-actions">
										<label for="album-cover-input-{album.id}" class="file-input-label">
											select album artwork
										</label>
										<input
											id="album-cover-input-{album.id}"
											type="file"
											accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
											onchange={(e) => {
												const target = e.target as HTMLInputElement;
												editAlbumCoverFile = target.files?.[0] ?? null;
											}}
											class="file-input"
										/>
										<div class="edit-buttons">
											<button
												class="action-btn save-btn"
												onclick={() => uploadAlbumCover(album.id)}
												title="upload cover"
												disabled={!editAlbumCoverFile}
											>
												✓
											</button>
											<button
												class="action-btn cancel-btn"
												onclick={cancelEditAlbum}
												title="cancel"
											>
												✕
											</button>
										</div>
									</div>
								</div>
							{:else}
								<div class="album-cover-container">
									{#if album.image_url}
										<img src={album.image_url} alt="{album.title} cover" class="album-cover" />
									{:else}
										<div class="album-cover-placeholder">
											<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
												<rect x="3" y="3" width="18" height="18" stroke="currentColor" stroke-width="1.5" fill="none"/>
												<circle cx="12" cy="12" r="4" fill="currentColor"/>
											</svg>
										</div>
									{/if}
								</div>
								<div class="album-info">
									<h3 class="album-title">{album.title}</h3>
									<p class="album-stats">
										{album.track_count} {album.track_count === 1 ? 'track' : 'tracks'} •
										{album.total_plays} {album.total_plays === 1 ? 'play' : 'plays'}
									</p>
								</div>
								<div class="album-actions">
									<button
										class="action-btn edit-cover-btn"
										onclick={() => startEditingAlbum(album.id)}
										title="edit cover art"
									>
										<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<path d="M12 20h9"></path>
											<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
										</svg>
									</button>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>

		{#if tracks.length > 0}
			<section class="export-section">
				<div class="export-header">
					<h2>export your music</h2>
					<p class="export-description">
						download all {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'} as a zip archive.
						files are provided in their original format (mp3, wav, m4a) exactly as uploaded.
					</p>
				</div>
				<button
					class="export-main-btn"
					onclick={exportAllMedia}
					disabled={exportingMedia}
				>
					{exportingMedia ? 'exporting...' : tracks.length === 1 ? 'export track' : `export all ${tracks.length} tracks`}
				</button>
			</section>
		{/if}
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
		font-family: inherit;
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
		font-family: inherit;
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
		font-family: inherit;
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
		color: #b0b0b0;
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
		color: #8ab3ff;
		font-weight: 600;
	}

	.features-list {
		color: #8ab3ff;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.meta-album {
		color: #909090;
	}

	.album-link {
		color: #909090;
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
		font-family: inherit;
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
		justify-content: center;
		padding: 3rem 1rem;
	}

	.albums-section {
		margin-top: 3rem;
	}

	.albums-section h2 {
		font-size: var(--text-page-heading);
		margin-bottom: 1.5rem;
	}

	.albums-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 1.5rem;
	}

	.album-card {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		padding: 1rem;
		transition: all 0.2s;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.album-card:hover {
		border-color: #3a3a3a;
		transform: translateY(-2px);
	}

	.album-card.editing {
		border-color: var(--accent);
	}

	.album-cover-container {
		width: 100%;
		aspect-ratio: 1;
		border-radius: 6px;
		overflow: hidden;
		background: #0f0f0f;
		border: 1px solid #282828;
	}

	.album-cover {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.album-cover-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		color: #606060;
		gap: 0.5rem;
	}

	.album-cover-placeholder .file-name {
		font-size: 0.85rem;
		color: #888;
		text-align: center;
		word-break: break-word;
		padding: 0 0.5rem;
	}

	.album-cover-placeholder .file-size {
		font-size: 0.75rem;
		color: #666;
	}

	.album-info {
		flex: 1;
	}

	.album-title {
		font-size: 1rem;
		font-weight: 600;
		color: #e8e8e8;
		margin: 0 0 0.25rem 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.album-stats {
		font-size: 0.85rem;
		color: #888;
		margin: 0;
	}

	.album-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.edit-cover-btn {
		padding: 0.5rem;
		background: #2a2a2a;
		border: 1px solid #3a3a3a;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.edit-cover-btn:hover {
		background: #3a3a3a;
		border-color: var(--accent);
		color: var(--accent);
	}

	.album-edit-container {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.album-edit-preview {
		width: 100%;
		aspect-ratio: 1;
		border-radius: 6px;
		overflow: hidden;
		background: #0f0f0f;
		border: 1px solid #282828;
	}

	.album-edit-actions {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.file-input-label {
		font-size: 0.85rem;
		color: #b0b0b0;
		font-weight: 500;
		margin-bottom: 0.25rem;
	}

	.album-edit-actions .file-input {
		padding: 0.5rem;
		background: #2a2a2a;
		border: 1px solid #3a3a3a;
		border-radius: 4px;
		color: #e8e8e8;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.album-edit-actions .file-input:hover {
		background: #3a3a3a;
		border-color: var(--accent);
	}

	.edit-buttons {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.export-section {
		margin-top: 3rem;
		padding: 2rem;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
	}

	.export-header {
		margin-bottom: 1.5rem;
	}

	.export-header h2 {
		font-size: var(--text-page-heading);
		margin-bottom: 0.75rem;
	}

	.export-description {
		color: #aaa;
		font-size: 0.95rem;
		line-height: 1.6;
		margin: 0;
	}

	.export-main-btn {
		width: 100%;
		padding: 1rem;
		background: #3a7dff;
		color: white;
		border: none;
		border-radius: 6px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.export-main-btn:hover:not(:disabled) {
		background: #2868e6;
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(58, 125, 255, 0.3);
	}

	.export-main-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	.export-main-btn:active:not(:disabled) {
		transform: translateY(0);
	}
</style>
