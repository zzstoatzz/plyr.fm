<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll, replaceState } from '$app/navigation';
	import { AtpAgent } from '@atproto/api';
	import Header from '$lib/components/Header.svelte';
	import HandleSearch from '$lib/components/HandleSearch.svelte';
	import AlbumSelect from '$lib/components/AlbumSelect.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import MigrationBanner from '$lib/components/MigrationBanner.svelte';
	import BrokenTracks from '$lib/components/BrokenTracks.svelte';
	import TagInput from '$lib/components/TagInput.svelte';
	import PdsBackfillControl from '$lib/components/PdsBackfillControl.svelte';
	import type { Track, FeaturedArtist, AlbumSummary, Playlist } from '$lib/types';
	import SensitiveImage from '$lib/components/SensitiveImage.svelte';
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
	let editImagePreviewUrl = $state<string | null>(null);
	let editRemoveImage = $state(false);
	let editSupportGate = $state(false);
	let hasUnresolvedEditFeaturesInput = $state(false);
	// profile editing state
	let displayName = $state('');
	let bio = $state('');
	let avatarUrl = $state('');
	// support link mode: 'none' | 'atprotofans' | 'custom'
	let supportLinkMode = $state<'none' | 'atprotofans' | 'custom'>('none');
	let customSupportUrl = $state('');
	let savingProfile = $state(false);
	// atprotofans eligibility - checked on mount
	let atprotofansEligible = $state(false);
	let checkingAtprotofans = $state(false);

	// album management state
	let albums = $state<AlbumSummary[]>([]);
	let loadingAlbums = $state(false);

	// playlist management state
	let playlists = $state<Playlist[]>([]);
	let loadingPlaylists = $state(false);

	// share links state
	interface ShareLinkUser {
		did: string;
		handle: string;
		display_name: string | null;
		avatar_url: string | null;
		count: number;
	}

	interface ShareLinkStats {
		code: string;
		track: Track;
		click_count: number;
		play_count: number;
		anonymous_clicks: number;
		anonymous_plays: number;
		visitors: ShareLinkUser[];
		listeners: ShareLinkUser[];
		created_at: string;
	}

	let shares = $state<ShareLinkStats[]>([]);
	let loadingShares = $state(false);
	let sharesTotal = $state(0);
	let sharesHasMore = $state(false);
	let loadingMoreShares = $state(false);
	let expandedShareCode = $state<string | null>(null);

	// export state
	let exportingMedia = $state(false);

	// account deletion state
	let showDeleteConfirm = $state(false);
	let deleteConfirmText = $state('');
	let deleteAtprotoRecords = $state(false);
	let deleting = $state(false);

	onMount(async () => {
		// check if exchange_token is in URL (from OAuth callback for regular login)
		const params = new URLSearchParams(window.location.search);
		const exchangeToken = params.get('exchange_token');
		const isDevToken = params.get('dev_token') === 'true';

		// redirect dev token callbacks to settings page
		if (exchangeToken && isDevToken) {
			window.location.href = `/settings?exchange_token=${exchangeToken}&dev_token=true`;
			return;
		}

		if (exchangeToken) {
			// regular login - exchange token for session
			try {
				const exchangeResponse = await fetch(`${API_URL}/auth/exchange`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({ exchange_token: exchangeToken })
				});

				if (exchangeResponse.ok) {
					// invalidate all load functions so they rerun with the new session cookie
					await invalidateAll();
					await auth.initialize();
					await preferences.fetch();
				}
			} catch (_e) {
				console.error('failed to exchange token:', _e);
			}

			replaceState('/portal', {});
		}

		// wait for auth to finish loading
		while (auth.loading) {
			await new Promise(resolve => setTimeout(resolve, 50));
		}

		if (!auth.isAuthenticated) {
			window.location.href = '/login';
			return;
		}

		try {
			await Promise.all([
				loadMyTracks(),
				loadArtistProfile(),
				loadMyAlbums(),
				loadMyPlaylists(),
				loadShares()
			]);
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

	async function checkAtprotofansEligibility() {
		if (!auth.user?.did) return;
		checkingAtprotofans = true;
		try {
			// resolve DID to find user's PDS (com.atprotofans.profile isn't indexed by Bluesky appview)
			const didDoc = await fetch(`https://plc.directory/${auth.user.did}`).then((r) => r.json());
			const pdsService = didDoc?.service?.find(
				(s: { id: string }) => s.id === '#atproto_pds'
			);
			const pdsUrl = pdsService?.serviceEndpoint;
			if (!pdsUrl) {
				atprotofansEligible = false;
				return;
			}

			// use SDK agent pointed at user's PDS to fetch the record
			const agent = new AtpAgent({ service: pdsUrl });
			const response = await agent.com.atproto.repo.getRecord({
				repo: auth.user.did,
				collection: 'com.atprotofans.profile',
				rkey: 'self'
			});
			const value = response.data.value as { acceptingSupporters?: boolean } | undefined;
			atprotofansEligible = value?.acceptingSupporters === true;
		} catch (_e) {
			// record doesn't exist or other error - not eligible
			atprotofansEligible = false;
		} finally {
			checkingAtprotofans = false;
		}
	}

	async function loadArtistProfile() {
		try {
			const [artistRes, prefsRes] = await Promise.all([
				fetch(`${API_URL}/artists/me`, { credentials: 'include' }),
				fetch(`${API_URL}/preferences/`, { credentials: 'include' }),
				checkAtprotofansEligibility()
			]);

			if (artistRes.ok) {
				const artist = await artistRes.json();
				displayName = artist.display_name;
				bio = artist.bio || '';
				avatarUrl = artist.avatar_url || '';
			}

			if (prefsRes.ok) {
				const prefs = await prefsRes.json();
				// parse support_url into mode + custom URL
				const url = prefs.support_url || '';
				if (!url) {
					supportLinkMode = 'none';
					customSupportUrl = '';
				} else if (url === 'atprotofans') {
					supportLinkMode = 'atprotofans';
					customSupportUrl = '';
				} else {
					supportLinkMode = 'custom';
					customSupportUrl = url;
				}
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

	async function loadMyPlaylists() {
		loadingPlaylists = true;
		try {
			const response = await fetch(`${API_URL}/lists/playlists`, {
				credentials: 'include'
			});
			if (response.ok) {
				playlists = await response.json();
			}
		} catch (_e) {
			console.error('failed to load playlists:', _e);
		} finally {
			loadingPlaylists = false;
		}
	}

	async function loadShares(append = false) {
		if (append) {
			loadingMoreShares = true;
		} else {
			loadingShares = true;
		}
		try {
			const offset = append ? shares.length : 0;
			const response = await fetch(`${API_URL}/tracks/me/shares?limit=20&offset=${offset}`, {
				credentials: 'include'
			});
			if (response.ok) {
				const data = await response.json();
				if (append) {
					shares = [...shares, ...data.shares];
				} else {
					shares = data.shares;
				}
				sharesTotal = data.total;
				sharesHasMore = data.has_more;
			}
		} catch (_e) {
			console.error('failed to load shares:', _e);
		} finally {
			loadingShares = false;
			loadingMoreShares = false;
		}
	}

	function toggleShareDetails(code: string) {
		expandedShareCode = expandedShareCode === code ? null : code;
	}

	async function saveProfile(e: SubmitEvent) {
		e.preventDefault();
		savingProfile = true;

		try {
			// compute support_url value based on mode
			let supportUrlValue = '';
			if (supportLinkMode === 'atprotofans') {
				supportUrlValue = 'atprotofans';
			} else if (supportLinkMode === 'custom') {
				const trimmed = customSupportUrl.trim();
				if (trimmed && !trimmed.startsWith('https://')) {
					toast.error('custom support link must start with https://');
					savingProfile = false;
					return;
				}
				supportUrlValue = trimmed;
			}

			// save artist profile and support URL in parallel
			const [artistRes, prefsRes] = await Promise.all([
				fetch(`${API_URL}/artists/me`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({
						display_name: displayName,
						bio: bio || null,
						avatar_url: avatarUrl || null
					})
				}),
				fetch(`${API_URL}/preferences/`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({ support_url: supportUrlValue })
				})
			]);

			if (artistRes.ok && prefsRes.ok) {
				toast.success('profile updated');
			} else if (!artistRes.ok) {
				const errorData = await artistRes.json();
				toast.error(errorData.detail || 'failed to update profile');
			} else {
				toast.error('failed to update support link');
			}
		} catch (e) {
			toast.error(`network error: ${e instanceof Error ? e.message : 'unknown error'}`);
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
		editSupportGate = track.support_gate !== null && track.support_gate !== undefined;
	}

	function cancelEdit() {
		editingTrackId = null;
		editTitle = '';
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
		// send support_gate - null to remove, or {type: "any"} to enable
		if (editSupportGate) {
			formData.append('support_gate', JSON.stringify({ type: 'any' }));
		} else {
			formData.append('support_gate', 'null');
		}
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

			const { deleted } = result;
			const summary = [
				deleted.tracks && `${deleted.tracks} tracks`,
				deleted.albums && `${deleted.albums} albums`,
				deleted.likes && `${deleted.likes} likes`,
				deleted.comments && `${deleted.comments} comments`,
				deleted.atproto_records && `${deleted.atproto_records} ATProto records`
			].filter(Boolean).join(', ');

			toast.success(`account deleted: ${summary || 'all data removed'}`);

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
				<h2>profile</h2>
				<a href="/u/{auth.user.handle}" class="view-profile-link">view public profile</a>
			</div>

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

				<div class="form-group support-link-group" role="group" aria-labelledby="support-link-label">
					<span id="support-link-label" class="form-label">support link (optional)</span>
					<div class="support-options">
						<label class="support-option">
							<input
								type="radio"
								name="support-mode"
								value="none"
								bind:group={supportLinkMode}
								disabled={savingProfile}
							/>
							<span>none</span>
						</label>
						<label class="support-option" class:disabled={!atprotofansEligible && supportLinkMode !== 'atprotofans'}>
							<input
								type="radio"
								name="support-mode"
								value="atprotofans"
								bind:group={supportLinkMode}
								disabled={savingProfile || (!atprotofansEligible && supportLinkMode !== 'atprotofans')}
							/>
							<span>atprotofans</span>
							{#if checkingAtprotofans}
								<span class="support-status">checking...</span>
							{:else if !atprotofansEligible}
								<a href="https://atprotofans.com" target="_blank" rel="noopener" class="support-setup-link">set up</a>
							{:else}
								<a href="https://atprotofans.com/u/{auth.user?.did}" target="_blank" rel="noopener" class="support-status-link">profile ready</a>
							{/if}
						</label>
						<label class="support-option">
							<input
								type="radio"
								name="support-mode"
								value="custom"
								bind:group={supportLinkMode}
								disabled={savingProfile}
							/>
							<span>custom link</span>
						</label>
					</div>
					{#if supportLinkMode === 'custom'}
						<input
							id="custom-support-url"
							type="url"
							bind:value={customSupportUrl}
							disabled={savingProfile}
							placeholder="https://ko-fi.com/yourname"
							class="custom-support-input"
						/>
					{/if}
					<p class="hint">
						{#if supportLinkMode === 'atprotofans'}
							uses <a href="https://atprotofans.com" target="_blank" rel="noopener">atprotofans</a> for ATProto-native support
						{:else if supportLinkMode === 'custom'}
							link to Ko-fi, Patreon, or similar - shown on your profile
						{:else}
							no support link will be shown on your profile
						{/if}
					</p>
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
										{#if atprotofansEligible || track.support_gate}
											<div class="edit-field-group">
												<span class="edit-label">supporter access</span>
												<label class="toggle-row">
													<input
														type="checkbox"
														bind:checked={editSupportGate}
													/>
													<span>only supporters can play this track</span>
												</label>
												{#if editSupportGate}
													<p class="field-hint">
														only users who support you via <a href="https://atprotofans.com" target="_blank" rel="noopener">atprotofans</a> can play this track
													</p>
												{/if}
											</div>
										{/if}
									</div>
									<div class="edit-actions">
										<button
											type="button"
											class="edit-cancel-btn"
											onclick={cancelEdit}
										>
											cancel
										</button>
										<button
											type="button"
											class="edit-save-btn"
											onclick={() => saveTrackEdit(track.id)}
											disabled={hasUnresolvedEditFeaturesInput}
											title={hasUnresolvedEditFeaturesInput ? "please select or clear featured artist" : "save changes"}
										>
											save changes
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
						<a href="/u/{auth.user?.handle}/album/{album.slug}" class="album-card">
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
							<div class="album-info">
								<h3 class="album-title">{album.title}</h3>
								<p class="album-stats">
									{album.track_count} {album.track_count === 1 ? 'track' : 'tracks'} •
									{album.total_plays} {album.total_plays === 1 ? 'play' : 'plays'}
								</p>
							</div>
						</a>
					{/each}
				</div>
			{/if}
		</section>

		<section class="playlists-section">
			<div class="section-header">
				<h2>your playlists</h2>
				<a href="/library" class="view-playlists-link">manage playlists →</a>
			</div>

			{#if loadingPlaylists}
				<div class="loading-container">
					<WaveLoading size="lg" message="loading playlists..." />
				</div>
			{:else if playlists.length === 0}
				<p class="empty">no playlists yet - <a href="/library">create a new playlist</a></p>
			{:else}
				<div class="playlists-grid">
					{#each playlists as playlist}
						<a href="/playlist/{playlist.id}" class="playlist-card">
							{#if playlist.image_url}
								<SensitiveImage src={playlist.image_url} compact tooltipPosition="above">
									<img src={playlist.image_url} alt="{playlist.name} cover" class="playlist-cover" />
								</SensitiveImage>
							{:else}
								<div class="playlist-cover-placeholder">
									<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
										<line x1="8" y1="6" x2="21" y2="6"></line>
										<line x1="8" y1="12" x2="21" y2="12"></line>
										<line x1="8" y1="18" x2="21" y2="18"></line>
										<line x1="3" y1="6" x2="3.01" y2="6"></line>
										<line x1="3" y1="12" x2="3.01" y2="12"></line>
										<line x1="3" y1="18" x2="3.01" y2="18"></line>
									</svg>
								</div>
							{/if}
							<div class="playlist-info">
								<h3 class="playlist-title">{playlist.name}</h3>
								<p class="playlist-stats">{playlist.track_count} {playlist.track_count === 1 ? 'track' : 'tracks'}</p>
							</div>
						</a>
					{/each}
				</div>
			{/if}
		</section>

		<section class="shares-section">
			<div class="section-header">
				<h2>share links</h2>
				{#if sharesTotal > 0}
					<span class="shares-count">{sharesTotal} {sharesTotal === 1 ? 'link' : 'links'}</span>
				{/if}
			</div>

			{#if loadingShares}
				<div class="loading-container">
					<WaveLoading size="lg" message="loading shares..." />
				</div>
			{:else if shares.length === 0}
				<p class="empty">no share links yet - share a track to start tracking who listens</p>
			{:else}
				<div class="shares-list">
					{#each shares as share}
						<div class="share-item">
							<button
								class="share-item-header"
								onclick={() => toggleShareDetails(share.code)}
								aria-expanded={expandedShareCode === share.code}
							>
								<div class="share-track-info">
									{#if share.track.image_url}
										<img src={share.track.image_url} alt="" class="share-track-cover" />
									{:else}
										<div class="share-track-cover-placeholder">
											<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
												<path d="M9 18V5l12-2v13"></path>
												<circle cx="6" cy="18" r="3"></circle>
												<circle cx="18" cy="16" r="3"></circle>
											</svg>
										</div>
									{/if}
									<div class="share-track-text">
										<a href="/track/{share.track.id}" class="share-track-title">{share.track.title}</a>
										<span class="share-track-artist">{share.track.artist}</span>
									</div>
								</div>
								<div class="share-stats">
									<span class="share-stat" title="clicks">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
											<polyline points="10 17 15 12 10 7"></polyline>
											<line x1="15" y1="12" x2="3" y2="12"></line>
										</svg>
										{share.click_count}
									</span>
									<span class="share-stat" title="plays">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
											<path d="M8 5v14l11-7z"/>
										</svg>
										{share.play_count}
									</span>
								</div>
								<svg
									class="expand-icon"
									class:expanded={expandedShareCode === share.code}
									width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
								>
									<polyline points="6 9 12 15 18 9"></polyline>
								</svg>
							</button>

							{#if expandedShareCode === share.code}
								<div class="share-details">
									<div class="share-link-row">
										<code class="share-link-url">{window.location.origin}/track/{share.track.id}?ref={share.code}</code>
										<button
											class="copy-link-btn"
											onclick={async () => {
												await navigator.clipboard.writeText(`${window.location.origin}/track/${share.track.id}?ref=${share.code}`);
												toast.success('link copied');
											}}
										>
											copy
										</button>
									</div>

									<div class="share-stats-grid">
										<!-- visitors (clicks) -->
										<div class="stat-group">
											<div class="stat-header">
												<span class="stat-label">visitors</span>
												<span class="stat-count">{share.click_count}</span>
											</div>
											{#if share.visitors.length > 0}
												<div class="user-avatars">
													{#each share.visitors as user}
														<a
															href="/u/{user.handle}"
															class="user-circle"
															title="{user.display_name || user.handle} ({user.count} {user.count === 1 ? 'click' : 'clicks'})"
														>
															{#if user.avatar_url}
																<img src={user.avatar_url} alt="" />
															{:else}
																<span>{(user.display_name || user.handle).charAt(0).toUpperCase()}</span>
															{/if}
														</a>
													{/each}
												</div>
											{/if}
											{#if share.anonymous_clicks > 0}
												<span class="anonymous-count">+{share.anonymous_clicks} anonymous</span>
											{/if}
											{#if share.visitors.length === 0 && share.anonymous_clicks === 0}
												<span class="no-data">none yet</span>
											{/if}
										</div>

										<!-- listeners (plays) -->
										<div class="stat-group">
											<div class="stat-header">
												<span class="stat-label">listeners</span>
												<span class="stat-count">{share.play_count}</span>
											</div>
											{#if share.listeners.length > 0}
												<div class="user-avatars">
													{#each share.listeners as user}
														<a
															href="/u/{user.handle}"
															class="user-circle"
															title="{user.display_name || user.handle} ({user.count} {user.count === 1 ? 'play' : 'plays'})"
														>
															{#if user.avatar_url}
																<img src={user.avatar_url} alt="" />
															{:else}
																<span>{(user.display_name || user.handle).charAt(0).toUpperCase()}</span>
															{/if}
														</a>
													{/each}
												</div>
											{/if}
											{#if share.anonymous_plays > 0}
												<span class="anonymous-count">+{share.anonymous_plays} anonymous</span>
											{/if}
											{#if share.listeners.length === 0 && share.anonymous_plays === 0}
												<span class="no-data">none yet</span>
											{/if}
										</div>
									</div>

									<div class="share-meta">
										<span class="share-created">created {new Date(share.created_at).toLocaleDateString()}</span>
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>

				{#if sharesHasMore}
					<button
						class="load-more-btn"
						onclick={() => loadShares(true)}
						disabled={loadingMoreShares}
					>
						{loadingMoreShares ? 'loading...' : 'load more'}
					</button>
				{/if}
			{/if}
		</section>

		<section class="data-section">
			<div class="section-header">
				<h2>your data</h2>
				<a href="/settings" class="settings-link">all settings →</a>
			</div>

			{#if tracks.length > 0}
				<PdsBackfillControl tracks={tracks} onComplete={loadMyTracks} />

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
								<input type="checkbox" bind:checked={deleteAtprotoRecords} />
								<span>also delete records from my ATProto repo</span>
							</label>
							<p class="atproto-note">
								you can manage your PDS records directly via <a href="https://pdsls.dev/at://{auth.user?.did}" target="_blank" rel="noopener">pdsls.dev</a>, or let us clean them up for you.
							</p>
							{#if deleteAtprotoRecords}
								<p class="atproto-warning">
									this removes track, like, and comment records from your PDS. other users' likes and comments that reference your tracks will become orphaned.
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
								class="cancel-delete-btn"
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
		font-size: var(--text-sm);
		padding: 0.35rem 0.6rem;
		background: var(--bg-tertiary);
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-default);
		transition: all 0.15s;
		white-space: nowrap;
	}

	.view-profile-link:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--bg-hover);
	}

	.settings-link {
		color: var(--text-secondary);
		text-decoration: none;
		font-size: var(--text-sm);
		padding: 0.35rem 0.6rem;
		background: var(--bg-tertiary);
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-default);
		transition: all 0.15s;
		white-space: nowrap;
	}

	.settings-link:hover {
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
		border-radius: var(--radius-md);
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
		border-radius: var(--radius-md);
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
		font-size: var(--text-base);
		color: var(--text-primary);
	}

	.upload-card-subtitle {
		display: block;
		font-size: var(--text-sm);
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
		border-radius: var(--radius-md);
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
		font-size: var(--text-sm);
	}

	input[type='text'],
	input[type='url'],
	textarea {
		width: 100%;
		padding: 0.6rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: var(--text-base);
		font-family: inherit;
		transition: all 0.15s;
	}

	input[type='text']:focus,
	input[type='url']:focus,
	textarea:focus {
		outline: none;
		border-color: var(--accent);
	}

	input[type='text']:disabled,
	input[type='url']:disabled,
	textarea:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	textarea {
		resize: vertical;
		min-height: 80px;
	}

	.hint {
		margin-top: 0.35rem;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.hint a {
		color: var(--accent);
		text-decoration: none;
	}

	.hint a:hover {
		text-decoration: underline;
	}

	/* support link options */
	.support-link-group .form-label {
		display: block;
		color: var(--text-secondary);
		margin-bottom: 0.6rem;
		font-size: var(--text-sm);
	}

	.support-options {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.support-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		cursor: pointer;
		transition: all 0.15s;
		margin-bottom: 0;
	}

	.support-option:hover {
		border-color: var(--border-emphasis);
	}

	.support-option:has(input:checked) {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 8%, var(--bg-primary));
	}

	.support-option input[type='radio'] {
		width: 16px;
		height: 16px;
		accent-color: var(--accent);
		margin: 0;
	}

	.support-option span {
		font-size: var(--text-base);
		color: var(--text-primary);
	}

	.support-status {
		margin-left: auto;
		font-size: var(--text-xs);
		color: var(--text-tertiary);
	}

	.support-setup-link,
	.support-status-link {
		margin-left: auto;
		font-size: var(--text-xs);
		text-decoration: none;
	}

	.support-setup-link {
		color: var(--accent);
	}

	.support-status-link {
		color: var(--success, #22c55e);
	}

	.support-setup-link:hover,
	.support-status-link:hover {
		text-decoration: underline;
	}

	.support-option.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.support-option.disabled input {
		cursor: not-allowed;
	}

	.custom-support-input {
		width: 100%;
		padding: 0.6rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: var(--text-base);
		font-family: inherit;
		transition: all 0.15s;
		margin-bottom: 0.5rem;
	}

	.custom-support-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.custom-support-input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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
		border-radius: var(--radius-full);
		object-fit: cover;
		border: 2px solid var(--border-default);
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

	/* form submit buttons only */
	form button[type="submit"] {
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

	form button[type="submit"]:hover:not(:disabled) {
		background: var(--accent-hover);
		transform: translateY(-1px);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	form button[type="submit"]:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	form button[type="submit"]:active:not(:disabled) {
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
		border-radius: var(--radius-md);
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
		font-size: var(--text-sm);
		color: var(--text-secondary);
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
		margin-top: 0.25rem;
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
		color: var(--text-muted);
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
		border-radius: var(--radius-md);
		padding: 1rem;
		transition: all 0.2s;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		text-decoration: none;
		color: inherit;
	}

	.album-card:hover {
		border-color: var(--accent);
		transform: translateY(-2px);
	}

	.album-cover {
		width: 100%;
		aspect-ratio: 1;
		border-radius: var(--radius-base);
		object-fit: cover;
	}

	.album-cover-placeholder {
		width: 100%;
		aspect-ratio: 1;
		border-radius: var(--radius-base);
		background: linear-gradient(135deg, rgba(var(--accent-rgb, 139, 92, 246), 0.15), rgba(var(--accent-rgb, 139, 92, 246), 0.05));
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--accent);
	}

	.album-info {
		min-width: 0;
		flex: 1;
	}

	.album-title {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--text-primary);
		margin: 0 0 0.25rem 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.album-stats {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		margin: 0;
	}

	/* playlists section */
	.playlists-section {
		margin-top: 3rem;
	}

	.playlists-section h2 {
		font-size: var(--text-page-heading);
		margin-bottom: 1.5rem;
	}

	.view-playlists-link {
		color: var(--text-secondary);
		text-decoration: none;
		font-size: var(--text-sm);
		padding: 0.35rem 0.6rem;
		background: var(--bg-tertiary);
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-default);
		transition: all 0.15s;
		white-space: nowrap;
	}

	.view-playlists-link:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--bg-hover);
	}

	.playlists-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 1.5rem;
	}

	.playlist-card {
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		padding: 1rem;
		transition: all 0.2s;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		text-decoration: none;
		color: inherit;
	}

	.playlist-card:hover {
		border-color: var(--accent);
		transform: translateY(-2px);
	}

	.playlist-cover {
		width: 100%;
		aspect-ratio: 1;
		border-radius: var(--radius-base);
		object-fit: cover;
	}

	.playlist-cover-placeholder {
		width: 100%;
		aspect-ratio: 1;
		border-radius: var(--radius-base);
		background: linear-gradient(135deg, rgba(var(--accent-rgb, 139, 92, 246), 0.15), rgba(var(--accent-rgb, 139, 92, 246), 0.05));
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--accent);
	}

	.playlist-info {
		min-width: 0;
		flex: 1;
	}

	.playlist-title {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--text-primary);
		margin: 0 0 0.25rem 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.playlist-stats {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		margin: 0;
	}

	/* shares section */
	.shares-section {
		margin-top: 3rem;
	}

	.shares-section h2 {
		font-size: var(--text-page-heading);
		margin-bottom: 1.5rem;
	}

	.shares-count {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		font-weight: 400;
	}

	.shares-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.share-item {
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.share-item-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		width: 100%;
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		color: inherit;
		transition: background 0.15s;
	}

	.share-item-header:hover {
		background: var(--bg-hover);
	}

	.share-track-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex: 1;
		min-width: 0;
	}

	.share-track-cover {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-sm);
		object-fit: cover;
		flex-shrink: 0;
	}

	.share-track-cover-placeholder {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-sm);
		background: var(--bg-hover);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.share-track-text {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.share-track-title {
		font-size: var(--text-base);
		font-weight: 500;
		color: var(--text-primary);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.share-track-title:hover {
		color: var(--accent);
	}

	.share-track-artist {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.share-stats {
		display: flex;
		gap: 1rem;
		flex-shrink: 0;
	}

	.share-stat {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.share-stat svg {
		opacity: 0.6;
	}

	.expand-icon {
		flex-shrink: 0;
		color: var(--text-muted);
		transition: transform 0.2s;
	}

	.expand-icon.expanded {
		transform: rotate(180deg);
	}

	.share-details {
		padding: 0.75rem 1rem 1rem;
		border-top: 1px solid var(--border-subtle);
		background: var(--bg-secondary);
	}

	.share-link-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		padding: 0.5rem;
		background: var(--bg-tertiary);
		border-radius: var(--radius-sm);
	}

	.share-link-url {
		flex: 1;
		font-size: var(--text-xs);
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		background: none;
		padding: 0;
	}

	.copy-link-btn {
		flex-shrink: 0;
		padding: 0.25rem 0.5rem;
		font-size: var(--text-xs);
		font-family: inherit;
		background: var(--accent);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.copy-link-btn:hover {
		opacity: 0.9;
	}

	.share-stats-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}

	.stat-group {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.stat-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.stat-label {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-secondary);
	}

	.stat-count {
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	.user-avatars {
		display: flex;
		justify-content: flex-start;
		overflow-x: auto;
		max-width: 100%;
		padding: 0.25rem 0;
		scrollbar-width: none;
	}

	.user-avatars::-webkit-scrollbar {
		display: none;
	}

	.user-circle {
		width: 28px;
		height: 28px;
		border-radius: var(--radius-full);
		border: 2px solid var(--bg-secondary);
		background: var(--bg-tertiary);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		margin-left: -6px;
		transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), z-index 0s;
		position: relative;
		text-decoration: none;
		flex-shrink: 0;
	}

	.user-circle:first-child {
		margin-left: 0;
	}

	.user-circle:hover {
		transform: translateY(-2px) scale(1.08);
		z-index: 10;
	}

	.user-circle img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.user-circle span {
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--text-secondary);
	}

	.anonymous-count {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.no-data {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.share-meta {
		margin-top: 0.75rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border-subtle);
	}

	.share-created {
		font-size: var(--text-xs);
		color: var(--text-muted);
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
		border-radius: var(--radius-md);
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
		font-size: var(--text-base);
		font-weight: 600;
		margin: 0 0 0.15rem 0;
		color: var(--text-primary);
	}

	.control-description {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		margin: 0;
		line-height: 1.4;
	}

	.export-btn {
		padding: 0.6rem 1.25rem;
		background: var(--accent);
		color: var(--text-primary);
		border: none;
		border-radius: var(--radius-base);
		font-size: var(--text-base);
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
		border-color: color-mix(in srgb, var(--error) 30%, transparent);
		flex-direction: column;
		align-items: stretch;
	}

	.danger-zone .control-info h3 {
		color: var(--error);
	}

	.danger-zone .control-description a {
		color: var(--text-tertiary);
	}

	.danger-zone .control-description a:hover {
		color: var(--text-secondary);
	}

	.delete-account-btn {
		padding: 0.6rem 1.25rem;
		background: transparent;
		color: var(--error);
		border: 1px solid var(--error);
		border-radius: var(--radius-base);
		font-family: inherit;
		font-size: var(--text-base);
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		align-self: flex-end;
	}

	.delete-account-btn:hover {
		background: color-mix(in srgb, var(--error) 10%, transparent);
	}

	.delete-confirm-panel {
		margin-top: 1rem;
		padding: 1rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
	}

	.delete-warning {
		margin: 0 0 1rem;
		color: var(--error);
		font-size: var(--text-base);
		line-height: 1.5;
	}

	.atproto-section {
		margin-bottom: 1rem;
		padding: 0.75rem;
		background: var(--bg-tertiary);
		border-radius: var(--radius-base);
	}

	.atproto-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--text-base);
		color: var(--text-primary);
		cursor: pointer;
	}

	.atproto-option input {
		width: 16px;
		height: 16px;
		accent-color: var(--accent);
	}

	.atproto-note {
		margin: 0.5rem 0 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	.atproto-note a {
		color: var(--accent);
		text-decoration: none;
	}

	.atproto-note a:hover {
		text-decoration: underline;
	}

	.atproto-warning {
		margin: 0.5rem 0 0;
		padding: 0.5rem;
		background: color-mix(in srgb, var(--warning) 10%, transparent);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		color: var(--warning);
	}

	.confirm-prompt {
		margin: 0 0 0.5rem;
		font-size: var(--text-base);
		color: var(--text-secondary);
	}

	.confirm-input {
		width: 100%;
		padding: 0.6rem 0.75rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-primary);
		font-size: var(--text-base);
		font-family: inherit;
		margin-bottom: 1rem;
	}

	.confirm-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.delete-actions {
		display: flex;
		gap: 0.75rem;
	}

	.cancel-delete-btn {
		flex: 1;
		padding: 0.6rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-secondary);
		font-family: inherit;
		font-size: var(--text-base);
		cursor: pointer;
		transition: all 0.15s;
	}

	.cancel-delete-btn:hover:not(:disabled) {
		border-color: var(--text-secondary);
	}

	.cancel-delete-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.confirm-delete-btn {
		flex: 1;
		padding: 0.6rem;
		background: var(--error);
		border: none;
		border-radius: var(--radius-base);
		color: white;
		font-family: inherit;
		font-size: var(--text-base);
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
	}

	.confirm-delete-btn:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.confirm-delete-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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
			font-size: var(--text-2xl);
		}

		.profile-section h2,
		.tracks-section h2,
		.albums-section h2,
		.playlists-section h2,
		.data-section h2 {
			font-size: var(--text-xl);
		}

		.section-header {
			margin-bottom: 0.75rem;
		}

		.view-profile-link {
			font-size: var(--text-xs);
			padding: 0.3rem 0.5rem;
		}

		form {
			padding: 1rem;
		}

		.form-group {
			margin-bottom: 0.85rem;
		}

		label {
			font-size: var(--text-sm);
			margin-bottom: 0.3rem;
		}

		input[type='text'],
		input[type='url'],
		textarea {
			padding: 0.5rem 0.6rem;
			font-size: var(--text-base);
		}

		textarea {
			min-height: 70px;
		}

		.hint {
			font-size: var(--text-xs);
		}

		.avatar-preview img {
			width: 48px;
			height: 48px;
		}

		button[type="submit"] {
			padding: 0.6rem;
			font-size: var(--text-base);
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
			font-size: var(--text-base);
		}

		.upload-card-subtitle {
			font-size: var(--text-xs);
		}

		/* tracks mobile */
		.tracks-section,
		.albums-section,
		.playlists-section,
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
			gap: 0.6rem;
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

		/* data section mobile */
		.data-control {
			padding: 0.85rem 1rem;
			gap: 0.6rem;
		}

		.control-info h3 {
			font-size: var(--text-sm);
		}

		.control-description {
			font-size: var(--text-xs);
		}

		.export-btn {
			padding: 0.5rem 0.85rem;
			font-size: var(--text-sm);
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
			font-size: var(--text-sm);
		}

		/* playlists mobile */
		.playlists-grid {
			grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
			gap: 0.75rem;
		}

		.playlist-card {
			padding: 0.75rem;
			gap: 0.5rem;
		}

		.playlist-title {
			font-size: var(--text-sm);
		}

		.playlist-stats {
			font-size: var(--text-xs);
		}

		.view-playlists-link {
			font-size: var(--text-xs);
			padding: 0.3rem 0.5rem;
		}
	}
</style>
