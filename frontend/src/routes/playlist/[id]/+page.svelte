<script lang="ts">
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import Header from '$lib/components/Header.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import SensitiveImage from '$lib/components/SensitiveImage.svelte';
	import PlaylistCover from '$lib/components/PlaylistCover.svelte';
	import { hasPlaylistArt } from '$lib/playlist-cover';
	import AddTracksModal from '$lib/components/playlist/AddTracksModal.svelte';
	import OwnerActionButtons from '$lib/components/playlist/OwnerActionButtons.svelte';
	import PlaylistTrackList from '$lib/components/playlist/PlaylistTrackList.svelte';
	import { auth } from '$lib/auth.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { API_URL } from '$lib/config';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import { toast } from '$lib/toast.svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { playCollection, playCollectionFrom, queueCollection } from '$lib/collection-playback';
	import { fetchLikedTracks } from '$lib/tracks.svelte';
	import { createListReorder, moveItem } from '$lib/list-reorder.svelte';
	import * as playlistActions from '$lib/playlist-actions';
	import type { PlaylistTrackCandidate } from '$lib/playlist-actions';
	import type { PageData } from './$types';
	import type { PlaylistWithTracks, Track } from '$lib/types';

	let { data }: { data: PageData } = $props();
	let playlist = $state<PlaylistWithTracks>(data.playlist);
	let tracks = $state<Track[]>(data.playlist.tracks);

	// liked state hydration
	let tracksHydrated = $state(false);
	let loadedForPlaylistId = $state<string | null>(null);

	// sync tracks when navigating between playlists
	$effect(() => {
		const currentId = data.playlist.id;
		if (!currentId || !browser) return;

		if (loadedForPlaylistId !== currentId) {
			// reset state for new playlist
			tracksHydrated = false;
			playlist = data.playlist;
			tracks = data.playlist.tracks;
			loadedForPlaylistId = currentId;

			// hydrate liked state
			primeLikesFromCache();
			void hydrateTracksWithLikes();
		}
	});

	async function hydrateTracksWithLikes() {
		if (!browser || tracksHydrated) return;

		// skip if not authenticated - no need to fetch liked tracks
		if (!auth.isAuthenticated) {
			tracksHydrated = true;
			return;
		}

		try {
			const likedTracks = await fetchLikedTracks();
			const likedIds = new Set(likedTracks.map((track) => track.id));
			applyLikedFlags(likedIds);
		} catch (_e) {
			console.error('failed to hydrate playlist likes:', _e);
		} finally {
			tracksHydrated = true;
		}
	}

	function applyLikedFlags(likedIds: Set<number>) {
		let changed = false;

		const nextTracks = tracks.map((track) => {
			const nextLiked = likedIds.has(track.id);
			const currentLiked = Boolean(track.is_liked);
			if (currentLiked !== nextLiked) {
				changed = true;
				return { ...track, is_liked: nextLiked };
			}
			return track;
		});

		if (changed) {
			tracks = nextTracks;
		}
	}

	function primeLikesFromCache() {
		if (!browser) return;
		try {
			const cachedRaw = localStorage.getItem('tracks_cache');
			if (!cachedRaw) return;
			const cached = JSON.parse(cachedRaw) as { tracks?: Track[] };
			const cachedTracks = cached.tracks ?? [];
			if (cachedTracks.length === 0) return;

			const likedIds = new Set(
				cachedTracks.filter((track) => Boolean(track.is_liked)).map((track) => track.id)
			);

			if (likedIds.size > 0) {
				applyLikedFlags(likedIds);
			}
		} catch (e) {
			console.warn('failed to hydrate likes from cache', e);
		}
	}

	// add-tracks modal visibility (search state lives in AddTracksModal)
	let showSearch = $state(false);

	// UI state
	let deleting = $state(false);
	let addingTrack = $state<number | null>(null);
	let showDeleteConfirm = $state(false);
	let removingTrackId = $state<number | null>(null);

	// unified edit mode state
	let isEditMode = $state(false);
	let isSavingOrder = $state(false);

	// inline edit state
	let editName = $state('');
	let editShowOnProfile = $state(false);
	let coverInputElement = $state<HTMLInputElement | null>(null);
	let uploadingCover = $state(false);

	// recommendations state
	let recommendations = $state<PlaylistTrackCandidate[]>([]);
	let loadingRecommendations = $state(false);
	let recommendationsAvailable = $state(true);

	// drag-to-reorder (desktop + touch)
	const reorder = createListReorder((from, to) => {
		tracks = moveItem(tracks, from, to);
	});

	async function handleLogout() {
		await auth.logout();
		window.location.href = '/';
	}

	function playTrack(track: Track) {
		void playCollectionFrom(tracks, track, playlist.name);
	}

	async function playNow() {
		await playCollection(tracks, playlist.name);
	}

	function addToQueue() {
		queueCollection(tracks, playlist.name);
	}

	async function fetchRecommendations() {
		loadingRecommendations = true;
		try {
			const data = await playlistActions.fetchRecommendations(playlist.id);
			recommendationsAvailable = data.available;
			// filter out any tracks already in the playlist
			recommendations = data.tracks.filter((t) => !tracks.some((pt) => pt.id === t.id));
		} catch {
			recommendationsAvailable = false;
		} finally {
			loadingRecommendations = false;
		}
	}

	async function addTrack(candidate: PlaylistTrackCandidate) {
		addingTrack = candidate.id;

		try {
			const trackData = await playlistActions.addTrack(playlist.id, candidate.id);

			// add full track to local state
			tracks = [...tracks, trackData];

			// update playlist track count
			playlist.track_count = tracks.length;

			// remove from recommendations (the modal's results prune
			// themselves via the updated excludeUris)
			recommendations = recommendations.filter((r) => r.id !== candidate.id);

			// re-fetch recommendations (playlist context changed)
			if (isEditMode) {
				void fetchRecommendations();
			}

			toast.success(`added "${trackData.title}" to playlist`);
		} catch (e) {
			console.error('failed to add track:', e);
			toast.error(e instanceof Error ? e.message : 'failed to add track');
		} finally {
			addingTrack = null;
		}
	}

	async function removeTrack(track: Track) {
		if (!track.atproto_record_uri) {
			toast.error('track does not have ATProto record');
			return;
		}

		removingTrackId = track.id;

		try {
			await playlistActions.removeTrack(playlist.id, track.atproto_record_uri);

			tracks = tracks.filter((t) => t.id !== track.id);
			playlist.track_count = tracks.length;

			toast.success(`removed "${track.title}" from playlist`);
		} catch (e) {
			console.error('failed to remove track:', e);
			toast.error(e instanceof Error ? e.message : 'failed to remove track');
		} finally {
			removingTrackId = null;
		}
	}

	function toggleEditMode() {
		if (isEditMode) {
			// exiting edit mode - save changes
			saveAllChanges();
			recommendations = [];
		} else {
			// entering edit mode - initialize edit state
			editName = playlist.name;
			editShowOnProfile = playlist.show_on_profile;
			// fetch recommendations in background
			if (tracks.length > 0) {
				void fetchRecommendations();
			}
		}
		isEditMode = !isEditMode;
	}

	async function saveAllChanges() {
		// save track order
		await saveOrder();

		// save name and/or show_on_profile if changed
		const nameChanged = !!editName.trim() && editName.trim() !== playlist.name;
		const showOnProfileChanged = editShowOnProfile !== playlist.show_on_profile;

		if (nameChanged || showOnProfileChanged) {
			await savePlaylistMetadata(nameChanged, showOnProfileChanged);
		}
	}

	async function savePlaylistMetadata(nameChanged: boolean, showOnProfileChanged: boolean) {
		try {
			const updated = await playlistActions.updatePlaylist(playlist.id, {
				...(nameChanged ? { name: editName.trim() } : {}),
				...(showOnProfileChanged ? { show_on_profile: editShowOnProfile } : {})
			});
			playlist.name = updated.name;
			playlist.show_on_profile = updated.show_on_profile;
		} catch (e) {
			console.error('failed to save playlist:', e);
			toast.error(e instanceof Error ? e.message : 'failed to save playlist');
			// revert changes
			editName = playlist.name;
			editShowOnProfile = playlist.show_on_profile;
		}
	}

	let showVisibilityConfirm = $state(false);
	let togglingVisibility = $state(false);

	async function toggleVisibility() {
		togglingVisibility = true;
		const goingPrivate = !playlist.is_private;
		try {
			// flush any pending edit-mode changes (reorder, name edit) before
			// the privacy transition so the publish/snapshot sees the latest
			// state instead of silently dropping unsaved edits
			if (isEditMode) {
				await saveAllChanges();
			}

			const updated = await playlistActions.updatePlaylist(playlist.id, {
				is_private: goingPrivate
			});
			playlist.is_private = updated.is_private;
			playlist.atproto_record_uri = updated.atproto_record_uri;
			playlist.show_on_profile = updated.show_on_profile;
			editShowOnProfile = updated.show_on_profile;
			toast.success(goingPrivate ? 'playlist is now private' : 'playlist is now public');
			showVisibilityConfirm = false;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'failed to change visibility');
		} finally {
			togglingVisibility = false;
		}
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
			const result = await playlistActions.uploadCover(playlist.id, file);
			playlist.image_url = result.image_url;
			toast.success('cover updated');
		} catch (e) {
			console.error('failed to upload cover:', e);
			toast.error(e instanceof Error ? e.message : 'failed to upload cover');
		} finally {
			uploadingCover = false;
		}
	}

	async function saveOrder() {
		isSavingOrder = true;
		try {
			const saved = await playlistActions.reorderTracks(playlist.id, tracks);
			if (saved) {
				toast.success('order saved');
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'failed to save order');
		} finally {
			isSavingOrder = false;
		}
	}

	async function deletePlaylist() {
		deleting = true;

		try {
			await playlistActions.deletePlaylist(playlist.id);

			toast.success('playlist deleted');
			goto('/library');
		} catch (e) {
			console.error('failed to delete playlist:', e);
			toast.error(e instanceof Error ? e.message : 'failed to delete playlist');
			deleting = false;
			showDeleteConfirm = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			if (showSearch) {
				showSearch = false;
			}
			if (showDeleteConfirm) {
				showDeleteConfirm = false;
			}
			if (isEditMode) {
				// revert name change and exit edit mode
				editName = playlist.name;
				isEditMode = false;
			}
		}
	}

	// check if user owns this playlist
	const isOwner = $derived(auth.user?.did === playlist.owner_did);

	// check if current track is from this playlist (active, regardless of paused state)
	const isPlaylistActive = $derived(
		player.currentTrack !== null && tracks.some((t) => t.id === player.currentTrack?.id)
	);

	// check if actively playing (not paused)
	const isPlaylistPlaying = $derived(isPlaylistActive && !player.paused);
