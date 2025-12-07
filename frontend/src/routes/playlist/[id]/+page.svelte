<script lang="ts">
	import Header from '$lib/components/Header.svelte';
	import { auth } from '$lib/auth.svelte';
	import { goto } from '$app/navigation';
	import { API_URL } from '$lib/config';
	import type { PageData } from './$types';
	import type { PlaylistWithTracks, PlaylistTrack } from '$lib/types';

	let { data }: { data: PageData } = $props();
	let playlist = $state<PlaylistWithTracks>(data.playlist);
	let tracks = $state<PlaylistTrack[]>(data.playlist.tracks);

	// search state
	let showSearch = $state(false);
	let searchQuery = $state('');
	let searchResults = $state<any[]>([]);
	let searching = $state(false);
	let searchError = $state('');

	// UI state
	let deleting = $state(false);
	let addingTrack = $state<number | null>(null);
	let removingTrack = $state<string | null>(null);
	let showDeleteConfirm = $state(false);

	async function handleLogout() {
		await auth.logout();
		window.location.href = '/';
	}

	async function searchTracks() {
		if (!searchQuery.trim() || searchQuery.trim().length < 2) {
			searchResults = [];
			return;
		}

		searching = true;
		searchError = '';

		try {
			const response = await fetch(`${API_URL}/search?q=${encodeURIComponent(searchQuery)}&type=tracks&limit=10`, {
				credentials: 'include'
			});

			if (!response.ok) {
				throw new Error('search failed');
			}

			const data = await response.json();
			// filter out tracks already in playlist
			const existingUris = new Set(tracks.map(t => t.atproto_record_uri));
			searchResults = data.results.filter((r: any) => r.type === 'track' && !existingUris.has(r.atproto_record_uri));
		} catch (e) {
			searchError = 'failed to search tracks';
			searchResults = [];
		} finally {
			searching = false;
		}
	}

	async function addTrack(track: any) {
		addingTrack = track.id;

		try {
			// first fetch full track details to get ATProto URI and CID
			const trackResponse = await fetch(`${API_URL}/tracks/${track.id}`, {
				credentials: 'include'
			});

			if (!trackResponse.ok) {
				throw new Error('failed to fetch track details');
			}

			const trackData = await trackResponse.json();

			if (!trackData.atproto_record_uri || !trackData.atproto_record_cid) {
				throw new Error('track does not have ATProto record');
			}

			// add to playlist
			const response = await fetch(`${API_URL}/lists/playlists/${playlist.id}/tracks`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					track_uri: trackData.atproto_record_uri,
					track_cid: trackData.atproto_record_cid
				})
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.detail || 'failed to add track');
			}

			// add to local state
			tracks = [...tracks, {
				id: trackData.id,
				title: trackData.title,
				artist_name: trackData.artist,
				artist_handle: trackData.artist_handle,
				artist_did: '', // not needed for display
				duration: trackData.duration,
				image_url: trackData.image_url,
				atproto_record_uri: trackData.atproto_record_uri,
				atproto_record_cid: trackData.atproto_record_cid
			}];

			// update playlist track count
			playlist.track_count = tracks.length;

			// remove from search results
			searchResults = searchResults.filter(r => r.id !== track.id);
		} catch (e) {
			console.error('failed to add track:', e);
		} finally {
			addingTrack = null;
		}
	}

	async function removeTrack(trackUri: string) {
		removingTrack = trackUri;

		try {
			const response = await fetch(`${API_URL}/lists/playlists/${playlist.id}/tracks/${encodeURIComponent(trackUri)}`, {
				method: 'DELETE',
				credentials: 'include'
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.detail || 'failed to remove track');
			}

			// remove from local state
			tracks = tracks.filter(t => t.atproto_record_uri !== trackUri);
			playlist.track_count = tracks.length;
		} catch (e) {
			console.error('failed to remove track:', e);
		} finally {
			removingTrack = null;
		}
	}

	async function deletePlaylist() {
		deleting = true;

		try {
			const response = await fetch(`${API_URL}/lists/playlists/${playlist.id}`, {
				method: 'DELETE',
				credentials: 'include'
			});

			if (!response.ok) {
				throw new Error('failed to delete playlist');
			}

			goto('/library');
		} catch (e) {
			console.error('failed to delete playlist:', e);
			deleting = false;
			showDeleteConfirm = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			if (showSearch) {
				showSearch = false;
				searchQuery = '';
				searchResults = [];
			}
			if (showDeleteConfirm) {
				showDeleteConfirm = false;
			}
		}
	}

	// debounced search
	let searchTimeout: ReturnType<typeof setTimeout>;
	$effect(() => {
		clearTimeout(searchTimeout);
		if (searchQuery.trim().length >= 2) {
			searchTimeout = setTimeout(searchTracks, 300);
		} else {
			searchResults = [];
		}
	});

	// check if user owns this playlist
	const isOwner = $derived(auth.user?.did === playlist.owner_did);
