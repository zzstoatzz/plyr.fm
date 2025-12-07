<script lang="ts">
	import Header from '$lib/components/Header.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import SensitiveImage from '$lib/components/SensitiveImage.svelte';
	import TrackItem from '$lib/components/TrackItem.svelte';
	import { auth } from '$lib/auth.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { API_URL } from '$lib/config';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import { toast } from '$lib/toast.svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import type { PageData } from './$types';
	import type { PlaylistWithTracks, Track } from '$lib/types';

	let { data }: { data: PageData } = $props();
	let playlist = $state<PlaylistWithTracks>(data.playlist);
	let tracks = $state<Track[]>(data.playlist.tracks);

	// search state
	let showSearch = $state(false);
	let searchQuery = $state('');
	let searchResults = $state<any[]>([]);
	let searching = $state(false);
	let searchError = $state('');

	// UI state
	let deleting = $state(false);
	let addingTrack = $state<number | null>(null);
	let showDeleteConfirm = $state(false);

	// edit modal state
	let showEdit = $state(false);
	let editName = $state('');
	let editShowOnProfile = $state(false);
	let editImageFile = $state<File | null>(null);
	let editImagePreview = $state<string | null>(null);
	let saving = $state(false);
	let uploadingCover = $state(false);

	// reorder state
	let isEditMode = $state(false);
	let isSavingOrder = $state(false);

	// drag state
	let draggedIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);

	// touch drag state
	let touchDragIndex = $state<number | null>(null);
	let touchStartY = $state(0);
	let touchDragElement = $state<HTMLElement | null>(null);
	let tracksListElement = $state<HTMLElement | null>(null);

	async function handleLogout() {
		await auth.logout();
		window.location.href = '/';
	}

	function playTrack(track: Track) {
		queue.playNow(track);
	}

	function playNow() {
		if (tracks.length > 0) {
			queue.setQueue(tracks);
			queue.playNow(tracks[0]);
			toast.success(`playing ${playlist.name}`, 1800);
		}
	}

	function addToQueue() {
		if (tracks.length > 0) {
			queue.addTracks(tracks);
			toast.success(`added ${playlist.name} to queue`, 1800);
		}
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

			// add full track to local state
			tracks = [...tracks, trackData as Track];

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

	// reorder functions
	function toggleEditMode() {
		if (isEditMode) {
			saveOrder();
		}
		isEditMode = !isEditMode;
	}

	async function saveOrder() {
		if (!playlist.atproto_record_uri) return;

		// extract rkey from list URI (at://did/collection/rkey)
		const rkey = playlist.atproto_record_uri.split('/').pop();
		if (!rkey) return;

		// build strongRefs from current track order
		const items = tracks
			.filter((t) => t.atproto_record_uri && t.atproto_record_cid)
			.map((t) => ({
				uri: t.atproto_record_uri!,
				cid: t.atproto_record_cid!
			}));

		if (items.length === 0) return;

		isSavingOrder = true;
		try {
			const response = await fetch(`${API_URL}/lists/${rkey}/reorder`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ items })
			});

			if (!response.ok) {
				const error = await response.json().catch(() => ({ detail: 'unknown error' }));
				throw new Error(error.detail || 'failed to save order');
			}

			toast.success('order saved');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'failed to save order');
		} finally {
			isSavingOrder = false;
		}
	}

	// move track from one index to another
	function moveTrack(fromIndex: number, toIndex: number) {
		if (fromIndex === toIndex) return;
		const newTracks = [...tracks];
		const [moved] = newTracks.splice(fromIndex, 1);
		newTracks.splice(toIndex, 0, moved);
		tracks = newTracks;
	}

	// desktop drag and drop
	function handleDragStart(event: DragEvent, index: number) {
		draggedIndex = index;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
		}
	}

	function handleDragOver(event: DragEvent, index: number) {
		event.preventDefault();
		dragOverIndex = index;
	}

	function handleDrop(event: DragEvent, index: number) {
		event.preventDefault();
		if (draggedIndex !== null && draggedIndex !== index) {
			moveTrack(draggedIndex, index);
		}
		draggedIndex = null;
		dragOverIndex = null;
	}

	function handleDragEnd() {
		draggedIndex = null;
		dragOverIndex = null;
	}

	// touch drag and drop
	function handleTouchStart(event: TouchEvent, index: number) {
		const touch = event.touches[0];
		touchDragIndex = index;
		touchStartY = touch.clientY;
		touchDragElement = event.currentTarget as HTMLElement;
		touchDragElement.classList.add('touch-dragging');
	}

	function handleTouchMove(event: TouchEvent) {
		if (touchDragIndex === null || !touchDragElement || !tracksListElement) return;

		event.preventDefault();
		const touch = event.touches[0];
		const offset = touch.clientY - touchStartY;
		touchDragElement.style.transform = `translateY(${offset}px)`;

		const trackElements = tracksListElement.querySelectorAll('.track-row');
		for (let i = 0; i < trackElements.length; i++) {
			const trackEl = trackElements[i] as HTMLElement;
			const rect = trackEl.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;

			if (touch.clientY < midY && i > 0) {
				const targetIndex = parseInt(trackEl.dataset.index || '0');
				if (targetIndex !== touchDragIndex) {
					dragOverIndex = targetIndex;
				}
				break;
			} else if (touch.clientY >= midY) {
				const targetIndex = parseInt(trackEl.dataset.index || '0');
				if (targetIndex !== touchDragIndex) {
					dragOverIndex = targetIndex;
				}
			}
		}
	}

	function handleTouchEnd() {
		if (touchDragIndex !== null && dragOverIndex !== null && touchDragIndex !== dragOverIndex) {
			moveTrack(touchDragIndex, dragOverIndex);
		}

		if (touchDragElement) {
			touchDragElement.classList.remove('touch-dragging');
			touchDragElement.style.transform = '';
		}

		touchDragIndex = null;
		dragOverIndex = null;
		touchDragElement = null;
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

	function openEditModal() {
		editName = playlist.name;
		editShowOnProfile = playlist.show_on_profile;
		editImageFile = null;
		editImagePreview = null;
		showEdit = true;
	}

	function handleEditImageSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		// validate file type
		if (!file.type.startsWith('image/')) {
			return;
		}

		// validate file size (20MB max)
		if (file.size > 20 * 1024 * 1024) {
			return;
		}

		editImageFile = file;
		editImagePreview = URL.createObjectURL(file);
	}

	async function savePlaylistChanges() {
		saving = true;

		try {
			// update name and/or show_on_profile if changed
			const nameChanged = editName.trim() && editName.trim() !== playlist.name;
			const showOnProfileChanged = editShowOnProfile !== playlist.show_on_profile;

			if (nameChanged || showOnProfileChanged) {
				const formData = new FormData();
				if (nameChanged) {
					formData.append('name', editName.trim());
				}
				if (showOnProfileChanged) {
					formData.append('show_on_profile', String(editShowOnProfile));
				}

				const response = await fetch(`${API_URL}/lists/playlists/${playlist.id}`, {
					method: 'PATCH',
					credentials: 'include',
					body: formData
				});

				if (!response.ok) {
					throw new Error('failed to update playlist');
				}

				const updated = await response.json();
				playlist.name = updated.name;
				playlist.show_on_profile = updated.show_on_profile;
			}

			// upload cover if selected
			if (editImageFile) {
				uploadingCover = true;
				const formData = new FormData();
				formData.append('image', editImageFile);

				const response = await fetch(`${API_URL}/lists/playlists/${playlist.id}/cover`, {
					method: 'POST',
					credentials: 'include',
					body: formData
				});

				if (!response.ok) {
					throw new Error('failed to upload cover');
				}

				const result = await response.json();
				playlist.image_url = result.image_url;
				uploadingCover = false;
			}

			showEdit = false;
		} catch (e) {
			console.error('failed to save playlist:', e);
		} finally {
			saving = false;
			uploadingCover = false;
			if (editImagePreview) {
				URL.revokeObjectURL(editImagePreview);
				editImagePreview = null;
			}
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
			if (showEdit) {
				showEdit = false;
				if (editImagePreview) {
					URL.revokeObjectURL(editImagePreview);
					editImagePreview = null;
				}
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
	<meta
		name="description"
		content="playlist by @{playlist.owner_handle} • {playlist.track_count} {playlist.track_count === 1 ? 'track' : 'tracks'} on {APP_NAME}"
	/>

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="music.playlist" />
	<meta property="og:title" content="{playlist.name}" />
	<meta
		property="og:description"
		content="playlist by @{playlist.owner_handle} • {playlist.track_count} {playlist.track_count === 1 ? 'track' : 'tracks'}"
	/>
	<meta property="og:url" content="{APP_CANONICAL_URL}/playlist/{playlist.id}" />
	<meta property="og:site_name" content={APP_NAME} />
	{#if playlist.image_url}
		<meta property="og:image" content={playlist.image_url} />
	{/if}

	<!-- Twitter -->
	<meta name="twitter:card" content={playlist.image_url ? "summary_large_image" : "summary"} />
	<meta name="twitter:title" content="{playlist.name}" />
	<meta
		name="twitter:description"
		content="playlist by @{playlist.owner_handle} • {playlist.track_count} {playlist.track_count === 1 ? 'track' : 'tracks'}"
	/>
	{#if playlist.image_url}
		<meta name="twitter:image" content={playlist.image_url} />
	{/if}
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

<div class="container">
	<main>
		<div class="playlist-hero">
			{#if playlist.image_url}
				<SensitiveImage src={playlist.image_url} tooltipPosition="center">
					<img src={playlist.image_url} alt="{playlist.name} artwork" class="playlist-art" />
				</SensitiveImage>
			{:else}
				<div class="playlist-art-placeholder">
					<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<line x1="8" y1="6" x2="21" y2="6"></line>
						<line x1="8" y1="12" x2="21" y2="12"></line>
						<line x1="8" y1="18" x2="21" y2="18"></line>
						<line x1="3" y1="6" x2="3.01" y2="6"></line>
						<line x1="3" y1="12" x2="3.01" y2="12"></line>
						<line x1="3" y1="18" x2="3.01" y2="18"></line>
					</svg>
				</div>
			{/if}
			<div class="playlist-info-wrapper">
				<div class="playlist-info">
					<p class="playlist-type">playlist</p>
					<h1 class="playlist-title">{playlist.name}</h1>
					<div class="playlist-meta">
						<a href="/u/{playlist.owner_handle}" class="owner-link">
							{playlist.owner_handle}
						</a>
						<span class="meta-separator">•</span>
						<span>{playlist.track_count} {playlist.track_count === 1 ? 'track' : 'tracks'}</span>
					</div>
				</div>

				<div class="side-buttons">
					<ShareButton url={$page.url.href} title="share playlist" />
					{#if isOwner}
						<button class="icon-btn" onclick={openEditModal} aria-label="edit playlist metadata" title="edit playlist metadata">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
								<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
							</svg>
						</button>
						<button class="icon-btn danger" onclick={() => showDeleteConfirm = true} aria-label="delete playlist" title="delete playlist">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<polyline points="3 6 5 6 21 6"></polyline>
								<path d="m19 6-.867 12.142A2 2 0 0 1 16.138 20H7.862a2 2 0 0 1-1.995-1.858L5 6"></path>
								<path d="M10 11v6"></path>
								<path d="M14 11v6"></path>
								<path d="m9 6 .5-2h5l.5 2"></path>
							</svg>
						</button>
					{/if}
				</div>
			</div>
		</div>

		<div class="playlist-actions">
			<button class="play-button" onclick={playNow}>
				<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
					<path d="M8 5v14l11-7z"/>
				</svg>
				play now
			</button>
			<button class="queue-button" onclick={addToQueue}>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					<line x1="5" y1="15" x2="5" y2="21"></line>
					<line x1="2" y1="18" x2="8" y2="18"></line>
					<line x1="9" y1="6" x2="21" y2="6"></line>
					<line x1="9" y1="12" x2="21" y2="12"></line>
					<line x1="9" y1="18" x2="21" y2="18"></line>
				</svg>
				add to queue
			</button>
			{#if isOwner}
				<button class="add-tracks-button" onclick={() => showSearch = true}>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="12" y1="5" x2="12" y2="19"></line>
						<line x1="5" y1="12" x2="19" y2="12"></line>
					</svg>
					add tracks
				</button>
				{#if tracks.length > 1}
					<button
						class="reorder-button"
						class:active={isEditMode}
						onclick={toggleEditMode}
						disabled={isSavingOrder}
						title={isEditMode ? 'save order' : 'reorder tracks'}
					>
						{#if isEditMode}
							{#if isSavingOrder}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spinner">
									<circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"></circle>
								</svg>
								saving...
						{:else}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<polyline points="20 6 9 17 4 12"></polyline>
							</svg>
							done
						{/if}
					{:else}
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<line x1="3" y1="12" x2="21" y2="12"></line>
							<line x1="3" y1="6" x2="21" y2="6"></line>
							<line x1="3" y1="18" x2="21" y2="18"></line>
						</svg>
						reorder
					{/if}
				</button>
			{/if}
			{/if}
			<div class="mobile-share-button">
				<ShareButton url={$page.url.href} title="share playlist" />
			</div>
		</div>

		<div class="tracks-section">
			<h2 class="section-heading">tracks</h2>
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
		<div
			class="tracks-list"
			class:edit-mode={isEditMode}
			bind:this={tracksListElement}
			ontouchmove={isEditMode ? handleTouchMove : undefined}
			ontouchend={isEditMode ? handleTouchEnd : undefined}
			ontouchcancel={isEditMode ? handleTouchEnd : undefined}
		>
			{#each tracks as track, i (track.id)}
				{#if isEditMode}
					<div
						class="track-row"
						class:drag-over={dragOverIndex === i && touchDragIndex !== i}
						class:is-dragging={touchDragIndex === i || draggedIndex === i}
						data-index={i}
						draggable="true"
						ondragstart={(e) => handleDragStart(e, i)}
						ondragover={(e) => handleDragOver(e, i)}
						ondrop={(e) => handleDrop(e, i)}
						ondragend={handleDragEnd}
					>
						<button
							class="drag-handle"
							ontouchstart={(e) => handleTouchStart(e, i)}
							onclick={(e) => e.stopPropagation()}
							aria-label="drag to reorder"
							title="drag to reorder"
						>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
								<circle cx="5" cy="3" r="1.5"></circle>
								<circle cx="11" cy="3" r="1.5"></circle>
								<circle cx="5" cy="8" r="1.5"></circle>
								<circle cx="11" cy="8" r="1.5"></circle>
								<circle cx="5" cy="13" r="1.5"></circle>
								<circle cx="11" cy="13" r="1.5"></circle>
							</svg>
						</button>
						<div class="track-content">
							<TrackItem
								{track}
								index={i}
								showIndex={true}
								isPlaying={player.currentTrack?.id === track.id}
								onPlay={playTrack}
								isAuthenticated={auth.isAuthenticated}
								hideAlbum={true}
								excludePlaylistId={playlist.id}
							/>
						</div>
					</div>
				{:else}
					<TrackItem
						{track}
						index={i}
						showIndex={true}
						isPlaying={player.currentTrack?.id === track.id}
						onPlay={playTrack}
						isAuthenticated={auth.isAuthenticated}
						hideAlbum={true}
						excludePlaylistId={playlist.id}
					/>
				{/if}
			{/each}
			</div>
			{/if}
		</div>
	</main>
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

{#if showEdit}
	<div class="modal-overlay" onclick={() => { showEdit = false; if (editImagePreview) { URL.revokeObjectURL(editImagePreview); editImagePreview = null; } }}>
		<div class="modal edit-modal" onclick={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<h3>edit playlist</h3>
				<button class="close-btn" onclick={() => { showEdit = false; if (editImagePreview) { URL.revokeObjectURL(editImagePreview); editImagePreview = null; } }}>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</button>
			</div>
			<div class="modal-body">
				<div class="edit-cover-section">
					<label class="cover-picker">
						{#if editImagePreview}
							<img src={editImagePreview} alt="preview" class="cover-preview" />
						{:else if playlist.image_url}
							<SensitiveImage src={playlist.image_url} tooltipPosition="center">
								<img src={playlist.image_url} alt="current cover" class="cover-preview" />
							</SensitiveImage>
						{:else}
							<div class="cover-placeholder">
								<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
									<circle cx="8.5" cy="8.5" r="1.5"></circle>
									<polyline points="21 15 16 10 5 21"></polyline>
								</svg>
								<span>add cover</span>
							</div>
						{/if}
						<input type="file" accept="image/jpeg,image/png,image/webp" onchange={handleEditImageSelect} hidden />
					</label>
					<span class="cover-hint">click to change cover art</span>
				</div>
				<div class="edit-name-section">
					<label for="edit-name">playlist name</label>
					<input
						id="edit-name"
						type="text"
						bind:value={editName}
						placeholder="playlist name"
					/>
				</div>
				<div class="edit-toggle-section">
					<label class="toggle-row">
						<input
							type="checkbox"
							bind:checked={editShowOnProfile}
						/>
						<span class="toggle-label">show on profile</span>
					</label>
					<span class="toggle-hint">when enabled, this playlist will appear in your public collections</span>
				</div>
			</div>
			<div class="modal-footer">
				<button class="cancel-btn" onclick={() => { showEdit = false; if (editImagePreview) { URL.revokeObjectURL(editImagePreview); editImagePreview = null; } }} disabled={saving}>
					cancel
				</button>
				<button class="confirm-btn" onclick={savePlaylistChanges} disabled={saving || (!editImageFile && editName.trim() === playlist.name && editShowOnProfile === playlist.show_on_profile)}>
					{#if saving}
						{uploadingCover ? 'uploading cover...' : 'saving...'}
					{:else}
						save
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 1rem calc(var(--player-height, 120px) + 2rem + env(safe-area-inset-bottom, 0px)) 1rem;
	}

	main {
		margin-top: 2rem;
	}

	.playlist-hero {
		display: flex;
		gap: 2rem;
		margin-bottom: 2rem;
		align-items: flex-end;
	}

	.playlist-art {
		width: 200px;
		height: 200px;
		border-radius: 8px;
		object-fit: cover;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	.playlist-art-placeholder {
		width: 200px;
		height: 200px;
		border-radius: 8px;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}

	.playlist-info-wrapper {
		flex: 1;
		display: flex;
		align-items: flex-end;
		gap: 1rem;
	}

	.playlist-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.side-buttons {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-bottom: 0.5rem;
	}

	.mobile-share-button {
		display: none;
	}

	.playlist-type {
		text-transform: uppercase;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		color: var(--text-tertiary);
		margin: 0;
	}

	.playlist-title {
		font-size: 3rem;
		font-weight: 700;
		margin: 0;
		color: var(--text-primary);
		line-height: 1.1;
		word-wrap: break-word;
		overflow-wrap: break-word;
		hyphens: auto;
	}

	.playlist-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.95rem;
		color: var(--text-secondary);
	}

	.owner-link {
		color: var(--text-secondary);
		text-decoration: none;
		font-weight: 600;
		transition: color 0.2s;
	}

	.owner-link:hover {
		color: var(--accent);
	}

	.meta-separator {
		color: var(--text-muted);
		font-size: 0.7rem;
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.15s;
	}

	.icon-btn:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.icon-btn.danger:hover {
		border-color: #ef4444;
		color: #ef4444;
	}

	/* playlist actions */
	.playlist-actions {
		display: flex;
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.play-button,
	.queue-button,
	.add-tracks-button,
	.reorder-button {
		padding: 0.75rem 1.5rem;
		border-radius: 24px;
		font-weight: 600;
		font-size: 0.95rem;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border: none;
	}

	.play-button {
		background: var(--accent);
		color: var(--bg-primary);
	}

	.play-button:hover {
		transform: scale(1.05);
	}

	.queue-button,
	.add-tracks-button,
	.reorder-button {
		background: transparent;
		color: var(--text-primary);
		border: 1px solid var(--border-default);
	}

	.queue-button:hover,
	.add-tracks-button:hover,
	.reorder-button:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.reorder-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.reorder-button.active {
		border-color: var(--accent);
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}

	.spinner {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	/* tracks section */
	.tracks-section {
		margin-top: 2rem;
		padding-bottom: calc(var(--player-height, 120px) + env(safe-area-inset-bottom, 0px));
	}

	.section-heading {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 1rem;
		text-transform: lowercase;
	}

	/* tracks list */
	.tracks-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* edit mode styles */
	.track-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border-radius: 8px;
		transition: all 0.2s;
		position: relative;
	}

	.track-row.drag-over {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		outline: 2px dashed var(--accent);
		outline-offset: -2px;
	}

	.track-row.is-dragging {
		opacity: 0.9;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		z-index: 10;
	}

	:global(.track-row.touch-dragging) {
		z-index: 100;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}

	.drag-handle {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: grab;
		touch-action: none;
		border-radius: 4px;
		transition: all 0.2s;
		flex-shrink: 0;
	}

	.drag-handle:hover {
		color: var(--text-secondary);
		background: var(--bg-tertiary);
	}

	.drag-handle:active {
		cursor: grabbing;
		color: var(--accent);
	}

	@media (pointer: coarse) {
		.drag-handle {
			color: var(--text-tertiary);
		}
	}

	.track-content {
		flex: 1;
		min-width: 0;
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
		font-family: inherit;
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

	/* edit modal */
	.edit-modal {
		max-width: 400px;
	}

	.edit-cover-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}

	.cover-picker {
		width: 120px;
		height: 120px;
		border-radius: 12px;
		overflow: hidden;
		cursor: pointer;
		border: 2px dashed var(--border-default);
		transition: border-color 0.15s;
	}

	.cover-picker:hover {
		border-color: var(--accent);
	}

	.cover-preview {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.cover-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: var(--bg-secondary);
		color: var(--text-muted);
	}

	.cover-placeholder span {
		font-size: 0.8rem;
	}

	.cover-hint {
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.edit-name-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.edit-name-section label {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}

	.edit-name-section input {
		width: 100%;
		padding: 0.75rem 1rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: 8px;
		font-family: inherit;
		font-size: 1rem;
		color: var(--text-primary);
		outline: none;
		transition: border-color 0.15s;
		box-sizing: border-box;
	}

	.edit-name-section input:focus {
		border-color: var(--accent);
	}

	.edit-name-section input::placeholder {
		color: var(--text-muted);
	}

	.edit-toggle-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.toggle-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		cursor: pointer;
	}

	.toggle-row input[type="checkbox"] {
		width: 18px;
		height: 18px;
		accent-color: var(--accent);
		cursor: pointer;
	}

	.toggle-label {
		font-size: 0.95rem;
		color: var(--text-primary);
	}

	.toggle-hint {
		font-size: 0.75rem;
		color: var(--text-muted);
		padding-left: calc(18px + 0.75rem);
	}

	@media (max-width: 768px) {
		.playlist-hero {
			flex-direction: column;
			align-items: flex-start;
			gap: 1.5rem;
		}

		.playlist-art,
		.playlist-art-placeholder {
			width: 160px;
			height: 160px;
		}

		.playlist-info-wrapper {
			flex-direction: column;
			align-items: flex-start;
			width: 100%;
		}

		.side-buttons {
			display: none;
		}

		.mobile-share-button {
			display: flex;
			width: 100%;
			justify-content: center;
		}

		.playlist-title {
			font-size: 2rem;
		}

		.playlist-meta {
			font-size: 0.85rem;
		}

		.playlist-actions {
			flex-direction: column;
			gap: 0.75rem;
			width: 100%;
		}

		.play-button,
		.queue-button,
		.add-tracks-button,
		.reorder-button {
			width: 100%;
			justify-content: center;
		}
	}

	@media (max-width: 480px) {
		.container {
			padding: 0 0.75rem 6rem 0.75rem;
		}

		.playlist-art,
		.playlist-art-placeholder {
			width: 140px;
			height: 140px;
		}

		.playlist-title {
			font-size: 1.75rem;
		}

		.playlist-meta {
			font-size: 0.8rem;
			flex-wrap: wrap;
		}
	}
</style>
