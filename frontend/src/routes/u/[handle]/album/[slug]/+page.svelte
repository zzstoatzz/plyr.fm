<script lang="ts">
	import { goto } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';
	import TrackItem from '$lib/components/TrackItem.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import SensitiveImage from '$lib/components/SensitiveImage.svelte';
	import { checkImageSensitive } from '$lib/moderation.svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { toast } from '$lib/toast.svelte';
	import { auth } from '$lib/auth.svelte';
	import { API_URL } from '$lib/config';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import type { Track } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// local mutable album metadata for editing
	let albumMetadata = $state({ ...data.album.metadata });
	const isAuthenticated = $derived(auth.isAuthenticated);

	// sync when data changes (e.g., navigation)
	$effect(() => {
		albumMetadata = { ...data.album.metadata };
		tracks = [...data.album.tracks];
	});

	// check if current user owns this album
	const isOwner = $derived(auth.user?.did === albumMetadata.artist_did);
	// can only reorder if owner and album has an ATProto list
	const canReorder = $derived(isOwner && !!albumMetadata.list_uri);

	// local mutable copy of tracks for reordering
	let tracks = $state<Track[]>([...data.album.tracks]);

	// edit mode state
	let isEditMode = $state(false);
	let isSaving = $state(false);
	let editTitle = $state('');

	// delete confirmation modal
	let showDeleteConfirm = $state(false);
	let deleting = $state(false);

	// cover upload
	let coverInputElement = $state<HTMLInputElement | null>(null);
	let uploadingCover = $state(false);

	// track removal
	let removingTrackId = $state<number | null>(null);

	// drag state
	let draggedIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);

	// touch drag state
	let touchDragIndex = $state<number | null>(null);
	let touchStartY = $state(0);
	let touchDragElement = $state<HTMLElement | null>(null);
	let tracksListElement = $state<HTMLElement | null>(null);

	// SSR-safe check for sensitive images (for og:image meta tags)
	function isImageSensitiveSSR(url: string | null | undefined): boolean {
		if (!url) return false;
		return checkImageSensitive(url, data.sensitiveImages);
	}

	function playTrack(track: Track) {
		queue.playNow(track);
	}

	function playNow() {
		if (tracks.length > 0) {
			queue.setQueue(tracks);
			queue.playNow(tracks[0]);
			toast.success(`playing ${albumMetadata.title}`, 1800);
		}
	}

	function addToQueue() {
		if (tracks.length > 0) {
			queue.addTracks(tracks);
			toast.success(`added ${albumMetadata.title} to queue`, 1800);
		}
	}

	function toggleEditMode() {
		if (isEditMode) {
			// exiting edit mode - save changes
			saveAllChanges();
		} else {
			// entering edit mode - initialize edit state
			editTitle = albumMetadata.title;
		}
		isEditMode = !isEditMode;
	}

	async function saveAllChanges() {
		// save track order if album has ATProto list
		if (canReorder) {
			await saveOrder();
		}

		// save title if changed
		if (editTitle.trim() && editTitle.trim() !== albumMetadata.title) {
			saveTitleChange();
		}
	}

	function saveTitleChange() {
		const newTitle = editTitle.trim();
		if (!newTitle || newTitle === albumMetadata.title) return;

		// optimistic update - UI updates immediately
		const oldTitle = albumMetadata.title;
		albumMetadata.title = newTitle;

		// fire off backend call without blocking UI
		fetch(
			`${API_URL}/albums/${albumMetadata.id}?title=${encodeURIComponent(newTitle)}`,
			{
				method: 'PATCH',
				credentials: 'include'
			}
		)
			.then(async (response) => {
				if (!response.ok) {
					throw new Error('failed to update title');
				}
				toast.success('title updated');
			})
			.catch((e) => {
				console.error('failed to save title:', e);
				toast.error(e instanceof Error ? e.message : 'failed to save title');
				// revert on failure
				albumMetadata.title = oldTitle;
				editTitle = oldTitle;
			});
	}

	function handleCoverSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		if (!file.type.startsWith('image/')) {
			toast.error('please select an image file');
			return;
		}

		if (file.size > 20 * 1024 * 1024) {
			toast.error('image must be under 20MB');
			return;
		}

		uploadCover(file);
	}

	async function uploadCover(file: File) {
		uploadingCover = true;
		try {
			const formData = new FormData();
			formData.append('image', file);

			const response = await fetch(`${API_URL}/albums/${albumMetadata.id}/cover`, {
				method: 'POST',
				credentials: 'include',
				body: formData
			});

			if (!response.ok) {
				throw new Error('failed to upload cover');
			}

			const result = await response.json();
			albumMetadata.image_url = result.image_url;
			toast.success('cover updated');
		} catch (e) {
			console.error('failed to upload cover:', e);
			toast.error(e instanceof Error ? e.message : 'failed to upload cover');
		} finally {
			uploadingCover = false;
		}
	}

	async function removeTrack(track: Track) {
		removingTrackId = track.id;

		try {
			const response = await fetch(`${API_URL}/albums/${albumMetadata.id}/tracks/${track.id}`, {
				method: 'DELETE',
				credentials: 'include'
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.detail || 'failed to remove track');
			}

			tracks = tracks.filter((t) => t.id !== track.id);
			albumMetadata.track_count = tracks.length;

			toast.success(`removed "${track.title}" from album`);
		} catch (e) {
			console.error('failed to remove track:', e);
			toast.error(e instanceof Error ? e.message : 'failed to remove track');
		} finally {
			removingTrackId = null;
		}
	}

	async function deleteAlbum() {
		deleting = true;

		try {
			const response = await fetch(`${API_URL}/albums/${albumMetadata.id}`, {
				method: 'DELETE',
				credentials: 'include'
			});

			if (!response.ok) {
				throw new Error('failed to delete album');
			}

			toast.success('album deleted');
			goto(`/u/${albumMetadata.artist_handle}`);
		} catch (e) {
			console.error('failed to delete album:', e);
			toast.error(e instanceof Error ? e.message : 'failed to delete album');
			deleting = false;
			showDeleteConfirm = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			if (showDeleteConfirm) {
				showDeleteConfirm = false;
			} else if (isEditMode) {
				// revert title change and exit edit mode
				editTitle = albumMetadata.title;
				isEditMode = false;
			}
		}
	}

	async function saveOrder() {
		if (!albumMetadata.list_uri) return;

		// extract rkey from list URI (at://did/collection/rkey)
		const rkey = albumMetadata.list_uri.split('/').pop();
		if (!rkey) return;

		// build strongRefs from current track order
		const items = tracks
			.filter((t) => t.atproto_record_uri && t.atproto_record_cid)
			.map((t) => ({
				uri: t.atproto_record_uri!,
				cid: t.atproto_record_cid!
			}));

		if (items.length === 0) return;

		isSaving = true;
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
			isSaving = false;
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

	let shareUrl = $state('');

	$effect(() => {
		if (typeof window !== 'undefined') {
			shareUrl = `${window.location.origin}/u/${albumMetadata.artist_handle}/album/${albumMetadata.slug}`;
		}
	});
</script>

<svelte:window on:keydown={handleKeydown} />

<svelte:head>
	<title>{albumMetadata.title} by {albumMetadata.artist} - plyr.fm</title>
	<meta name="description" content="{albumMetadata.title} by {albumMetadata.artist} - {albumMetadata.track_count} tracks on plyr.fm" />

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="music.album" />
	<meta property="og:title" content="{albumMetadata.title} by {albumMetadata.artist}" />
	<meta property="og:description" content="{albumMetadata.track_count} tracks • {albumMetadata.total_plays} plays" />
	<meta property="og:url" content="{APP_CANONICAL_URL}/u/{albumMetadata.artist_handle}/album/{albumMetadata.slug}" />
	<meta property="og:site_name" content={APP_NAME} />
	<meta property="music:musician" content="{albumMetadata.artist_handle}" />
	{#if albumMetadata.image_url && !isImageSensitiveSSR(albumMetadata.image_url)}
		<meta property="og:image" content="{albumMetadata.image_url}" />
		<meta property="og:image:secure_url" content="{albumMetadata.image_url}" />
		<meta property="og:image:width" content="1200" />
		<meta property="og:image:height" content="1200" />
		<meta property="og:image:alt" content="{albumMetadata.title} by {albumMetadata.artist}" />
	{/if}

	<!-- Twitter -->
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content="{albumMetadata.title} by {albumMetadata.artist}" />
	<meta name="twitter:description" content="{albumMetadata.track_count} tracks • {albumMetadata.total_plays} plays" />
	{#if albumMetadata.image_url && !isImageSensitiveSSR(albumMetadata.image_url)}
		<meta name="twitter:image" content="{albumMetadata.image_url}" />
	{/if}
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={() => goto('/login')} />
<div class="container">
	<main>
		<!-- hidden file input for cover upload -->
		<input
			type="file"
			accept="image/jpeg,image/png,image/webp"
			bind:this={coverInputElement}
			onchange={handleCoverSelect}
			hidden
		/>

		<div class="album-hero" class:edit-mode={isEditMode && isOwner}>
			{#if isEditMode && isOwner}
				<button
					class="album-art-wrapper clickable"
					onclick={() => coverInputElement?.click()}
					type="button"
					aria-label="change cover image"
					disabled={uploadingCover}
				>
					{#if albumMetadata.image_url}
						<img src={albumMetadata.image_url} alt="{albumMetadata.title} artwork" class="album-art" />
					{:else}
						<div class="album-art-placeholder">
							<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
								<rect x="3" y="3" width="18" height="18" stroke="currentColor" stroke-width="1.5" fill="none"/>
								<circle cx="12" cy="12" r="4" fill="currentColor"/>
							</svg>
						</div>
					{/if}
					<div class="art-edit-overlay" class:uploading={uploadingCover}>
						{#if uploadingCover}
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spinner">
								<circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"></circle>
							</svg>
							<span>uploading...</span>
						{:else}
							<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
								<circle cx="8.5" cy="8.5" r="1.5"></circle>
								<polyline points="21 15 16 10 5 21"></polyline>
							</svg>
							<span>change cover</span>
						{/if}
					</div>
				</button>
			{:else if albumMetadata.image_url}
				<SensitiveImage src={albumMetadata.image_url} tooltipPosition="center">
					<img src={albumMetadata.image_url} alt="{albumMetadata.title} artwork" class="album-art" />
				</SensitiveImage>
			{:else}
				<div class="album-art-placeholder">
					<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<rect x="3" y="3" width="18" height="18" stroke="currentColor" stroke-width="1.5" fill="none"/>
						<circle cx="12" cy="12" r="4" fill="currentColor"/>
					</svg>
				</div>
			{/if}
			<div class="album-info-wrapper">
				<div class="album-info">
					<p class="album-type">album</p>
					{#if isEditMode && isOwner}
						<input
							type="text"
							class="album-title-input"
							bind:value={editTitle}
							placeholder="album title"
						/>
					{:else}
						<h1 class="album-title">{albumMetadata.title}</h1>
					{/if}
					<div class="album-meta">
						<a href="/u/{albumMetadata.artist_handle}" class="artist-link">
							{albumMetadata.artist}
						</a>
						<span class="meta-separator">•</span>
						<span>{albumMetadata.track_count} {albumMetadata.track_count === 1 ? 'track' : 'tracks'}</span>
						<span class="meta-separator">•</span>
						<span>{albumMetadata.total_plays} {albumMetadata.total_plays === 1 ? 'play' : 'plays'}</span>
					</div>
				</div>

				<div class="side-buttons">
					<ShareButton url={shareUrl} title="share album" />
					{#if isOwner}
						<button
							class="icon-btn"
							class:active={isEditMode}
							onclick={toggleEditMode}
							aria-label={isEditMode ? 'done editing' : 'edit album'}
							title={isEditMode ? 'done editing' : 'edit album'}
						>
							{#if isEditMode}
								{#if isSaving}
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spinner">
										<circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"></circle>
									</svg>
								{:else}
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<polyline points="20 6 9 17 4 12"></polyline>
									</svg>
								{/if}
							{:else}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
									<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
								</svg>
							{/if}
						</button>
						<button
							class="icon-btn danger"
							onclick={() => (showDeleteConfirm = true)}
							aria-label="delete album"
							title="delete album"
						>
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

		<div class="album-actions">
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
			<div class="mobile-buttons">
				<ShareButton url={shareUrl} title="share album" />
				{#if isOwner}
					<button
						class="icon-btn"
						class:active={isEditMode}
						onclick={toggleEditMode}
						aria-label={isEditMode ? 'done editing' : 'edit album'}
						title={isEditMode ? 'done editing' : 'edit album'}
					>
						{#if isEditMode}
							{#if isSaving}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spinner">
									<circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"></circle>
								</svg>
							{:else}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<polyline points="20 6 9 17 4 12"></polyline>
								</svg>
							{/if}
						{:else}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
								<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
							</svg>
						{/if}
					</button>
					<button
						class="icon-btn danger"
						onclick={() => (showDeleteConfirm = true)}
						aria-label="delete album"
						title="delete album"
					>
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

		<div class="tracks-section">
			<h2 class="section-heading">tracks</h2>
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
							role="listitem"
							draggable="true"
							ondragstart={(e) => handleDragStart(e, i)}
							ondragover={(e) => handleDragOver(e, i)}
							ondrop={(e) => handleDrop(e, i)}
							ondragend={handleDragEnd}
						>
							{#if canReorder}
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
							{/if}
							<div class="track-content">
								<TrackItem
									{track}
									index={i}
									showIndex={true}
									isPlaying={player.currentTrack?.id === track.id}
									onPlay={playTrack}
									{isAuthenticated}
									hideAlbum={true}
									hideArtist={true}
								/>
							</div>
							<button
								class="remove-track-btn"
								onclick={(e) => {
									e.stopPropagation();
									removeTrack(track);
								}}
								disabled={removingTrackId === track.id}
								aria-label="remove track from album"
								title="remove track"
							>
								{#if removingTrackId === track.id}
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spinner">
										<circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"></circle>
									</svg>
								{:else}
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<line x1="18" y1="6" x2="6" y2="18"></line>
										<line x1="6" y1="6" x2="18" y2="18"></line>
									</svg>
								{/if}
							</button>
						</div>
					{:else}
						<TrackItem
							{track}
							index={i}
							showIndex={true}
							isPlaying={player.currentTrack?.id === track.id}
							onPlay={playTrack}
							{isAuthenticated}
							hideAlbum={true}
							hideArtist={true}
						/>
					{/if}
				{/each}
			</div>
		</div>
	</main>
</div>

{#if showDeleteConfirm}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="modal-overlay"
		role="presentation"
		onclick={() => (showDeleteConfirm = false)}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="modal"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="delete-confirm-title"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="modal-header">
				<h3 id="delete-confirm-title">delete album?</h3>
			</div>
			<div class="modal-body">
				<p>
					are you sure you want to delete "{albumMetadata.title}"? the tracks will remain as standalone tracks.
				</p>
			</div>
			<div class="modal-footer">
				<button
					class="cancel-btn"
					onclick={() => (showDeleteConfirm = false)}
					disabled={deleting}
				>
					cancel
				</button>
				<button
					class="confirm-btn danger"
					onclick={deleteAlbum}
					disabled={deleting}
				>
					{deleting ? 'deleting...' : 'delete'}
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

	.album-hero {
		display: flex;
		gap: 2rem;
		margin-bottom: 2rem;
		align-items: flex-end;
	}

	.album-art {
		width: 200px;
		height: 200px;
		border-radius: 8px;
		object-fit: cover;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	.album-art-placeholder {
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

	.album-info-wrapper {
		flex: 1;
		display: flex;
		align-items: flex-end;
		gap: 1rem;
	}

	.album-info {
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

	.mobile-buttons {
		display: none;
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
		border-color: var(--error);
		color: var(--error);
	}

	.icon-btn.active {
		border-color: var(--accent);
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}

	.album-art-wrapper {
		position: relative;
		border: none;
		padding: 0;
		background: none;
	}

	.album-art-wrapper.clickable {
		cursor: pointer;
	}

	.album-art-wrapper.clickable:hover .art-edit-overlay {
		opacity: 1;
	}

	.art-edit-overlay {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		color: white;
		font-size: 0.85rem;
		opacity: 0;
		transition: opacity 0.2s;
	}

	.art-edit-overlay.uploading {
		opacity: 1;
	}

	.album-title-input {
		font-size: 2.5rem;
		font-weight: 700;
		background: transparent;
		border: none;
		border-bottom: 2px solid var(--accent);
		color: var(--text-primary);
		padding: 0.25rem 0;
		width: 100%;
		outline: none;
		font-family: inherit;
	}

	.album-title-input::placeholder {
		color: var(--text-muted);
	}

	.album-type {
		text-transform: uppercase;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		color: var(--text-tertiary);
		margin: 0;
	}

	.album-title {
		font-size: 3rem;
		font-weight: 700;
		margin: 0;
		color: var(--text-primary);
		line-height: 1.1;
		word-wrap: break-word;
		overflow-wrap: break-word;
		hyphens: auto;
	}

	.album-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.95rem;
		color: var(--text-secondary);
	}

	.artist-link {
		color: var(--text-secondary);
		text-decoration: none;
		font-weight: 600;
		transition: color 0.2s;
	}

	.artist-link:hover {
		color: var(--accent);
	}

	.meta-separator {
		color: var(--text-muted);
		font-size: 0.7rem;
	}

	.album-actions {
		display: flex;
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.play-button,
	.queue-button {
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

	.queue-button {
		background: transparent;
		color: var(--text-primary);
		border: 1px solid var(--border-default);
	}

	.queue-button:hover {
		border-color: var(--accent);
		color: var(--accent);
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

	@media (max-width: 768px) {
		.album-hero {
			flex-direction: column;
			align-items: flex-start;
			gap: 1.5rem;
		}

		.album-art,
		.album-art-placeholder {
			width: 160px;
			height: 160px;
		}

		.album-info-wrapper {
			flex-direction: column;
			align-items: flex-start;
			width: 100%;
		}

		.side-buttons {
			display: none;
		}

		.mobile-buttons {
			display: flex;
			gap: 0.5rem;
			justify-content: center;
			align-items: center;
		}

		.album-title {
			font-size: 2rem;
		}

		.album-meta {
			font-size: 0.85rem;
		}

		.album-actions {
			flex-direction: column;
			gap: 0.75rem;
			width: 100%;
		}

		.play-button,
		.queue-button {
			width: 100%;
			justify-content: center;
		}
	}

	@media (max-width: 480px) {
		.container {
			padding: 0 0.75rem 6rem 0.75rem;
		}

		.album-art,
		.album-art-placeholder {
			width: 140px;
			height: 140px;
		}

		.album-title {
			font-size: 1.75rem;
		}

		.album-meta {
			font-size: 0.8rem;
			flex-wrap: wrap;
		}
	}

	/* remove track button */
	.remove-track-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s;
		flex-shrink: 0;
	}

	.remove-track-btn:hover {
		color: var(--error);
		background: color-mix(in srgb, var(--error) 10%, transparent);
	}

	.remove-track-btn:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	/* modal styles */
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		backdrop-filter: blur(4px);
	}

	.modal {
		background: var(--bg-secondary);
		border-radius: 12px;
		padding: 1.5rem;
		max-width: 400px;
		width: calc(100% - 2rem);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
		border: 1px solid var(--border-subtle);
	}

	.modal-header {
		margin-bottom: 1rem;
	}

	.modal-header h3 {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.modal-body {
		margin-bottom: 1.5rem;
	}

	.modal-body p {
		margin: 0;
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.modal-footer {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
	}

	.cancel-btn,
	.confirm-btn {
		padding: 0.625rem 1.25rem;
		border-radius: 8px;
		font-weight: 500;
		font-size: 0.9rem;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
		border: none;
	}

	.cancel-btn {
		background: var(--bg-tertiary);
		color: var(--text-primary);
	}

	.cancel-btn:hover {
		background: var(--bg-hover);
	}

	.cancel-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.confirm-btn {
		background: var(--accent);
		color: var(--bg-primary);
	}

	.confirm-btn:hover {
		filter: brightness(1.1);
	}

	.confirm-btn.danger {
		background: var(--error);
	}

	.confirm-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
