<script lang="ts">
	import { likeTrack, unlikeTrack } from '$lib/tracks.svelte';
	import { toast } from '$lib/toast.svelte';
	import { API_URL } from '$lib/config';
	import type { Playlist } from '$lib/types';

	interface Props {
		trackId: number;
		trackTitle: string;
		trackUri?: string;
		trackCid?: string;
		fileId?: string;
		gated?: boolean;
		initialLiked: boolean;
		shareUrl: string;
		onQueue: () => void;
		isAuthenticated: boolean;
		likeDisabled?: boolean;
		excludePlaylistId?: string;
	}

	let {
		trackId,
		trackTitle,
		trackUri,
		trackCid,
		fileId,
		gated,
		initialLiked,
		shareUrl,
		onQueue,
		isAuthenticated,
		likeDisabled = false,
		excludePlaylistId
	}: Props = $props();

	let showMenu = $state(false);
	let showPlaylistPicker = $state(false);
	let showCreateForm = $state(false);
	let newPlaylistName = $state('');
	let creatingPlaylist = $state(false);
	let liked = $state(initialLiked);
	let loading = $state(false);
	let playlists = $state<Playlist[]>([]);
	let loadingPlaylists = $state(false);
	let addingToPlaylist = $state<string | null>(null);

	// filter out the excluded playlist (must be after playlists state declaration)
	let filteredPlaylists = $derived(
		excludePlaylistId ? playlists.filter(p => p.id !== excludePlaylistId) : playlists
	);

	// update liked state when initialLiked changes
	$effect(() => {
		liked = initialLiked;
	});

	function toggleMenu(e: Event) {
		e.stopPropagation();
		showMenu = !showMenu;
		if (!showMenu) {
			showPlaylistPicker = false;
		}
	}

	function closeMenu() {
		showMenu = false;
		showPlaylistPicker = false;
		showCreateForm = false;
		newPlaylistName = '';
	}

	function handleQueue(e: Event) {
		e.stopPropagation();
		onQueue();
		closeMenu();
	}

	async function handleShare(e: Event) {
		e.stopPropagation();
		try {
			await navigator.clipboard.writeText(shareUrl);
			toast.success('link copied');
			closeMenu();
		} catch {
			toast.error('failed to copy link');
		}
	}

	async function handleLike(e: Event) {
		e.stopPropagation();

		if (loading || likeDisabled) {
			if (likeDisabled) {
				toast.error("track's record is unavailable");
			}
			return;
		}

		loading = true;
		const previousState = liked;
		liked = !liked;

		try {
			const success = liked
				? await likeTrack(trackId, fileId, gated)
				: await unlikeTrack(trackId);

			if (!success) {
				liked = previousState;
				toast.error('failed to update like');
			} else {
				if (liked) {
					toast.success(`liked ${trackTitle}`);
				} else {
					toast.info(`unliked ${trackTitle}`);
				}
			}
			closeMenu();
		} catch {
			liked = previousState;
			toast.error('failed to update like');
		} finally {
			loading = false;
		}
	}

	async function showPlaylists(e: Event) {
		e.stopPropagation();
		if (!trackUri || !trackCid) {
			toast.error('track cannot be added to playlists');
			return;
		}

		showPlaylistPicker = true;
		if (playlists.length === 0) {
			loadingPlaylists = true;
			try {
				const response = await fetch(`${API_URL}/lists/playlists`, {
					credentials: 'include'
				});
				if (response.ok) {
					playlists = await response.json();
				}
			} catch {
				toast.error('failed to load playlists');
			} finally {
				loadingPlaylists = false;
			}
		}
	}

	async function addToPlaylist(playlist: Playlist, e: Event) {
		e.stopPropagation();
		if (!trackUri || !trackCid) return;

		addingToPlaylist = playlist.id;
		try {
			const response = await fetch(`${API_URL}/lists/playlists/${playlist.id}/tracks`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					track_uri: trackUri,
					track_cid: trackCid
				})
			});

			if (response.ok) {
				toast.success(`added to ${playlist.name}`);
				closeMenu();
			} else {
				const data = await response.json().catch(() => ({}));
				toast.error(data.detail || 'failed to add to playlist');
			}
		} catch {
			toast.error('failed to add to playlist');
		} finally {
			addingToPlaylist = null;
		}
	}

	function goBack(e: Event) {
		e.stopPropagation();
		if (showCreateForm) {
			showCreateForm = false;
			newPlaylistName = '';
		} else {
			showPlaylistPicker = false;
		}
	}

	async function createPlaylist(e: Event) {
		e.stopPropagation();
		if (!newPlaylistName.trim() || !trackUri || !trackCid) return;

		creatingPlaylist = true;
		try {
			// create the playlist
			const createResponse = await fetch(`${API_URL}/lists/playlists`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newPlaylistName.trim() })
			});

			if (!createResponse.ok) {
				const data = await createResponse.json().catch(() => ({}));
				throw new Error(data.detail || 'failed to create playlist');
			}

			const playlist = await createResponse.json();

			// add the track to the new playlist
			const addResponse = await fetch(`${API_URL}/lists/playlists/${playlist.id}/tracks`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					track_uri: trackUri,
					track_cid: trackCid
				})
			});

			if (addResponse.ok) {
				toast.success(`created "${playlist.name}" and added track`);
			} else {
				toast.success(`created "${playlist.name}"`);
			}

			closeMenu();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'failed to create playlist');
		} finally {
			creatingPlaylist = false;
		}
	}