</script>

<svelte:window on:keydown={handleKeydown} />

<svelte:head>
	<title>{playlist.name} • plyr</title>
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

<div class="page">
	<div class="page-header">
		<a href="/library" class="back-link">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="15 18 9 12 15 6"></polyline>
			</svg>
			library
		</a>

		<div class="playlist-info">
			<div class="playlist-icon">
				<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<line x1="8" y1="6" x2="21" y2="6"></line>
					<line x1="8" y1="12" x2="21" y2="12"></line>
					<line x1="8" y1="18" x2="21" y2="18"></line>
					<line x1="3" y1="6" x2="3.01" y2="6"></line>
					<line x1="3" y1="12" x2="3.01" y2="12"></line>
					<line x1="3" y1="18" x2="3.01" y2="18"></line>
				</svg>
			</div>
			<div class="playlist-meta">
				<h1>{playlist.name}</h1>
				<p>{playlist.track_count} {playlist.track_count === 1 ? 'track' : 'tracks'}</p>
			</div>
		</div>

		{#if isOwner}
			<div class="actions">
				<button class="add-btn" onclick={() => showSearch = true}>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="12" y1="5" x2="12" y2="19"></line>
						<line x1="5" y1="12" x2="19" y2="12"></line>
					</svg>
					add tracks
				</button>
				<button class="delete-btn" onclick={() => showDeleteConfirm = true}>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="3 6 5 6 21 6"></polyline>
						<path d="m19 6-.867 12.142A2 2 0 0 1 16.138 20H7.862a2 2 0 0 1-1.995-1.858L5 6"></path>
						<path d="M10 11v6"></path>
						<path d="M14 11v6"></path>
						<path d="m9 6 .5-2h5l.5 2"></path>
					</svg>
				</button>
			</div>
		{/if}
	</div>

	{#if tracks.length === 0}
		<div class="empty-state">
			<div class="empty-icon">
				<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="11" cy="11" r="8"></circle>
					<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
				</svg>
			</div>
			<p>no tracks yet</p>
			<span>search for tracks to add to your playlist</span>
			{#if isOwner}
				<button class="empty-add-btn" onclick={() => showSearch = true}>
					add tracks
				</button>
			{/if}
		</div>
	{:else}
		<div class="tracks-list">
			{#each tracks as track, index}
				<div class="track-item">
					<span class="track-number">{index + 1}</span>
					{#if track.image_url}
						<img src={track.image_url} alt="" class="track-image" />
					{:else}
						<div class="track-image-placeholder">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<circle cx="12" cy="12" r="10"></circle>
								<circle cx="12" cy="12" r="3"></circle>
							</svg>
						</div>
					{/if}
					<div class="track-info">
						<span class="track-title">{track.title}</span>
						<span class="track-artist">{track.artist_name}</span>
					</div>
					{#if isOwner}
						<button
							class="remove-btn"
							onclick={() => removeTrack(track.atproto_record_uri)}
							disabled={removingTrack === track.atproto_record_uri}
						>
							{#if removingTrack === track.atproto_record_uri}
								<span class="spinner"></span>
							{:else}
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<line x1="18" y1="6" x2="6" y2="18"></line>
									<line x1="6" y1="6" x2="18" y2="18"></line>
								</svg>
							{/if}
						</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if showSearch}
	<div class="modal-overlay" onclick={() => { showSearch = false; searchQuery = ''; searchResults = []; }}>
		<div class="modal search-modal" onclick={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<h3>add tracks</h3>
				<button class="close-btn" onclick={() => { showSearch = false; searchQuery = ''; searchResults = []; }}>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</button>
			</div>
			<div class="search-input-wrapper">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="11" cy="11" r="8"></circle>
					<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
				</svg>
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="search for tracks..."
					autofocus
				/>
				{#if searching}
					<span class="spinner"></span>
				{/if}
			</div>
			<div class="search-results">
				{#if searchError}
					<p class="error">{searchError}</p>
				{:else if searchResults.length === 0 && searchQuery.length >= 2 && !searching}
					<p class="no-results">no tracks found</p>
				{:else}
					{#each searchResults as result}
						<div class="search-result-item">
							{#if result.image_url}
								<img src={result.image_url} alt="" class="result-image" />
							{:else}
								<div class="result-image-placeholder">
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<circle cx="12" cy="12" r="10"></circle>
										<circle cx="12" cy="12" r="3"></circle>
									</svg>
								</div>
							{/if}
							<div class="result-info">
								<span class="result-title">{result.title}</span>
								<span class="result-artist">{result.artist_display_name}</span>
							</div>
							<button
								class="add-result-btn"
								onclick={() => addTrack(result)}
								disabled={addingTrack === result.id}
							>
								{#if addingTrack === result.id}
									<span class="spinner"></span>
								{:else}
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<line x1="12" y1="5" x2="12" y2="19"></line>
										<line x1="5" y1="12" x2="19" y2="12"></line>
									</svg>
								{/if}
							</button>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
{/if}

{#if showDeleteConfirm}
	<div class="modal-overlay" onclick={() => showDeleteConfirm = false}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<h3>delete playlist?</h3>
			</div>
			<div class="modal-body">
				<p>are you sure you want to delete "{playlist.name}"? this action cannot be undone.</p>
			</div>
			<div class="modal-footer">
				<button class="cancel-btn" onclick={() => showDeleteConfirm = false} disabled={deleting}>
					cancel
				</button>
				<button class="confirm-btn danger" onclick={deletePlaylist} disabled={deleting}>
					{deleting ? 'deleting...' : 'delete'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.page {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 1rem calc(var(--player-height, 0px) + 2rem + env(safe-area-inset-bottom, 0px));
		min-height: 100vh;
	}

	.page-header {
		margin-bottom: 2rem;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--text-secondary);
		text-decoration: none;
		font-size: 0.9rem;
		margin-bottom: 1.5rem;
		transition: color 0.15s;
	}

	.back-link:hover {
		color: var(--accent);
	}

	.playlist-info {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.playlist-icon {
		width: 64px;
		height: 64px;
		border-radius: 12px;
		background: linear-gradient(135deg, rgba(var(--accent-rgb, 139, 92, 246), 0.15), rgba(var(--accent-rgb, 139, 92, 246), 0.05));
		color: var(--accent);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.playlist-meta h1 {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 0.25rem 0;
	}

	.playlist-meta p {
		font-size: 0.9rem;
		color: var(--text-tertiary);
		margin: 0;
	}

	.actions {
		display: flex;
		gap: 0.75rem;
	}

	.add-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.add-btn:hover {
		opacity: 0.9;
	}

	.delete-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: 8px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s;
	}

	.delete-btn:hover {
		border-color: #ef4444;
		color: #ef4444;
	}

	/* tracks list */
	.tracks-list {
		display: flex;
		flex-direction: column;
	}

	.track-item {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--border-default);
	}

	.track-item:last-child {
		border-bottom: none;
	}

	.track-number {
		width: 24px;
		font-size: 0.85rem;
		color: var(--text-muted);
		text-align: center;
		flex-shrink: 0;
	}

	.track-image,
	.track-image-placeholder {
		width: 40px;
		height: 40px;
		border-radius: 6px;
		flex-shrink: 0;
	}

	.track-image {
		object-fit: cover;
	}

	.track-image-placeholder {
		background: var(--bg-tertiary);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}

	.track-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.track-title {
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.track-artist {
		font-size: 0.85rem;
		color: var(--text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.remove-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: transparent;
		border: none;
		border-radius: 6px;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.15s;
		flex-shrink: 0;
	}

	.remove-btn:hover:not(:disabled) {
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
	}

	.remove-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* empty state */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
		text-align: center;
	}

	.empty-icon {
		width: 64px;
		height: 64px;
		border-radius: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-secondary);
		color: var(--text-muted);
		margin-bottom: 1rem;
	}

	.empty-state p {
		font-size: 1rem;
		font-weight: 500;
		color: var(--text-secondary);
		margin: 0 0 0.25rem 0;
	}

	.empty-state span {
		font-size: 0.85rem;
		color: var(--text-muted);
		margin-bottom: 1.5rem;
	}

	.empty-add-btn {
		padding: 0.625rem 1.25rem;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.empty-add-btn:hover {
		opacity: 0.9;
	}

	/* modal */
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 1rem;
	}

	.modal {
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 16px;
		width: 100%;
		max-width: 400px;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
	}

	.search-modal {
		max-width: 500px;
		max-height: 80vh;
		display: flex;
		flex-direction: column;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border-default);
	}

	.modal-header h3 {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: transparent;
		border: none;
		border-radius: 8px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s;
	}

	.close-btn:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.search-input-wrapper {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1.5rem;
		border-bottom: 1px solid var(--border-default);
		color: var(--text-muted);
	}

	.search-input-wrapper input {
		flex: 1;
		background: transparent;
		border: none;
		font-size: 1rem;
		color: var(--text-primary);
		outline: none;
	}

	.search-input-wrapper input::placeholder {
		color: var(--text-muted);
	}

	.search-results {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem 0;
		max-height: 400px;
	}

	.search-results .error,
	.search-results .no-results {
		padding: 2rem 1.5rem;
		text-align: center;
		color: var(--text-muted);
		font-size: 0.9rem;
		margin: 0;
	}

	.search-results .error {
		color: #ef4444;
	}

	.search-result-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 1.5rem;
		transition: background 0.15s;
	}

	.search-result-item:hover {
		background: var(--bg-hover);
	}

	.result-image,
	.result-image-placeholder {
		width: 40px;
		height: 40px;
		border-radius: 6px;
		flex-shrink: 0;
	}

	.result-image {
		object-fit: cover;
	}

	.result-image-placeholder {
		background: var(--bg-tertiary);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}

	.result-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.result-title {
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.result-artist {
		font-size: 0.8rem;
		color: var(--text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.add-result-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		background: var(--accent);
		border: none;
		border-radius: 8px;
		color: white;
		cursor: pointer;
		transition: all 0.15s;
		flex-shrink: 0;
	}

	.add-result-btn:hover:not(:disabled) {
		opacity: 0.9;
	}

	.add-result-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.modal-body {
		padding: 1.5rem;
	}

	.modal-body p {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.95rem;
		line-height: 1.5;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		padding: 1rem 1.5rem 1.25rem;
	}

	.cancel-btn,
	.confirm-btn {
		padding: 0.625rem 1.25rem;
		border-radius: 8px;
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.cancel-btn {
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		color: var(--text-secondary);
	}

	.cancel-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.confirm-btn {
		background: var(--accent);
		border: 1px solid var(--accent);
		color: white;
	}

	.confirm-btn.danger {
		background: #ef4444;
		border-color: #ef4444;
	}

	.confirm-btn:hover:not(:disabled) {
		opacity: 0.9;
	}

	.confirm-btn:disabled,
	.cancel-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 768px) {
		.page {
			padding: 0 0.75rem calc(var(--player-height, 0px) + 1.25rem + env(safe-area-inset-bottom, 0px));
		}

		.playlist-icon {
			width: 56px;
			height: 56px;
		}

		.playlist-meta h1 {
			font-size: 1.25rem;
		}

		.actions {
			flex-wrap: wrap;
		}

		.add-btn {
			flex: 1;
		}

		.track-number {
			display: none;
		}
	}
</style>
