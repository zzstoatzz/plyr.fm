<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll, replaceState } from '$app/navigation';
	import { AtpAgent } from '@atproto/api';
	import Header from '$lib/components/Header.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import MigrationBanner from '$lib/components/MigrationBanner.svelte';
	import BrokenTracks from '$lib/components/BrokenTracks.svelte';
	import PdsAudioUploadsToggle from '$lib/components/PdsAudioUploadsToggle.svelte';
	import PdsBackfillControl from '$lib/components/PdsBackfillControl.svelte';
	import CopyrightSection from '$lib/components/CopyrightSection.svelte';
	import PlaylistsSection from '$lib/components/portal/PlaylistsSection.svelte';
	import TracksSection from '$lib/components/portal/TracksSection.svelte';
	import SharesSection from '$lib/components/portal/SharesSection.svelte';
	import type { Track, AlbumSummary } from '$lib/types';
	import { API_URL } from '$lib/config';
	import { toast } from '$lib/toast.svelte';
	import { auth } from '$lib/auth.svelte';
	import { preferences } from '$lib/preferences.svelte'; import { getReturnUrl, clearReturnUrl } from '$lib/utils/return-url';

	let loading = $state(true);
	let error = $state('');
	let tracks = $state<Track[]>([]);
	let tracksTotal = $state(0);
	let tracksHasMore = $state(false);
	let loadingTracks = $state(false);
	let loadingMoreTracks = $state(false);
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
		const isScopeUpgrade = params.get('scope_upgraded') === 'true';

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
					await auth.refresh();
					await preferences.fetch();
					if (isScopeUpgrade) {
						toast.success('copyright paradigm configured');
					} else {
						const r = getReturnUrl();
						if (r) {
							clearReturnUrl();
							window.location.href = r;
							return;
						}
					}
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
				loadMyAlbums()
			]);
		} catch (_e) {
			console.error('error loading portal data:', _e);
			error = 'failed to load portal data';
		} finally {
			loading = false;
		}
	});

	async function loadMyTracks(append = false) {
		if (append) {
			loadingMoreTracks = true;
		} else {
			loadingTracks = true;
		}
		try {
			const offset = append ? tracks.length : 0;
			const response = await fetch(`${API_URL}/tracks/me?limit=10&offset=${offset}`, {
				credentials: 'include'
			});
			if (response.ok) {
				const data = await response.json();
				if (append) {
					tracks = [...tracks, ...data.tracks];
				} else {
					tracks = data.tracks;
				}
				tracksTotal = data.total;
				tracksHasMore = data.has_more;
			}
		} catch (_e) {
			console.error('failed to load tracks:', _e);
		} finally {
			loadingTracks = false;
			loadingMoreTracks = false;
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

	async function reloadTracksAndAlbums() {
		await loadMyTracks();
		await loadMyAlbums();
	}

	async function logout() {
		await auth.logout();
		window.location.href = '/';
	}

	async function exportAllMedia() {
		if (exportingMedia) return;

		const trackCount = tracksTotal || tracks.length;
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
						maxlength="2560"
					></textarea>
					{#if bio.length > 0}
						<div class="char-count">{bio.length} / 2560</div>
					{/if}
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

		<CopyrightSection />

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

		<TracksSection
			tracks={tracks}
			tracksTotal={tracksTotal}
			tracksHasMore={tracksHasMore}
			loadingTracks={loadingTracks}
			loadingMoreTracks={loadingMoreTracks}
			albums={albums}
			atprotofansEligible={atprotofansEligible}
			onLoadMore={() => loadMyTracks(true)}
			onTracksChanged={reloadTracksAndAlbums}
		/>

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

		<PlaylistsSection />

		<SharesSection />

		<section class="data-section">
			<div class="section-header">
				<h2>your data</h2>
				<a href="/settings" class="settings-link">all settings →</a>
			</div>

			{#if tracksTotal > 0}
				<div class="data-control">
					<PdsAudioUploadsToggle />
				</div>
				<PdsBackfillControl tracks={tracks} onComplete={loadMyTracks} />

				<div class="data-control">
					<div class="control-info">
						<h3>export tracks</h3>
						<p class="control-description">
							{tracksTotal === 1 ? 'download your track as a zip archive' : `download all ${tracksTotal} tracks as a zip archive`}
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
						<a href="https://docs.plyr.fm/artists#leaving" target="_blank" rel="noopener">learn more</a>
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

	.char-count {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		text-align: right;
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
		padding: 0.6rem 1.25rem; background: var(--accent); color: var(--bg-primary);
		border: none; border-radius: var(--radius-base); font-family: inherit;
		font-size: var(--text-base); font-weight: 600; cursor: pointer;
		transition: all 0.2s; white-space: nowrap; width: auto;
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
		.albums-section h2,
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

		.albums-section,
		.data-section {
			margin-top: 2rem;
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

	}
</style>