</script>

<svelte:window on:keydown={handleKeydown} />

<svelte:head>
	<title>{playlist.name} • plyr</title>
	<meta
		name="description"
		content="playlist by @{playlist.owner_handle} • {playlist.track_count} {playlist.track_count ===
		1
			? 'track'
			: 'tracks'} on {APP_NAME}"
	/>

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="music.playlist" />
	<meta property="og:title" content={playlist.name} />
	<meta
		property="og:description"
		content="playlist by @{playlist.owner_handle} • {playlist.track_count} {playlist.track_count ===
		1
			? 'track'
			: 'tracks'}"
	/>
	<meta property="og:url" content="{APP_CANONICAL_URL}/playlist/{playlist.id}" />
	<meta property="og:site_name" content={APP_NAME} />
	{#if playlist.image_url}
		<meta property="og:image" content={playlist.image_url} />
	{/if}

	<!-- Twitter -->
	<meta name="twitter:card" content={playlist.image_url ? 'summary_large_image' : 'summary'} />
	<meta name="twitter:title" content={playlist.name} />
	<meta
		name="twitter:description"
		content="playlist by @{playlist.owner_handle} • {playlist.track_count} {playlist.track_count ===
		1
			? 'track'
			: 'tracks'}"
	/>
	{#if playlist.image_url}
		<meta name="twitter:image" content={playlist.image_url} />
	{/if}
	<link
		rel="alternate"
		type="application/json+oembed"
		title={playlist.name}
		href="{API_URL}/oembed?url={encodeURIComponent(`${APP_CANONICAL_URL}/playlist/${playlist.id}`)}"
	/>
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

<div class="container">
	<main>
		<div class="playlist-hero" class:edit-mode={isEditMode && isOwner}>
			<!-- hidden file input for cover upload -->
			<input
				type="file"
				accept="image/jpeg,image/png,image/webp"
				bind:this={coverInputElement}
				onchange={handleCoverSelect}
				hidden
			/>
			{#if isEditMode && isOwner}
				<button
					class="playlist-art-wrapper clickable"
					onclick={() => coverInputElement?.click()}
					type="button"
					aria-label="change cover image"
					disabled={uploadingCover}
				>
					{#if hasPlaylistArt(playlist)}
						<div class="playlist-art">
							<PlaylistCover
								imageUrl={playlist.image_url}
								previews={playlist.preview_thumbnails}
								alt="{playlist.name} artwork"
							/>
						</div>
					{:else}
						<div class="playlist-art-placeholder">
							<svg
								width="64"
								height="64"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
							>
								<line x1="8" y1="6" x2="21" y2="6"></line>
								<line x1="8" y1="12" x2="21" y2="12"></line>
								<line x1="8" y1="18" x2="21" y2="18"></line>
								<line x1="3" y1="6" x2="3.01" y2="6"></line>
								<line x1="3" y1="12" x2="3.01" y2="12"></line>
								<line x1="3" y1="18" x2="3.01" y2="18"></line>
							</svg>
						</div>
					{/if}
					<div class="art-edit-overlay" class:uploading={uploadingCover}>
						{#if uploadingCover}
							<svg
								width="24"
								height="24"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								class="spinner"
							>
								<circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"
								></circle>
							</svg>
							<span>uploading...</span>
						{:else}
							<svg
								width="24"
								height="24"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
								<circle cx="8.5" cy="8.5" r="1.5"></circle>
								<polyline points="21 15 16 10 5 21"></polyline>
							</svg>
							<span>change cover</span>
						{/if}
					</div>
				</button>
			{:else}
				<div class="playlist-art-wrapper">
					{#if playlist.image_url}
						<SensitiveImage src={playlist.image_url} tooltipPosition="center">
							<img src={playlist.image_url} alt="{playlist.name} artwork" class="playlist-art" />
						</SensitiveImage>
					{:else if playlist.preview_thumbnails?.length}
						<div class="playlist-art">
							<PlaylistCover
								previews={playlist.preview_thumbnails}
								alt="{playlist.name} artwork"
							/>
						</div>
					{:else}
						<div class="playlist-art-placeholder">
							<svg
								width="64"
								height="64"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
							>
								<line x1="8" y1="6" x2="21" y2="6"></line>
								<line x1="8" y1="12" x2="21" y2="12"></line>
								<line x1="8" y1="18" x2="21" y2="18"></line>
								<line x1="3" y1="6" x2="3.01" y2="6"></line>
								<line x1="3" y1="12" x2="3.01" y2="12"></line>
								<line x1="3" y1="18" x2="3.01" y2="18"></line>
							</svg>
						</div>
					{/if}
				</div>
			{/if}
			<div class="playlist-info-wrapper">
				<div class="playlist-info">
					<p class="playlist-type">{playlist.is_private ? 'private playlist' : 'playlist'}</p>
					{#if isEditMode && isOwner}
						<input
							type="text"
							class="playlist-title-input"
							bind:value={editName}
							placeholder="playlist name"
						/>
					{:else}
						<h1 class="playlist-title">{playlist.name}</h1>
					{/if}
					<div class="playlist-meta">
						<a href="/u/{playlist.owner_handle}" class="owner-link">
							{playlist.owner_handle}
						</a>
						<span class="meta-separator">•</span>
						<span
							>{playlist.track_count}
							{playlist.track_count === 1 ? 'track' : 'tracks'}</span
						>
					</div>
					{#if isEditMode && isOwner && !playlist.is_private}
						<label class="show-on-profile-toggle">
							<input type="checkbox" bind:checked={editShowOnProfile} />
							<span class="toggle-label">show on profile</span>
						</label>
					{/if}
					{#if isEditMode && isOwner}
						<button
							type="button"
							class="visibility-toggle-btn"
							onclick={() => (showVisibilityConfirm = true)}
							disabled={togglingVisibility}
						>
							{playlist.is_private ? 'make public' : 'make private'}
						</button>
					{/if}
				</div>

				<div class="side-buttons">
					{#if !playlist.is_private}
						<ShareButton url={$page.url.href} title="share playlist" />
					{/if}
					{#if isOwner}
						<OwnerActionButtons
							{isEditMode}
							{isSavingOrder}
							onToggleEdit={toggleEditMode}
							onDelete={() => (showDeleteConfirm = true)}
						/>
					{/if}
				</div>
			</div>
		</div>

		<div class="playlist-actions">
			<button
				class="play-button"
				class:is-playing={isPlaylistPlaying}
				onclick={() => (isPlaylistActive ? queue.togglePlayPause() : playNow())}
			>
				{#if isPlaylistPlaying}
					<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
						<path d="M6 4h4v16H6zM14 4h4v16h-4z" />
					</svg>
					pause
				{:else}
					<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
						<path d="M8 5v14l11-7z" />
					</svg>
					play
				{/if}
			</button>
			<button class="queue-button" onclick={addToQueue}>
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
				>
					<line x1="5" y1="15" x2="5" y2="21"></line>
					<line x1="2" y1="18" x2="8" y2="18"></line>
					<line x1="9" y1="6" x2="21" y2="6"></line>
					<line x1="9" y1="12" x2="21" y2="12"></line>
					<line x1="9" y1="18" x2="21" y2="18"></line>
				</svg>
				add to queue
			</button>
			<div class="mobile-buttons">
				{#if !playlist.is_private}
					<ShareButton url={$page.url.href} title="share playlist" />
				{/if}
				{#if isOwner}
					<OwnerActionButtons
						{isEditMode}
						{isSavingOrder}
						onToggleEdit={toggleEditMode}
						onDelete={() => (showDeleteConfirm = true)}
					/>
				{/if}
			</div>
		</div>

		<PlaylistTrackList
			{tracks}
			playlistId={playlist.id}
			{isOwner}
			{isEditMode}
			{reorder}
			{removingTrackId}
			addingTrackId={addingTrack}
			{recommendations}
			{recommendationsAvailable}
			{loadingRecommendations}
			onPlayTrack={playTrack}
			onRemoveTrack={removeTrack}
			onAddCandidate={addTrack}
			onRequestAdd={() => (showSearch = true)}
		/>
	</main>
</div>

<AddTracksModal
	bind:open={showSearch}
	excludeTrackIds={tracks.map((t) => t.id)}
	addingTrackId={addingTrack}
	onAdd={addTrack}
/>

<ConfirmDialog
	bind:open={showVisibilityConfirm}
	title={playlist.is_private ? 'make this playlist public?' : 'make this playlist private?'}
	body={playlist.is_private
		? `"${playlist.name}" will be published to your PDS as a public list record. anyone with the link will be able to see it.`
		: `"${playlist.name}" will be removed from your PDS and only you will be able to see it. it won't appear in search, on your profile, or in the activity feed.`}
	confirmText={playlist.is_private ? 'make public' : 'make private'}
	pending={togglingVisibility}
	pendingText="working..."
	onConfirm={toggleVisibility}
/>

<ConfirmDialog
	bind:open={showDeleteConfirm}
	title="delete playlist?"
	body={`are you sure you want to delete "${playlist.name}"? this action cannot be undone.`}
	confirmText="delete"
	variant="danger"
	pending={deleting}
	pendingText="deleting..."
	onConfirm={deletePlaylist}
/>

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
		border-radius: var(--radius-md);
		object-fit: cover;
		overflow: hidden;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	.playlist-art-placeholder {
		width: 200px;
		height: 200px;
		border-radius: var(--radius-md);
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}

	.playlist-art-wrapper {
		position: relative;
		width: 200px;
		height: 200px;
		flex-shrink: 0;
	}

	button.playlist-art-wrapper {
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		font-family: inherit;
	}

	button.playlist-art-wrapper.clickable:hover .art-edit-overlay {
		opacity: 1;
	}

	button.playlist-art-wrapper.clickable:hover .playlist-art,
	button.playlist-art-wrapper.clickable:hover .playlist-art-placeholder {
		filter: brightness(0.7);
	}

	.art-edit-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		color: white;
		opacity: 0;
		transition: opacity 0.2s;
		pointer-events: none;
		border-radius: var(--radius-md);
		font-family: inherit;
	}

	.art-edit-overlay span {
		font-family: inherit;
		font-size: var(--text-sm);
		font-weight: 500;
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

	.mobile-buttons {
		display: none;
	}

	.playlist-type {
		text-transform: uppercase;
		font-size: var(--text-xs);
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

	.playlist-title-input {
		font-size: 3rem;
		font-weight: 700;
		font-family: inherit;
		margin: 0;
		color: var(--text-primary);
		line-height: 1.1;
		background: transparent;
		border: none;
		border-bottom: 2px solid var(--accent);
		outline: none;
		width: 100%;
		padding: 0;
	}

	.playlist-title-input::placeholder {
		color: var(--text-muted);
	}

	.playlist-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: var(--text-base);
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
		font-size: var(--text-xs);
	}

	.show-on-profile-toggle {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.75rem;
		cursor: pointer;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.show-on-profile-toggle input[type='checkbox'] {
		width: 16px;
		height: 16px;
		accent-color: var(--accent);
		cursor: pointer;
	}

	.show-on-profile-toggle .toggle-label {
		user-select: none;
	}

	.show-on-profile-toggle:hover .toggle-label {
		color: var(--text-primary);
	}

	.visibility-toggle-btn {
		/* align-self prevents the flex column from stretching this to full
		   width like a text input. matches the visual register of the
		   .queue-button pill but at a smaller, secondary scale. */
		align-self: flex-start;
		margin-top: 0.5rem;
		padding: 0.4rem 1rem;
		background: var(--glass-btn-bg, transparent);
		border: 1px solid var(--glass-btn-border, var(--border-default));
		border-radius: var(--radius-2xl);
		font-family: inherit;
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text-secondary);
		cursor: pointer;
		transition:
			border-color 0.15s,
			color 0.15s,
			background 0.15s;
	}

	.visibility-toggle-btn:hover:not(:disabled) {
		background: var(--glass-btn-bg-hover, transparent);
		border-color: var(--accent);
		color: var(--accent);
	}

	.visibility-toggle-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* playlist actions */
	.playlist-actions {
		display: flex;
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.play-button,
	.queue-button {
		padding: 0.75rem 1.5rem;
		border-radius: var(--radius-2xl);
		font-weight: 600;
		font-size: var(--text-base);
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

	.play-button.is-playing {
		animation: ethereal-glow 3s ease-in-out infinite;
	}

	.queue-button {
		background: var(--glass-btn-bg, transparent);
		color: var(--text-primary);
		border: 1px solid var(--glass-btn-border, var(--border-default));
	}

	.queue-button:hover {
		background: var(--glass-btn-bg-hover, transparent);
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

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: var(--radius-full);
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
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

		.mobile-buttons {
			display: flex;
			gap: 0.5rem;
			justify-content: center;
			align-items: center;
		}

		.playlist-title,
		.playlist-title-input {
			font-size: 2rem;
		}

		.playlist-meta {
			font-size: var(--text-sm);
		}

		.playlist-actions {
			flex-direction: column;
			gap: 0.75rem;
			width: 100%;
		}

		.play-button,
		.queue-button {
			width: 100%;
			justify-content: center;
		}

		.playlist-art-wrapper {
			width: 160px;
			height: 160px;
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

		.playlist-art-wrapper {
			width: 140px;
			height: 140px;
		}

		.playlist-title,
		.playlist-title-input {
			font-size: 1.75rem;
		}

		.playlist-meta {
			font-size: var(--text-sm);
			flex-wrap: wrap;
		}
	}
</style>
