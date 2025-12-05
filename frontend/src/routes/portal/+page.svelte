<script lang="ts">
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';
	import HandleSearch from '$lib/components/HandleSearch.svelte';
	import AlbumSelect from '$lib/components/AlbumSelect.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import MigrationBanner from '$lib/components/MigrationBanner.svelte';
	import BrokenTracks from '$lib/components/BrokenTracks.svelte';
	import TagInput from '$lib/components/TagInput.svelte';
	import type { Track, FeaturedArtist, AlbumSummary } from '$lib/types';
	import { API_URL } from '$lib/config';
	import { toast } from '$lib/toast.svelte';
	import { auth } from '$lib/auth.svelte';
	import { preferences } from '$lib/preferences.svelte';

	let loading = $state(true);
	let error = $state('');
	let tracks = $state<Track[]>([]);
	let loadingTracks = $state(false);

	// track editing state
	let editingTrackId = $state<number | null>(null);
	let editTitle = $state('');
	let editAlbum = $state('');
	let editFeaturedArtists = $state<FeaturedArtist[]>([]);
	let editTags = $state<string[]>([]);
	let editImageFile = $state<File | null>(null);
	let hasUnresolvedEditFeaturesInput = $state(false);

	// profile editing state
	let displayName = $state('');
	let bio = $state('');
	let avatarUrl = $state('');
	// derive from preferences store
	let allowComments = $derived(preferences.allowComments);
	let enableTealScrobbling = $derived(preferences.enableTealScrobbling);
	let tealNeedsReauth = $derived(preferences.tealNeedsReauth);
	let showExplicitArtwork = $derived(preferences.showExplicitArtwork);
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

	// account deletion state
	let showDeleteConfirm = $state(false);
	let deleteConfirmText = $state('');
	let deleteAtprotoRecords = $state(false);
	let deleting = $state(false);

	// developer token state
	let creatingToken = $state(false);
	let developerToken = $state<string | null>(null);
	let tokenExpiresDays = $state(90);
	let tokenName = $state('');
	let tokenCopied = $state(false);

	// existing tokens list
	interface TokenInfo {
		session_id: string;
		name: string | null;
		created_at: string;
		expires_at: string | null;
	}
	let existingTokens = $state<TokenInfo[]>([]);
	let loadingTokens = $state(false);
	let revokingToken = $state<string | null>(null);

	onMount(async () => {
		// check if exchange_token is in URL (from OAuth callback)
		const params = new URLSearchParams(window.location.search);
		const exchangeToken = params.get('exchange_token');
		const isDevToken = params.get('dev_token') === 'true';

		if (exchangeToken) {
			// exchange token for session_id
			try {
				const exchangeResponse = await fetch(`${API_URL}/auth/exchange`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({ exchange_token: exchangeToken })
				});

				if (exchangeResponse.ok) {
					const data = await exchangeResponse.json();

					if (isDevToken) {
						// this is a developer token - display it to the user
						developerToken = data.session_id;
						toast.success('developer token created - save it now!');
					} else {
						// regular login - initialize auth and refresh preferences
						await auth.initialize();
						await preferences.fetch();
					}
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
			await loadDeveloperTokens();
		} catch (_e) {
			console.error('error loading portal data:', _e);
			error = 'failed to load portal data';
		} finally {
			loading = false;
		}
	});

	async function loadDeveloperTokens() {
		loadingTokens = true;
		try {
			const response = await fetch(`${API_URL}/auth/developer-tokens`, {
				credentials: 'include'
			});
			if (response.ok) {
				const data = await response.json();
				existingTokens = data.tokens;
			}
		} catch (_e) {
			console.error('failed to load developer tokens:', _e);
		} finally {
			loadingTokens = false;
		}
	}

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

	async function saveAllowComments(enabled: boolean) {
		try {
			await preferences.update({ allow_comments: enabled });
			toast.success(enabled ? 'comments enabled on your tracks' : 'comments disabled');
		} catch (_e) {
			console.error('failed to save preference:', _e);
			toast.error('failed to update preference');
		}
	}

	async function saveTealScrobbling(enabled: boolean) {
		try {
			await preferences.update({ enable_teal_scrobbling: enabled });
			await preferences.fetch(); // refetch to get updated teal_needs_reauth status
			toast.success(enabled ? 'teal.fm scrobbling enabled' : 'teal.fm scrobbling disabled');
		} catch (_e) {
			console.error('failed to save preference:', _e);
			toast.error('failed to update preference');
		}
	}

	async function saveShowExplicitArtwork(enabled: boolean) {
		try {
			await preferences.update({ show_explicit_artwork: enabled });
			toast.success(enabled ? 'explicit artwork shown' : 'explicit artwork hidden');
		} catch (_e) {
			console.error('failed to save preference:', _e);
			toast.error('failed to update preference');
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
				toast.success('track deleted');
			} else {
				const error = await response.json();
				toast.error(error.detail || 'failed to delete track');
			}
		} catch (e) {
			toast.error(`network error: ${e instanceof Error ? e.message : 'unknown error'}`);
		}
	}

	function startEditTrack(track: typeof tracks[0]) {
		editingTrackId = track.id;
		editTitle = track.title;
		editAlbum = track.album?.title || '';
		editFeaturedArtists = track.features || [];
		editTags = track.tags || [];
	}

	function cancelEdit() {
		editingTrackId = null;
		editTitle = '';
		editAlbum = '';
		editFeaturedArtists = [];
		editTags = [];
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
		// always send tags (empty array clears them)
		formData.append('tags', JSON.stringify(editTags));
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
			let exportComplete = false;

			eventSource.onmessage = async (event) => {
				const update = JSON.parse(event.data);

				// show progress messages
				if (update.message && update.status === 'processing') {
					toast.update(toastId, update.message);
				}

				if (update.status === 'completed') {
					exportComplete = true;
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
					exportComplete = true;
					eventSource.close();
					toast.dismiss(toastId);
					exportingMedia = false;

					const errorMsg = update.error || 'export failed';
					toast.error(errorMsg);
				}
			};

			eventSource.onerror = () => {
				eventSource.close();
				// Don't show error if export already completed - SSE stream closing is normal
				if (exportComplete) return;
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

	async function createDeveloperToken() {
		creatingToken = true;
		developerToken = null;
		tokenCopied = false;

		try {
			// start OAuth flow for dev token - this returns an auth URL
			const response = await fetch(`${API_URL}/auth/developer-token/start`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					name: tokenName || null,
					expires_in_days: tokenExpiresDays
				})
			});

			if (!response.ok) {
				const error = await response.json();
				toast.error(error.detail || 'failed to start token creation');
				creatingToken = false;
				return;
			}

			const result = await response.json();
			tokenName = ''; // clear the name field

			// redirect to PDS for authorization
			// on callback, user will return with dev_token=true and the token will be displayed
			window.location.href = result.auth_url;
		} catch (e) {
			console.error('failed to create token:', e);
			toast.error('failed to create token');
			creatingToken = false;
		}
		// note: we don't set creatingToken = false here because we're redirecting
	}

	async function revokeToken(tokenId: string, name: string | null) {
		if (!confirm(`revoke token "${name || tokenId}"?`)) return;

		revokingToken = tokenId;
		try {
			const response = await fetch(`${API_URL}/auth/developer-tokens/${tokenId}`, {
				method: 'DELETE',
				credentials: 'include'
			});

			if (!response.ok) {
				const error = await response.json();
				toast.error(error.detail || 'failed to revoke token');
				return;
			}

			toast.success('token revoked');
			await loadDeveloperTokens();
		} catch (e) {
			console.error('failed to revoke token:', e);
			toast.error('failed to revoke token');
		} finally {
			revokingToken = null;
		}
	}

	async function copyToken() {
		if (!developerToken) return;
		try {
			await navigator.clipboard.writeText(developerToken);
			tokenCopied = true;
			toast.success('token copied to clipboard');
			setTimeout(() => { tokenCopied = false; }, 2000);
		} catch (e) {
			console.error('failed to copy:', e);
			toast.error('failed to copy token');
		}
	}

	async function deleteAccount() {
		if (!auth.user || deleteConfirmText !== auth.user.handle) return;

		deleting = true;
		const toastId = toast.info('deleting account...', 0);

		try {
			const response = await fetch(`${API_URL}/account/`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					confirmation: deleteConfirmText,
					delete_atproto_records: deleteAtprotoRecords
				})
			});

			if (!response.ok) {
				const error = await response.json();
				toast.dismiss(toastId);
				toast.error(error.detail || 'failed to delete account');
				deleting = false;
				return;
			}

			const result = await response.json();
			toast.dismiss(toastId);

			// show summary of what was deleted
			const { deleted } = result;
			const summary = [
				deleted.tracks && `${deleted.tracks} tracks`,
				deleted.albums && `${deleted.albums} albums`,
				deleted.likes && `${deleted.likes} likes`,
				deleted.comments && `${deleted.comments} comments`,
				deleted.atproto_records && `${deleted.atproto_records} ATProto records`
			].filter(Boolean).join(', ');

			toast.success(`account deleted: ${summary || 'all data removed'}`);

			// redirect to home after a moment
			setTimeout(() => {
				window.location.href = '/';
			}, 2000);

		} catch (e) {
			console.error('delete failed:', e);
			toast.dismiss(toastId);
			toast.error('failed to delete account');
			deleting = false;
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

		<a href="/upload" class="upload-card">
			<div class="upload-card-icon">
				<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
					<polyline points="17 8 12 3 7 8"></polyline>
					<line x1="12" y1="3" x2="12" y2="15"></line>
				</svg>
			</div>
			<div class="upload-card-text">
				<span class="upload-card-title">upload track</span>
				<span class="upload-card-subtitle">add new music</span>
			</div>
			<svg class="upload-card-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="9 18 15 12 9 6"></polyline>
			</svg>
		</a>

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
											<label for="edit-tags" class="edit-label">tags (optional)</label>
											<TagInput
												tags={editTags}
												onAdd={(tag) => { editTags = [...editTags, tag]; }}
												onRemove={(tag) => { editTags = editTags.filter(t => t !== tag); }}
												placeholder="type to search tags..."
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
											<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
												<polyline points="20 6 9 17 4 12"></polyline>
											</svg>
										</button>
										<button
											class="action-btn cancel-btn"
											onclick={cancelEdit}
											title="cancel"
										>
											<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
												<line x1="18" y1="6" x2="6" y2="18"></line>
												<line x1="6" y1="6" x2="18" y2="18"></line>
											</svg>
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
						{#if track.copyright_flagged}
							{@const matchText = track.copyright_match ? `potential copyright violation: ${track.copyright_match}` : 'potential copyright violation'}
							{#if track.atproto_record_url}
								<a
									href={track.atproto_record_url}
									target="_blank"
									rel="noopener noreferrer"
									class="copyright-flag"
									title="{matchText}"
								>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
										<line x1="12" y1="9" x2="12" y2="13"></line>
										<line x1="12" y1="17" x2="12.01" y2="17"></line>
									</svg>
								</a>
							{:else}
								<span class="copyright-flag" title={matchText}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
										<line x1="12" y1="9" x2="12" y2="13"></line>
										<line x1="12" y1="17" x2="12.01" y2="17"></line>
									</svg>
								</span>
							{/if}
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
										class="action-btn edit-btn"
										onclick={() => startEditTrack(track)}
										title="edit track"
									>
										<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
											<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
										</svg>
									</button>
									<button
										class="action-btn delete-btn"
										onclick={() => deleteTrack(track.id, track.title)}
										title="delete track"
									>
										<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<polyline points="3 6 5 6 21 6"></polyline>
											<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
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

		<section class="data-section">
			<h2>your data</h2>

			<div class="data-control">
				<div class="control-info">
					<h3>teal.fm scrobbling</h3>
					<p class="control-description">
						track your listens as <a href="https://pdsls.dev/at://{auth.user?.did}/fm.teal.alpha.feed.play" target="_blank" rel="noopener">fm.teal.alpha.feed.play</a> records
					</p>
				</div>
				<label class="toggle-switch">
					<input
						type="checkbox"
						aria-label="Enable teal.fm scrobbling"
						checked={enableTealScrobbling}
						onchange={(e) => saveTealScrobbling((e.target as HTMLInputElement).checked)}
					/>
					<span class="toggle-slider"></span>
					<span class="toggle-label">{enableTealScrobbling ? 'enabled' : 'disabled'}</span>
				</label>
			</div>
			{#if tealNeedsReauth}
				<div class="reauth-notice">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="12" cy="12" r="10" />
						<path d="M12 16v-4M12 8h.01" />
					</svg>
					<span>please log out and back in to connect teal.fm</span>
				</div>
			{/if}

			<div class="data-control">
				<div class="control-info">
					<h3>timed comments</h3>
					<p class="control-description">
						allow other users to leave comments on your tracks
					</p>
				</div>
				<label class="toggle-switch">
					<input
						type="checkbox"
						aria-label="Allow timed comments on your tracks"
						checked={allowComments}
						onchange={(e) => saveAllowComments((e.target as HTMLInputElement).checked)}
					/>
					<span class="toggle-slider"></span>
					<span class="toggle-label">{allowComments ? 'enabled' : 'disabled'}</span>
				</label>
			</div>

			<div class="data-control">
				<div class="control-info">
					<h3>explicit artwork</h3>
					<p class="control-description">
						show artwork that has been flagged as explicit (nudity, etc.)
					</p>
				</div>
				<label class="toggle-switch">
					<input
						type="checkbox"
						aria-label="Show explicit artwork"
						checked={showExplicitArtwork}
						onchange={(e) => saveShowExplicitArtwork((e.target as HTMLInputElement).checked)}
					/>
					<span class="toggle-slider"></span>
					<span class="toggle-label">{showExplicitArtwork ? 'shown' : 'hidden'}</span>
				</label>
			</div>

			{#if tracks.length > 0}
				<div class="data-control">
					<div class="control-info">
						<h3>export tracks</h3>
						<p class="control-description">
							{tracks.length === 1 ? 'download your track as a zip archive' : `download all ${tracks.length} tracks as a zip archive`}
						</p>
					</div>
					<button
						class="export-btn"
						onclick={exportAllMedia}
						disabled={exportingMedia}
					>
						{exportingMedia ? 'exporting...' : 'export'}
					</button>
				</div>
			{/if}

			<div class="data-control developer-section">
				<div class="control-info">
					<h3>developer tokens</h3>
					<p class="control-description">
						create tokens for programmatic API access (uploads, track management).
						use with the <a href="https://github.com/zzstoatzz/plyr-python-client" target="_blank" rel="noopener">python SDK</a>
					</p>
				</div>

				{#if loadingTokens}
					<p class="loading-tokens">loading tokens...</p>
				{:else if existingTokens.length > 0}
					<div class="existing-tokens">
						<h4 class="tokens-header">active tokens</h4>
						<div class="tokens-list">
							{#each existingTokens as token}
								<div class="token-item">
									<div class="token-info">
										<span class="token-name">{token.name || `token_${token.session_id}`}</span>
										<span class="token-meta">
											created {new Date(token.created_at).toLocaleDateString()}
											{#if token.expires_at}
												· expires {new Date(token.expires_at).toLocaleDateString()}
											{:else}
												· never expires
											{/if}
										</span>
									</div>
									<button
										class="revoke-btn"
										onclick={() => revokeToken(token.session_id, token.name)}
										disabled={revokingToken === token.session_id}
										title="revoke token"
									>
										{revokingToken === token.session_id ? '...' : 'revoke'}
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if developerToken}
					<div class="token-display">
						<code class="token-value">{developerToken}</code>
						<button
							class="copy-btn"
							onclick={copyToken}
							title="copy token"
						>
							{tokenCopied ? '✓' : 'copy'}
						</button>
						<button
							class="dismiss-btn"
							onclick={() => developerToken = null}
							title="dismiss"
						>
							✕
						</button>
					</div>
					<p class="token-warning">
						save this token now - you won't be able to see it again
					</p>
				{:else}
					<div class="token-form">
						<input
							type="text"
							class="token-name-input"
							bind:value={tokenName}
							placeholder="token name (optional)"
							disabled={creatingToken}
						/>
						<label class="expires-label">
							<span>expires in</span>
							<select bind:value={tokenExpiresDays} class="expires-select">
								<option value={30}>30 days</option>
								<option value={90}>90 days</option>
								<option value={180}>180 days</option>
								<option value={365}>1 year</option>
								<option value={0}>never</option>
							</select>
						</label>
						<button
							class="create-token-btn"
							onclick={createDeveloperToken}
							disabled={creatingToken}
						>
							{creatingToken ? 'creating...' : 'create token'}
						</button>
					</div>
				{/if}
			</div>

			<div class="data-control danger-zone">
				<div class="control-info">
					<h3>delete account</h3>
					<p class="control-description">
						permanently delete all your data from plyr.fm.
						<a href="https://github.com/zzstoatzz/plyr.fm/blob/main/docs/offboarding.md#account-deletion" target="_blank" rel="noopener">learn more</a>
					</p>
				</div>
				{#if !showDeleteConfirm}
					<button
						class="delete-account-btn"
						onclick={() => showDeleteConfirm = true}
					>
						delete account
					</button>
				{:else}
					<div class="delete-confirm-panel">
						<p class="delete-warning">
							this will permanently delete all your tracks, albums, likes, and comments from plyr.fm. this cannot be undone.
						</p>

						<div class="atproto-section">
							<label class="atproto-option">
								<input
									type="checkbox"
									bind:checked={deleteAtprotoRecords}
								/>
								<span>also delete records from my ATProto repo</span>
							</label>
							<p class="atproto-note">
								you can manage your PDS records directly via <a href="https://pdsls.dev/at://{auth.user?.did}" target="_blank" rel="noopener">pdsls.dev</a>, or let us clean them up for you.
							</p>
							{#if deleteAtprotoRecords}
								<p class="atproto-warning">
									this removes track, like, and comment records from your PDS. other users' likes and comments that reference your tracks will become orphaned (pointing to records that no longer exist).
								</p>
							{/if}
						</div>

						<p class="confirm-prompt">
							type <strong>{auth.user?.handle}</strong> to confirm:
						</p>
						<input
							type="text"
							class="confirm-input"
							bind:value={deleteConfirmText}
							placeholder={auth.user?.handle}
							disabled={deleting}
						/>

						<div class="delete-actions">
							<button
								class="cancel-btn"
								onclick={() => {
									showDeleteConfirm = false;
									deleteConfirmText = '';
									deleteAtprotoRecords = false;
								}}
								disabled={deleting}
							>
								cancel
							</button>
							<button
								class="confirm-delete-btn"
								onclick={deleteAccount}
								disabled={deleting || deleteConfirmText !== auth.user?.handle}
							>
								{deleting ? 'deleting...' : 'delete everything'}
							</button>
						</div>
					</div>
				{/if}
			</div>
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
		color: var(--text-tertiary);
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

	.profile-section {
		margin-bottom: 2rem;
	}

	.profile-section h2 {
		font-size: var(--text-page-heading);
		margin-bottom: 1rem;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.section-header h2 {
		margin-bottom: 0;
	}

	.view-profile-link {
		color: var(--text-secondary);
		text-decoration: none;
		font-size: 0.8rem;
		padding: 0.35rem 0.6rem;
		background: var(--bg-tertiary);
		border-radius: 5px;
		border: 1px solid var(--border-default);
		transition: all 0.15s;
		white-space: nowrap;
	}

	.view-profile-link:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--bg-hover);
	}

	/* upload card */
	.upload-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.25rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: 8px;
		text-decoration: none;
		color: var(--text-primary);
		transition: all 0.15s;
		margin-bottom: 2rem;
	}

	.upload-card:hover {
		border-color: var(--accent);
		background: var(--bg-hover);
	}

	.upload-card:active {
		transform: scale(0.99);
	}

	.upload-card-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		border-radius: 10px;
		color: var(--accent);
		flex-shrink: 0;
	}

	.upload-card-text {
		flex: 1;
		min-width: 0;
	}

	.upload-card-title {
		display: block;
		font-weight: 600;
		font-size: 0.95rem;
		color: var(--text-primary);
	}

	.upload-card-subtitle {
		display: block;
		font-size: 0.8rem;
		color: var(--text-tertiary);
	}

	.upload-card-chevron {
		color: var(--text-muted);
		flex-shrink: 0;
		transition: transform 0.15s;
	}

	.upload-card:hover .upload-card-chevron {
		transform: translateX(2px);
		color: var(--accent);
	}

	form {
		background: var(--bg-tertiary);
		padding: 1.25rem;
		border-radius: 8px;
		border: 1px solid var(--border-subtle);
	}

	.form-group {
		margin-bottom: 1rem;
	}

	.form-group:last-of-type {
		margin-bottom: 1.25rem;
	}

	label {
		display: block;
		color: var(--text-secondary);
		margin-bottom: 0.4rem;
		font-size: 0.85rem;
	}

	input[type='text'] {
		width: 100%;
		padding: 0.6rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-primary);
		font-size: 0.95rem;
		font-family: inherit;
		transition: all 0.15s;
	}

	input[type='text']:focus {
		outline: none;
		border-color: var(--accent);
	}

	input[type='text']:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	textarea {
		width: 100%;
		padding: 0.6rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-primary);
		font-size: 0.95rem;
		font-family: inherit;
		transition: all 0.15s;
		resize: vertical;
		min-height: 80px;
	}

	textarea:focus {
		outline: none;
		border-color: var(--accent);
	}

	textarea:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.hint {
		margin-top: 0.35rem;
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.message {
		padding: 1rem;
		border-radius: 4px;
		margin-bottom: 1.5rem;
	}

	.message.success {
		background: color-mix(in srgb, var(--success) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
		color: var(--success);
	}

	.message.error {
		background: color-mix(in srgb, var(--error) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--error) 30%, transparent);
		color: var(--error);
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
		border: 2px solid var(--border-default);
	}

	input[type='file'] {
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

	input[type='file']:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent);
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
		color: var(--text-muted);
		padding: 2rem;
		text-align: center;
		background: var(--bg-tertiary);
		border-radius: 8px;
		border: 1px solid var(--border-subtle);
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
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: 6px;
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
		border-radius: 4px;
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
		font-size: 0.7rem;
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
		color: var(--text-secondary);
	}

	.track-title {
		font-weight: 600;
		font-size: 1rem;
		margin-bottom: 0.25rem;
		color: var(--text-primary);
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.copyright-flag {
		display: inline-flex;
		align-items: center;
		color: var(--warning);
		flex-shrink: 0;
		text-decoration: none;
	}

	.copyright-flag:hover {
		color: color-mix(in srgb, var(--warning) 80%, white);
	}

	a.copyright-flag {
		cursor: pointer;
	}

	a.copyright-flag:hover {
		transform: scale(1.1);
	}

	.track-meta {
		font-size: 0.9rem;
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
		border-radius: 3px;
		font-size: 0.8rem;
		font-weight: 500;
		text-decoration: none;
		transition: all 0.15s;
	}

	.meta-tag:hover {
		background: color-mix(in srgb, var(--accent) 25%, transparent);
		color: var(--accent-hover);
	}

	.track-date {
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.track-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
		margin-left: 0.75rem;
		align-self: flex-start;
	}

	.action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: 6px;
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.15s;
		flex-shrink: 0;
	}

	.action-btn svg {
		flex-shrink: 0;
	}

	.action-btn:hover {
		transform: none;
		box-shadow: none;
	}

	.edit-btn:hover {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		border-color: var(--accent);
		color: var(--accent);
	}

	.delete-btn:hover {
		background: color-mix(in srgb, var(--error) 12%, transparent);
		border-color: var(--error);
		color: var(--error);
	}

	.save-btn:hover {
		background: color-mix(in srgb, var(--success) 12%, transparent);
		border-color: var(--success);
		color: var(--success);
	}

	.cancel-btn:hover {
		background: color-mix(in srgb, var(--text-tertiary) 12%, transparent);
		border-color: var(--text-tertiary);
		color: var(--text-secondary);
	}

	.edit-input {
		width: 100%;
		padding: 0.5rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-primary);
		font-size: 0.9rem;
		font-family: inherit;
	}

	.current-image-preview {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
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
		color: var(--text-tertiary);
		font-size: 0.85rem;
	}

	.edit-input:focus {
		outline: none;
		border-color: var(--accent);
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
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		padding: 1rem;
		transition: all 0.2s;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.album-card:hover {
		border-color: var(--border-emphasis);
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
		background: var(--bg-primary);
		border: 1px solid var(--border-subtle);
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
		color: var(--text-muted);
		gap: 0.5rem;
	}

	.album-cover-placeholder .file-name {
		font-size: 0.85rem;
		color: var(--text-tertiary);
		text-align: center;
		word-break: break-word;
		padding: 0 0.5rem;
	}

	.album-cover-placeholder .file-size {
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.album-info {
		flex: 1;
	}

	.album-title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0 0 0.25rem 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.album-stats {
		font-size: 0.85rem;
		color: var(--text-tertiary);
		margin: 0;
	}

	.album-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.edit-cover-btn {
		padding: 0.5rem;
		background: var(--border-subtle);
		border: 1px solid var(--border-emphasis);
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.edit-cover-btn:hover {
		background: var(--border-emphasis);
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
		background: var(--bg-primary);
		border: 1px solid var(--border-subtle);
	}

	.album-edit-actions {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.file-input-label {
		font-size: 0.85rem;
		color: var(--text-secondary);
		font-weight: 500;
		margin-bottom: 0.25rem;
	}

	.album-edit-actions .file-input {
		padding: 0.5rem;
		background: var(--border-subtle);
		border: 1px solid var(--border-emphasis);
		border-radius: 4px;
		color: var(--text-primary);
		font-size: 0.85rem;
		cursor: pointer;
	}

	.album-edit-actions .file-input:hover {
		background: var(--border-emphasis);
		border-color: var(--accent);
	}

	.edit-buttons {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	/* your data section */
	.data-section {
		margin-top: 2.5rem;
	}

	.data-section h2 {
		font-size: var(--text-page-heading);
		margin-bottom: 1rem;
	}

	.data-control {
		padding: 1rem 1.25rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.data-control:last-child {
		margin-bottom: 0;
	}

	.control-info {
		flex: 1;
		min-width: 0;
	}

	.control-info h3 {
		font-size: 0.9rem;
		font-weight: 600;
		margin: 0 0 0.15rem 0;
		color: var(--text-primary);
	}

	.control-description {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin: 0;
		line-height: 1.4;
	}

	.control-description a {
		color: var(--accent);
	}

	.reauth-notice {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0.75rem;
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		border-radius: 6px;
		color: var(--accent);
		font-size: 0.8rem;
		margin-top: -0.5rem;
	}

	.reauth-notice svg {
		flex-shrink: 0;
	}

	.export-btn {
		padding: 0.6rem 1.25rem;
		background: var(--accent);
		color: var(--text-primary);
		border: none;
		border-radius: 6px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
		width: auto;
	}

	.export-btn:hover:not(:disabled) {
		background: var(--accent-hover);
		transform: translateY(-1px);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	.export-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	/* danger zone / account deletion */
	.danger-zone {
		border-color: color-mix(in srgb, var(--error) 30%, var(--bg-tertiary));
		background: color-mix(in srgb, var(--error) 8%, var(--bg-tertiary));
		flex-direction: column;
		align-items: stretch;
	}

	.danger-zone .control-info h3 {
		color: var(--error);
	}

	.danger-zone .control-description a {
		color: var(--text-tertiary);
		text-decoration: underline;
	}

	.danger-zone .control-description a:hover {
		color: var(--text-secondary);
	}

	.delete-account-btn {
		padding: 0.6rem 1.25rem;
		background: transparent;
		color: var(--error);
		border: 1px solid var(--error);
		border-radius: 6px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		align-self: flex-end;
	}

	.delete-account-btn:hover {
		background: var(--error);
		color: var(--text-primary);
	}

	.delete-confirm-panel {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid color-mix(in srgb, var(--error) 25%, var(--bg-tertiary));
	}

	.delete-warning {
		color: color-mix(in srgb, var(--error) 80%, white);
		font-size: 0.9rem;
		margin: 0 0 1rem 0;
		line-height: 1.5;
	}

	.atproto-section {
		margin-bottom: 1rem;
	}

	.atproto-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.atproto-option input {
		width: 16px;
		height: 16px;
		cursor: pointer;
	}

	.atproto-note {
		margin: 0.5rem 0 0 0;
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.atproto-note a {
		color: var(--text-tertiary);
		text-decoration: underline;
	}

	.atproto-note a:hover {
		color: var(--text-secondary);
	}

	.atproto-warning {
		margin: 0.75rem 0 0 0;
		padding: 0.75rem;
		background: color-mix(in srgb, var(--error) 10%, transparent);
		border-left: 2px solid var(--error);
		font-size: 0.85rem;
		color: color-mix(in srgb, var(--error) 70%, var(--text-secondary));
		line-height: 1.5;
	}

	.confirm-prompt {
		font-size: 0.9rem;
		color: var(--text-tertiary);
		margin: 0 0 0.5rem 0;
	}

	.confirm-prompt strong {
		color: var(--text-primary);
		font-family: monospace;
	}

	.confirm-input {
		width: 100%;
		padding: 0.75rem;
		background: color-mix(in srgb, var(--error) 5%, var(--bg-primary));
		border: 1px solid color-mix(in srgb, var(--error) 25%, var(--bg-tertiary));
		border-radius: 6px;
		color: var(--text-primary);
		font-size: 0.9rem;
		font-family: monospace;
		margin-bottom: 1rem;
	}

	.confirm-input:focus {
		outline: none;
		border-color: var(--error);
	}

	.confirm-input::placeholder {
		color: var(--text-muted);
	}

	.delete-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
	}

	.cancel-btn {
		padding: 0.6rem 1.25rem;
		background: transparent;
		color: var(--text-tertiary);
		border: 1px solid var(--border-emphasis);
		border-radius: 6px;
		font-size: 0.9rem;
		cursor: pointer;
		transition: all 0.2s;
	}

	.cancel-btn:hover:not(:disabled) {
		border-color: var(--text-muted);
		color: var(--text-secondary);
	}

	.cancel-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.confirm-delete-btn {
		padding: 0.6rem 1.25rem;
		background: var(--error);
		color: var(--text-primary);
		border: none;
		border-radius: 6px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.confirm-delete-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--error) 80%, black);
	}

	.confirm-delete-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.toggle-switch {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		cursor: pointer;
		flex-shrink: 0;
	}

	.toggle-switch input {
		display: none;
	}

	.toggle-slider {
		width: 44px;
		height: 24px;
		background: var(--border-default);
		border-radius: 12px;
		position: relative;
		transition: background 0.2s;
	}

	.toggle-slider::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 20px;
		height: 20px;
		background: var(--text-tertiary);
		border-radius: 50%;
		transition: all 0.2s;
	}

	.toggle-switch input:checked + .toggle-slider {
		background: var(--accent);
	}

	.toggle-switch input:checked + .toggle-slider::after {
		left: 22px;
		background: var(--text-primary);
	}

	.toggle-label {
		font-size: 0.85rem;
		color: var(--text-tertiary);
		min-width: 60px;
	}

	/* developer token section */
	.developer-section {
		flex-direction: column;
		align-items: stretch;
		gap: 1rem;
	}

	.developer-section .control-info h3 {
		color: var(--accent);
	}

	.token-form {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		width: 100%;
	}

	.token-form .create-token-btn {
		margin-left: auto;
	}

	.expires-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: var(--text-tertiary);
	}

	.expires-select {
		padding: 0.5rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-primary);
		font-size: 0.9rem;
		font-family: inherit;
		cursor: pointer;
	}

	.expires-select:focus {
		outline: none;
		border-color: var(--accent);
	}

	.create-token-btn {
		padding: 0.6rem 1.25rem;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: 6px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
		width: auto;
	}

	.create-token-btn:hover:not(:disabled) {
		filter: brightness(1.1);
		transform: translateY(-1px);
	}

	.create-token-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	.token-display {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 6px;
		padding: 0.75rem;
		overflow: hidden;
	}

	.token-value {
		flex: 1;
		font-family: monospace;
		font-size: 0.85rem;
		color: var(--success);
		word-break: break-all;
		user-select: all;
	}

	.copy-btn,
	.dismiss-btn {
		padding: 0.4rem 0.75rem;
		background: var(--border-subtle);
		border: 1px solid var(--border-emphasis);
		border-radius: 4px;
		color: var(--text-tertiary);
		font-size: 0.85rem;
		cursor: pointer;
		transition: all 0.2s;
		width: auto;
	}

	.copy-btn:hover {
		background: var(--border-emphasis);
		border-color: var(--accent);
		color: var(--accent);
	}

	.dismiss-btn:hover {
		background: var(--border-emphasis);
		border-color: var(--text-muted);
		color: var(--text-secondary);
	}

	.token-warning {
		font-size: 0.85rem;
		color: var(--warning);
		margin: 0;
	}

	/* existing tokens list */
	.existing-tokens {
		width: 100%;
		margin-bottom: 1rem;
	}

	.tokens-header {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-tertiary);
		margin: 0 0 0.75rem 0;
	}

	.tokens-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.token-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-subtle);
		border-radius: 6px;
	}

	.token-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
		flex: 1;
	}

	.token-name {
		font-family: monospace;
		font-size: 0.9rem;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.token-meta {
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.revoke-btn {
		padding: 0.4rem 0.75rem;
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--error) 30%, var(--bg-tertiary));
		border-radius: 4px;
		color: var(--error);
		font-size: 0.85rem;
		cursor: pointer;
		transition: all 0.2s;
		width: auto;
		flex-shrink: 0;
	}

	.revoke-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--error) 10%, transparent);
		border-color: var(--error);
	}

	.revoke-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.token-name-input {
		padding: 0.5rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-primary);
		font-size: 0.9rem;
		font-family: inherit;
		min-width: 150px;
	}

	.token-name-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.token-name-input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.loading-tokens {
		font-size: 0.9rem;
		color: var(--text-muted);
		margin: 0;
	}

	/* mobile responsive */
	@media (max-width: 600px) {
		main {
			padding: 0 0.75rem calc(var(--player-height, 120px) + 1.5rem + env(safe-area-inset-bottom, 0px));
		}

		.portal-header {
			margin-bottom: 1.25rem;
		}

		.portal-header h2 {
			font-size: 1.25rem;
		}

		.profile-section h2,
		.tracks-section h2,
		.albums-section h2,
		.data-section h2 {
			font-size: 1.1rem;
		}

		.section-header {
			margin-bottom: 0.75rem;
		}

		.view-profile-link {
			font-size: 0.75rem;
			padding: 0.3rem 0.5rem;
		}

		form {
			padding: 1rem;
		}

		.form-group {
			margin-bottom: 0.85rem;
		}

		label {
			font-size: 0.8rem;
			margin-bottom: 0.3rem;
		}

		input[type='text'],
		input[type='url'],
		textarea {
			padding: 0.5rem 0.6rem;
			font-size: 0.9rem;
		}

		textarea {
			min-height: 70px;
		}

		.hint {
			font-size: 0.7rem;
		}

		.avatar-preview img {
			width: 48px;
			height: 48px;
		}

		button[type="submit"] {
			padding: 0.6rem;
			font-size: 0.9rem;
		}

		/* upload card mobile */
		.upload-card {
			padding: 0.85rem 1rem;
			margin-bottom: 1.5rem;
		}

		.upload-card-icon {
			width: 40px;
			height: 40px;
		}

		.upload-card-icon svg {
			width: 20px;
			height: 20px;
		}

		.upload-card-title {
			font-size: 0.9rem;
		}

		.upload-card-subtitle {
			font-size: 0.75rem;
		}

		/* tracks mobile */
		.tracks-section,
		.albums-section,
		.data-section {
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
			font-size: 0.9rem;
		}

		.track-meta {
			font-size: 0.8rem;
		}

		.track-date {
			font-size: 0.75rem;
		}

		.track-actions {
			margin-left: 0.5rem;
			gap: 0.35rem;
		}

		.action-btn {
			width: 30px;
			height: 30px;
		}

		.action-btn svg {
			width: 14px;
			height: 14px;
		}

		/* edit mode mobile */
		.edit-container {
			gap: 0.75rem;
		}

		.edit-fields {
			gap: 0.6rem;
		}

		.edit-label {
			font-size: 0.8rem;
		}

		.edit-input {
			padding: 0.45rem 0.5rem;
			font-size: 0.85rem;
		}

		.edit-actions {
			gap: 0.35rem;
		}

		/* data section mobile */
		.data-control {
			padding: 0.85rem 1rem;
			gap: 0.6rem;
		}

		.control-info h3 {
			font-size: 0.85rem;
		}

		.control-description {
			font-size: 0.7rem;
		}

		.export-btn {
			padding: 0.5rem 0.85rem;
			font-size: 0.8rem;
		}

		.toggle-switch {
			gap: 0.5rem;
		}

		.toggle-slider {
			width: 40px;
			height: 22px;
		}

		.toggle-slider::after {
			width: 18px;
			height: 18px;
		}

		.toggle-switch input:checked + .toggle-slider::after {
			left: 20px;
		}

		.toggle-label {
			font-size: 0.75rem;
			min-width: auto;
		}

		/* developer section mobile */
		.token-form {
			gap: 0.75rem;
		}

		.token-name-input {
			min-width: 100px;
			font-size: 0.85rem;
			padding: 0.45rem 0.6rem;
		}

		.expires-label {
			font-size: 0.8rem;
		}

		.expires-select {
			font-size: 0.8rem;
			padding: 0.4rem 0.6rem;
		}

		.create-token-btn {
			padding: 0.5rem 0.85rem;
			font-size: 0.8rem;
		}

		.token-display {
			gap: 0.5rem;
		}

		.token-value {
			font-size: 0.75rem;
			padding: 0.5rem;
		}

		.copy-btn,
		.dismiss-btn {
			padding: 0.35rem 0.6rem;
			font-size: 0.75rem;
		}

		.token-warning {
			font-size: 0.75rem;
		}

		.tokens-header {
			font-size: 0.8rem;
		}

		.token-item {
			padding: 0.6rem;
			gap: 0.5rem;
		}

		.token-name {
			font-size: 0.8rem;
		}

		.token-meta {
			font-size: 0.7rem;
		}

		.revoke-btn {
			padding: 0.35rem 0.6rem;
			font-size: 0.75rem;
		}

		/* danger zone mobile */
		.delete-account-btn {
			padding: 0.5rem 0.85rem;
			font-size: 0.8rem;
		}

		.delete-warning {
			font-size: 0.8rem;
		}

		.atproto-option {
			font-size: 0.8rem;
		}

		.atproto-note,
		.atproto-warning {
			font-size: 0.75rem;
		}

		.confirm-prompt {
			font-size: 0.8rem;
		}

		.confirm-input {
			font-size: 0.85rem;
			padding: 0.6rem;
		}

		.delete-actions button {
			padding: 0.5rem 0.85rem;
			font-size: 0.8rem;
		}

		/* albums mobile */
		.albums-grid {
			grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
			gap: 0.75rem;
		}

		.album-card {
			padding: 0.75rem;
			gap: 0.5rem;
		}

		.album-title {
			font-size: 0.85rem;
		}
	}
</style>
