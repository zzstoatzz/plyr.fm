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
		initialLiked?: boolean;
		disabled?: boolean;
		disabledReason?: string;
		onLikeChange?: (_liked: boolean) => void;
		excludePlaylistId?: string;
		shareUrl?: string;
		onQueue?: () => void;
	}

	let {
		trackId,
		trackTitle,
		trackUri,
		trackCid,
		initialLiked = false,
		disabled = false,
		disabledReason,
		onLikeChange,
		excludePlaylistId,
		shareUrl,
		onQueue
	}: Props = $props();

	let liked = $state(initialLiked);
	let loading = $state(false);
	let menuOpen = $state(false);
	let showPlaylistPicker = $state(false);
	let showCreateForm = $state(false);
	let newPlaylistName = $state('');
	let creatingPlaylist = $state(false);
	let playlists = $state<Playlist[]>([]);
	let loadingPlaylists = $state(false);
	let addingToPlaylist = $state<string | null>(null);
	let openUpward = $state(false);
	let triggerRef = $state<HTMLButtonElement | null>(null);

	// filter out the excluded playlist (must be after playlists state declaration)
	let filteredPlaylists = $derived(
		excludePlaylistId ? playlists.filter(p => p.id !== excludePlaylistId) : playlists
	);

	// update liked state when initialLiked changes
	$effect(() => {
		liked = initialLiked;
	});

	// close menu when clicking outside
	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.add-to-menu')) {
			menuOpen = false;
			showPlaylistPicker = false;
		}
	}

	$effect(() => {
		if (menuOpen) {
			document.addEventListener('click', handleClickOutside);
			return () => document.removeEventListener('click', handleClickOutside);
		}
	});

	function toggleMenu(e: Event) {
		e.stopPropagation();
		if (disabled) return;

		if (!menuOpen && triggerRef) {
			// check if there's enough space below (accounting for player height ~150px)
			const rect = triggerRef.getBoundingClientRect();
			const spaceBelow = window.innerHeight - rect.bottom;
			const menuHeight = 300; // approximate menu height
			const playerHeight = 150; // approximate player height
			openUpward = spaceBelow < menuHeight + playerHeight;
		}

		menuOpen = !menuOpen;
		console.log('[AddToMenu] toggleMenu called, menuOpen:', menuOpen, 'viewport:', window.innerWidth, 'x', window.innerHeight);
		if (!menuOpen) {
			showPlaylistPicker = false;
		}
	}

	// debug: log when menu renders
	$effect(() => {
		if (menuOpen) {
			console.log('[AddToMenu] menu is open, should render dropdown');
			// check if dropdown element exists after a tick
			setTimeout(() => {
				const dropdown = document.querySelector('.menu-dropdown');
				const backdrop = document.querySelector('.menu-backdrop');
				console.log('[AddToMenu] dropdown element:', dropdown, 'backdrop:', backdrop);
				if (dropdown) {
					const styles = window.getComputedStyle(dropdown);
					console.log('[AddToMenu] dropdown computed styles:', {
						position: styles.position,
						top: styles.top,
						left: styles.left,
						zIndex: styles.zIndex,
						display: styles.display,
						visibility: styles.visibility,
						opacity: styles.opacity,
						transform: styles.transform,
						width: styles.width,
						height: styles.height
					});
				}
			}, 50);
		}
	});

	async function handleLike(e: Event) {
		e.stopPropagation();
		if (loading || disabled) return;

		loading = true;
		const previousState = liked;
		liked = !liked;

		try {
			const success = liked
				? await likeTrack(trackId)
				: await unlikeTrack(trackId);

			if (!success) {
				liked = previousState;
				toast.error('failed to update like');
			} else {
				onLikeChange?.(liked);
				if (liked) {
					toast.success(`liked ${trackTitle}`);
				} else {
					toast.info(`unliked ${trackTitle}`);
				}
			}
		} catch {
			liked = previousState;
			toast.error('failed to update like');
		} finally {
			loading = false;
			menuOpen = false;
		}
	}

	function handleQueue(e: Event) {
		e.stopPropagation();
		if (onQueue) {
			onQueue();
			menuOpen = false;
		}
	}

	async function handleShare(e: Event) {
		e.stopPropagation();
		if (!shareUrl) return;
		try {
			await navigator.clipboard.writeText(shareUrl);
			toast.success('link copied');
			menuOpen = false;
		} catch {
			toast.error('failed to copy link');
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
				menuOpen = false;
				showPlaylistPicker = false;
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

			// reset and close
			newPlaylistName = '';
			showCreateForm = false;
			showPlaylistPicker = false;
			menuOpen = false;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'failed to create playlist');
		} finally {
			creatingPlaylist = false;
		}
	}
</script>

