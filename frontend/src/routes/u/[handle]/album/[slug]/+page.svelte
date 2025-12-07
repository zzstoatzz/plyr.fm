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

	const album = $derived(data.album);
	const isAuthenticated = $derived(auth.isAuthenticated);

	// check if current user owns this album
	const isOwner = $derived(auth.user?.did === album.metadata.artist_did);
	// can only reorder if owner and album has an ATProto list
	const canReorder = $derived(isOwner && !!album.metadata.list_uri);

	// local mutable copy of tracks for reordering
	let tracks = $state<Track[]>([...data.album.tracks]);

	// sync when data changes (e.g., navigation)
	$effect(() => {
		tracks = [...data.album.tracks];
	});

	// edit mode state
	let isEditMode = $state(false);
	let isSaving = $state(false);

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
			toast.success(`playing ${album.metadata.title}`, 1800);
		}
	}

	function addToQueue() {
		if (tracks.length > 0) {
			queue.addTracks(tracks);
			toast.success(`added ${album.metadata.title} to queue`, 1800);
		}
	}

	function toggleEditMode() {
		if (isEditMode) {
			saveOrder();
		}
		isEditMode = !isEditMode;
	}

	async function saveOrder() {
		if (!album.metadata.list_uri) return;

		// extract rkey from list URI (at://did/collection/rkey)
		const rkey = album.metadata.list_uri.split('/').pop();
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
			shareUrl = `${window.location.origin}/u/${album.metadata.artist_handle}/album/${album.metadata.slug}`;
		}
	});
</script>

<svelte:head>
	<title>{album.metadata.title} by {album.metadata.artist} - plyr.fm</title>
	<meta name="description" content="{album.metadata.title} by {album.metadata.artist} - {album.metadata.track_count} tracks on plyr.fm" />

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="music.album" />
	<meta property="og:title" content="{album.metadata.title} by {album.metadata.artist}" />
	<meta property="og:description" content="{album.metadata.track_count} tracks • {album.metadata.total_plays} plays" />
	<meta property="og:url" content="{APP_CANONICAL_URL}/u/{album.metadata.artist_handle}/album/{album.metadata.slug}" />
	<meta property="og:site_name" content={APP_NAME} />
	<meta property="music:musician" content="{album.metadata.artist_handle}" />
	{#if album.metadata.image_url && !isImageSensitiveSSR(album.metadata.image_url)}
		<meta property="og:image" content="{album.metadata.image_url}" />
		<meta property="og:image:secure_url" content="{album.metadata.image_url}" />
		<meta property="og:image:width" content="1200" />
		<meta property="og:image:height" content="1200" />
		<meta property="og:image:alt" content="{album.metadata.title} by {album.metadata.artist}" />
	{/if}

	<!-- Twitter -->
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content="{album.metadata.title} by {album.metadata.artist}" />
	<meta name="twitter:description" content="{album.metadata.track_count} tracks • {album.metadata.total_plays} plays" />
	{#if album.metadata.image_url && !isImageSensitiveSSR(album.metadata.image_url)}
		<meta name="twitter:image" content="{album.metadata.image_url}" />
	{/if}
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={() => goto('/login')} />
<div class="container">
	<main>
		<div class="album-hero">
			{#if album.metadata.image_url}
				<SensitiveImage src={album.metadata.image_url} tooltipPosition="center">
					<img src={album.metadata.image_url} alt="{album.metadata.title} artwork" class="album-art" />
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
					<h1 class="album-title">{album.metadata.title}</h1>
					<div class="album-meta">
						<a href="/u/{album.metadata.artist_handle}" class="artist-link">
							{album.metadata.artist}
						</a>
						<span class="meta-separator">•</span>
						<span>{album.metadata.track_count} {album.metadata.track_count === 1 ? 'track' : 'tracks'}</span>
						<span class="meta-separator">•</span>
						<span>{album.metadata.total_plays} {album.metadata.total_plays === 1 ? 'play' : 'plays'}</span>
					</div>
				</div>

				<div class="side-button-right">
					<ShareButton url={shareUrl} title="share album" />
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
			{#if canReorder}
				<button
					class="reorder-button"
					class:active={isEditMode}
					onclick={toggleEditMode}
					disabled={isSaving}
					title={isEditMode ? 'save order' : 'reorder tracks'}
				>
					{#if isEditMode}
						{#if isSaving}
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
			<div class="mobile-share-button">
				<ShareButton url={shareUrl} title="share album" />
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
									isPlaying={player.currentTrack?.id === track.id}
									onPlay={playTrack}
									{isAuthenticated}
									hideAlbum={true}
									hideArtist={true}
								/>
							</div>
						</div>
					{:else}
						<TrackItem
							{track}
							index={i}
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

	.side-button-right {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding-bottom: 0.5rem;
	}

	.mobile-share-button {
		display: none;
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
		background: transparent;
		color: var(--text-primary);
		border: 1px solid var(--border-default);
	}

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

		.side-button-right {
			display: none;
		}

		.mobile-share-button {
			display: flex;
			width: 100%;
			justify-content: center;
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
		.queue-button,
		.reorder-button {
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
</style>