</script>

<div class="actions-menu">
	<button class="menu-button" onclick={toggleMenu} title="actions">
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="12" cy="5" r="1"></circle>
			<circle cx="12" cy="12" r="1"></circle>
			<circle cx="12" cy="19" r="1"></circle>
		</svg>
	</button>

	{#if showMenu}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="menu-backdrop" role="presentation" onclick={closeMenu}></div>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="menu-panel" role="menu" tabindex="-1" onclick={(e) => {
			// don't stop propagation for links - let SvelteKit handle navigation
			if (e.target instanceof HTMLAnchorElement || (e.target as HTMLElement).closest('a')) {
				return;
			}
			e.stopPropagation();
		}}>
			{#if !showPlaylistPicker}
				{#if isAuthenticated}
					<button class="menu-item" onclick={handleLike} disabled={loading || likeDisabled} class:disabled={likeDisabled}>
						<svg width="18" height="18" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
						</svg>
						<span>{liked ? 'remove from liked' : 'add to liked'}</span>
					</button>
					{#if trackUri && trackCid}
						<button class="menu-item" onclick={showPlaylists}>
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<line x1="8" y1="6" x2="21" y2="6"></line>
								<line x1="8" y1="12" x2="21" y2="12"></line>
								<line x1="8" y1="18" x2="21" y2="18"></line>
								<line x1="3" y1="6" x2="3.01" y2="6"></line>
								<line x1="3" y1="12" x2="3.01" y2="12"></line>
								<line x1="3" y1="18" x2="3.01" y2="18"></line>
							</svg>
							<span>add to playlist</span>
							<svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M9 18l6-6-6-6"/>
							</svg>
						</button>
					{/if}
				{/if}
				<button class="menu-item" onclick={handleQueue}>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
						<line x1="5" y1="15" x2="5" y2="21"></line>
						<line x1="2" y1="18" x2="8" y2="18"></line>
						<line x1="9" y1="6" x2="21" y2="6"></line>
						<line x1="9" y1="12" x2="21" y2="12"></line>
						<line x1="9" y1="18" x2="21" y2="18"></line>
					</svg>
					<span>add to queue</span>
				</button>
				<button class="menu-item" onclick={handleShare}>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="18" cy="5" r="3"></circle>
						<circle cx="6" cy="12" r="3"></circle>
						<circle cx="18" cy="19" r="3"></circle>
						<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
						<line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
					</svg>
					<span>share</span>
				</button>
			{:else}
				<div class="playlist-picker">
					<button class="back-button" onclick={goBack}>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M15 18l-6-6 6-6"/>
						</svg>
						<span>back</span>
					</button>
					{#if showCreateForm}
						<div class="create-form">
							<input
								type="text"
								bind:value={newPlaylistName}
								placeholder="playlist name"
								disabled={creatingPlaylist}
								onkeydown={(e) => {
									if (e.key === 'Enter' && newPlaylistName.trim()) {
										createPlaylist(e);
									}
								}}
							/>
							<button
								class="create-btn"
								onclick={createPlaylist}
								disabled={creatingPlaylist || !newPlaylistName.trim()}
							>
								{#if creatingPlaylist}
									<span class="spinner small"></span>
								{:else}
									create & add
								{/if}
							</button>
						</div>
					{:else}
						<div class="playlist-list">
							{#if loadingPlaylists}
								<div class="loading-state">
									<span class="spinner"></span>
									<span>loading...</span>
								</div>
							{:else if filteredPlaylists.length === 0}
								<div class="empty-state">
									<span>no playlists</span>
								</div>
							{:else}
								{#each filteredPlaylists as playlist}
									<button
										class="playlist-item"
										onclick={(e) => addToPlaylist(playlist, e)}
										disabled={addingToPlaylist === playlist.id}
									>
										{#if playlist.image_url}
											<img src={playlist.image_url} alt="" class="playlist-thumb" />
										{:else}
											<div class="playlist-thumb-placeholder">
												<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
													<line x1="8" y1="6" x2="21" y2="6"></line>
													<line x1="8" y1="12" x2="21" y2="12"></line>
													<line x1="8" y1="18" x2="21" y2="18"></line>
													<line x1="3" y1="6" x2="3.01" y2="6"></line>
													<line x1="3" y1="12" x2="3.01" y2="12"></line>
													<line x1="3" y1="18" x2="3.01" y2="18"></line>
												</svg>
											</div>
										{/if}
										<span class="playlist-name">{playlist.name}</span>
										{#if addingToPlaylist === playlist.id}
											<span class="spinner small"></span>
										{/if}
									</button>
								{/each}
							{/if}
							<button class="create-playlist-btn" onclick={(e) => { e.stopPropagation(); showCreateForm = true; }}>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<line x1="12" y1="5" x2="12" y2="19"></line>
									<line x1="5" y1="12" x2="19" y2="12"></line>
								</svg>
								<span>create new playlist</span>
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.actions-menu {
		position: relative;
	}

	.menu-button {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.2s;
	}

	.menu-button:hover {
		background: var(--bg-tertiary);
		border-color: var(--accent);
		color: var(--accent);
	}

	.menu-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 100;
		background: rgba(0, 0, 0, 0.4);
	}

	.menu-panel {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		background: var(--bg-secondary);
		border-radius: 0 0 16px 16px;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
		z-index: 101;
		animation: slideDown 0.2s ease-out;
		padding-top: env(safe-area-inset-top, 0);
		max-height: 70vh;
		overflow-y: auto;
	}

	@keyframes slideDown {
		from {
			transform: translateY(-100%);
		}
		to {
			transform: translateY(0);
		}
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: transparent;
		border: none;
		color: var(--text-primary);
		cursor: pointer;
		padding: 1rem 1.25rem;
		transition: all 0.15s;
		font-family: inherit;
		width: 100%;
		text-align: left;
		border-bottom: 1px solid var(--border-subtle);
	}

	.menu-item:last-child {
		border-bottom: none;
	}

	.menu-item:hover,
	.menu-item:active {
		background: var(--bg-tertiary);
	}

	.menu-item span {
		font-size: 1rem;
		font-weight: 400;
		flex: 1;
	}

	.menu-item svg {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
	}

	.menu-item .chevron {
		color: var(--text-muted);
	}

	.menu-item:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.playlist-picker {
		display: flex;
		flex-direction: column;
	}

	.back-button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 1rem 1.25rem;
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--border-default);
		color: var(--text-secondary);
		font-size: 0.9rem;
		font-family: inherit;
		cursor: pointer;
		transition: background 0.15s;
	}

	.back-button:hover,
	.back-button:active {
		background: var(--bg-tertiary);
	}

	.playlist-list {
		max-height: 50vh;
		overflow-y: auto;
	}

	.playlist-item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1.25rem;
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--border-subtle);
		color: var(--text-primary);
		font-size: 1rem;
		font-family: inherit;
		cursor: pointer;
		transition: background 0.15s;
		text-align: left;
	}

	.playlist-item:last-child {
		border-bottom: none;
	}

	.playlist-item:hover,
	.playlist-item:active {
		background: var(--bg-tertiary);
	}

	.playlist-item:disabled {
		opacity: 0.6;
	}

	.playlist-thumb,
	.playlist-thumb-placeholder {
		width: 36px;
		height: 36px;
		border-radius: var(--radius-sm);
		flex-shrink: 0;
	}

	.playlist-thumb {
		object-fit: cover;
	}

	.playlist-thumb-placeholder {
		background: var(--bg-tertiary);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}

	.playlist-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.loading-state,
	.empty-state {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 2rem 1rem;
		color: var(--text-tertiary);
		font-size: 0.9rem;
	}

	.create-playlist-btn {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1.25rem;
		background: transparent;
		border: none;
		border-top: 1px solid var(--border-subtle);
		color: var(--accent);
		font-size: 1rem;
		font-family: inherit;
		cursor: pointer;
		transition: background 0.15s;
		text-align: left;
	}

	.create-playlist-btn:hover,
	.create-playlist-btn:active {
		background: var(--bg-tertiary);
	}

	.create-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
	}

	.create-form input {
		width: 100%;
		padding: 0.75rem 1rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-family: inherit;
		font-size: 1rem;
	}

	.create-form input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.create-form input::placeholder {
		color: var(--text-muted);
	}

	.create-form .create-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		background: var(--accent);
		border: none;
		border-radius: var(--radius-md);
		color: white;
		font-family: inherit;
		font-size: 1rem;
		font-weight: 500;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.create-form .create-btn:hover:not(:disabled) {
		opacity: 0.9;
	}

	.create-form .create-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.spinner {
		width: 18px;
		height: 18px;
		border: 2px solid var(--border-default);
		border-top-color: var(--accent);
		border-radius: var(--radius-full);
		animation: spin 0.8s linear infinite;
	}

	.spinner.small {
		width: 16px;
		height: 16px;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* desktop: show as dropdown instead of bottom sheet */
	@media (min-width: 769px) {
		.menu-backdrop {
			background: transparent;
		}

		.menu-panel {
			position: absolute;
			bottom: auto;
			left: auto;
			right: 100%;
			top: 50%;
			transform: translateY(-50%);
			margin-right: 0.5rem;
			border-radius: var(--radius-md);
			min-width: 180px;
			max-height: none;
			animation: slideIn 0.15s cubic-bezier(0.16, 1, 0.3, 1);
			padding-bottom: 0;
		}

		@keyframes slideIn {
			from {
				opacity: 0;
				transform: translateY(-50%) scale(0.95);
			}
			to {
				opacity: 1;
				transform: translateY(-50%) scale(1);
			}
		}

		.menu-item {
			padding: 0.75rem 1rem;
		}

		.menu-item span {
			font-size: 0.9rem;
		}

		.menu-item svg {
			width: 18px;
			height: 18px;
		}

		.back-button {
			padding: 0.75rem 1rem;
		}

		.playlist-item {
			padding: 0.625rem 1rem;
			font-size: 0.9rem;
		}

		.playlist-thumb,
		.playlist-thumb-placeholder {
			width: 32px;
			height: 32px;
		}

		.playlist-list {
			max-height: 200px;
		}

		.loading-state,
		.empty-state {
			padding: 1.5rem 1rem;
		}
	}
</style>