<div class="add-to-menu">
	<button
		bind:this={triggerRef}
		class="trigger-button"
		class:liked
		class:loading
		class:disabled-state={disabled}
		class:menu-open={menuOpen}
		onclick={toggleMenu}
		title={disabled && disabledReason ? disabledReason : 'add to...'}
		{disabled}
	>
		<svg width="16" height="16" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
		</svg>
	</button>

	{#if menuOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="menu-backdrop" role="presentation" onclick={() => { menuOpen = false; showPlaylistPicker = false; }}></div>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="menu-dropdown" class:open-upward={openUpward} role="menu" tabindex="-1" onclick={(e) => {
			// don't stop propagation for links - let SvelteKit handle navigation
			if (e.target instanceof HTMLAnchorElement || (e.target as HTMLElement).closest('a')) {
				return;
			}
			e.stopPropagation();
		}}>
			{#if !showPlaylistPicker}
				<button class="menu-item" onclick={handleLike} disabled={loading}>
					<svg width="18" height="18" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
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
				{#if onQueue}
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
				{/if}
				{#if shareUrl}
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
				{/if}
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
									<span>loading playlists...</span>
								</div>
							{:else if filteredPlaylists.length === 0}
								<div class="empty-state">
									<span>no playlists yet</span>
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
												<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
	.add-to-menu {
		position: relative;
	}

	.trigger-button {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.2s;
	}

	.trigger-button:hover,
	.trigger-button.menu-open {
		background: var(--bg-tertiary);
		border-color: var(--accent);
		color: var(--accent);
	}

	.trigger-button.liked {
		color: var(--accent);
		border-color: var(--accent);
	}

	.trigger-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.trigger-button.disabled-state {
		opacity: 0.4;
		border-color: var(--text-muted);
		color: var(--text-muted);
	}

	.trigger-button.loading {
		animation: pulse 1s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}

	.trigger-button svg {
		width: 16px;
		height: 16px;
		transition: transform 0.2s;
	}

	.menu-dropdown {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		min-width: 200px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: 8px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
		overflow: hidden;
		z-index: 10;
	}

	.menu-dropdown.open-upward {
		top: auto;
		bottom: calc(100% + 4px);
	}

	.menu-item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: transparent;
		border: none;
		color: var(--text-primary);
		font-size: 0.9rem;
		font-family: inherit;
		cursor: pointer;
		transition: background 0.15s;
		text-align: left;
	}

	.menu-item:hover {
		background: var(--bg-tertiary);
	}

	.menu-item:disabled {
		opacity: 0.5;
	}

	.menu-item .chevron {
		margin-left: auto;
		color: var(--text-muted);
	}

	.playlist-picker {
		display: flex;
		flex-direction: column;
	}

	.back-button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--border-subtle);
		color: var(--text-secondary);
		font-size: 0.85rem;
		font-family: inherit;
		cursor: pointer;
		transition: background 0.15s;
	}

	.back-button:hover {
		background: var(--bg-tertiary);
	}

	.playlist-list {
		max-height: 240px;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--border-default) transparent;
	}

	.playlist-list::-webkit-scrollbar {
		width: 8px;
	}

	.playlist-list::-webkit-scrollbar-track {
		background: transparent;
		border-radius: 4px;
	}

	.playlist-list::-webkit-scrollbar-thumb {
		background: var(--border-default);
		border-radius: 4px;
	}

	.playlist-list::-webkit-scrollbar-thumb:hover {
		background: var(--border-emphasis);
	}

	.playlist-item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 1rem;
		background: transparent;
		border: none;
		color: var(--text-primary);
		font-size: 0.9rem;
		font-family: inherit;
		cursor: pointer;
		transition: background 0.15s;
		text-align: left;
	}

	.playlist-item:hover {
		background: var(--bg-tertiary);
	}

	.playlist-item:disabled {
		opacity: 0.6;
	}

	.playlist-thumb,
	.playlist-thumb-placeholder {
		width: 32px;
		height: 32px;
		border-radius: 4px;
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
		padding: 1.5rem 1rem;
		color: var(--text-tertiary);
		font-size: 0.85rem;
	}

	.create-playlist-btn {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 1rem;
		background: transparent;
		border: none;
		border-top: 1px solid var(--border-subtle);
		color: var(--accent);
		font-size: 0.9rem;
		font-family: inherit;
		cursor: pointer;
		transition: background 0.15s;
		text-align: left;
	}

	.create-playlist-btn:hover {
		background: var(--bg-tertiary);
	}

	.create-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
	}

	.create-form input {
		width: 100%;
		padding: 0.625rem 0.75rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: 6px;
		color: var(--text-primary);
		font-family: inherit;
		font-size: 0.9rem;
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
		padding: 0.625rem 1rem;
		background: var(--accent);
		border: none;
		border-radius: 6px;
		color: white;
		font-family: inherit;
		font-size: 0.9rem;
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
		width: 16px;
		height: 16px;
		border: 2px solid var(--border-default);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.spinner.small {
		width: 14px;
		height: 14px;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* backdrop - hidden on desktop, visible on mobile */
	.menu-backdrop {
		display: none;
	}

	/* mobile: show as top sheet */
	@media (max-width: 768px) {
		.trigger-button {
			width: 28px;
			height: 28px;
		}

		.trigger-button svg {
			width: 14px;
			height: 14px;
		}

		.menu-backdrop {
			display: block;
			position: fixed;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			z-index: 199;
			background: rgba(0, 0, 0, 0.4);
			-webkit-transform: translateZ(0);
			transform: translateZ(0);
		}

		.menu-dropdown,
		.menu-dropdown.open-upward {
			position: fixed;
			top: 0;
			bottom: auto;
			left: 0;
			right: 0;
			width: 100%;
			min-width: 100%;
			max-width: 100vw;
			border-radius: 0 0 16px 16px;
			padding-top: env(safe-area-inset-top, 0);
			z-index: 200;
			-webkit-transform: translateZ(0);
			transform: translateZ(0);
		}

		.menu-item {
			padding: 1rem 1.25rem;
			font-size: 1rem;
		}

		.back-button {
			padding: 1rem 1.25rem;
		}

		.playlist-item {
			padding: 0.875rem 1.25rem;
		}

		.playlist-list {
			max-height: 50vh;
		}
	}
</style>
