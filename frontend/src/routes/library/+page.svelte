<script lang="ts">
	import { onMount } from 'svelte';
	import { replaceState, invalidateAll, goto } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';
	import { auth } from '$lib/auth.svelte';
	import { preferences } from '$lib/preferences.svelte';
	import { API_URL } from '$lib/config';
	import type { PageData } from './$types';
	import type { Playlist } from '$lib/types';
	import { toast } from '$lib/toast.svelte';

	let { data }: { data: PageData } = $props();
	let playlists = $state<Playlist[]>(data.playlists);
	let showCreateModal = $state(false);
	let newPlaylistName = $state('');
	let creating = $state(false);
	let error = $state('');

	onMount(async () => {
		// check if exchange_token is in URL (from OAuth callback)
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
					await auth.refresh();
					await preferences.fetch();
				}
			} catch (_e) {
				console.error('failed to exchange token:', _e);
			}

			replaceState('/library', {});
		}
	});

	async function handleLogout() {
		await auth.logout();
		window.location.href = '/';
	}

	async function createPlaylist() {
		if (!newPlaylistName.trim()) {
			error = 'please enter a name';
			return;
		}

		creating = true;
		error = '';

		try {
			const response = await fetch(`${API_URL}/lists/playlists`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newPlaylistName.trim() })
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.detail || 'failed to create playlist');
			}

			const playlist = await response.json();
			playlists = [playlist, ...playlists];
			showCreateModal = false;
			newPlaylistName = '';

			toast.success(`created "${playlist.name}"`);

			// navigate to new playlist
			goto(`/playlist/${playlist.id}`);
		} catch (e) {
			error = e instanceof Error ? e.message : 'failed to create playlist';
			toast.error(error);
		} finally {
			creating = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			showCreateModal = false;
			newPlaylistName = '';
			error = '';
		} else if (event.key === 'Enter' && showCreateModal) {
			createPlaylist();
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

<svelte:head>
	<title>library • plyr</title>
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

<div class="page">
	<div class="page-header">
		<h1>library</h1>
		<p>your collections on plyr.fm</p>
	</div>

	<section class="collections">
		<a href="/liked" class="collection-card">
			<div class="collection-icon liked">
				<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
					<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
				</svg>
			</div>
			<div class="collection-info">
				<h3>liked tracks</h3>
				<p>{data.likedCount} {data.likedCount === 1 ? 'track' : 'tracks'}</p>
			</div>
			<div class="collection-arrow">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="9 18 15 12 9 6"></polyline>
				</svg>
			</div>
		</a>
	</section>

	<section class="playlists-section">
		<div class="section-header">
			<h2>playlists</h2>
			<button class="create-btn" onclick={() => showCreateModal = true}>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<line x1="12" y1="5" x2="12" y2="19"></line>
					<line x1="5" y1="12" x2="19" y2="12"></line>
				</svg>
				new playlist
			</button>
		</div>

		{#if playlists.length === 0}
			<div class="empty-state">
				<div class="empty-icon">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
						<line x1="8" y1="6" x2="21" y2="6"></line>
						<line x1="8" y1="12" x2="21" y2="12"></line>
						<line x1="8" y1="18" x2="21" y2="18"></line>
						<line x1="3" y1="6" x2="3.01" y2="6"></line>
						<line x1="3" y1="12" x2="3.01" y2="12"></line>
						<line x1="3" y1="18" x2="3.01" y2="18"></line>
					</svg>
				</div>
				<p>no playlists yet</p>
				<span>create your first playlist to organize your favorite tracks</span>
			</div>
		{:else}
			<div class="playlists-list">
				{#each playlists as playlist}
					<a href="/playlist/{playlist.id}" class="collection-card">
						{#if playlist.image_url}
							<img src={playlist.image_url} alt="" class="playlist-artwork" />
						{:else}
							<div class="collection-icon playlist">
								<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<line x1="8" y1="6" x2="21" y2="6"></line>
									<line x1="8" y1="12" x2="21" y2="12"></line>
									<line x1="8" y1="18" x2="21" y2="18"></line>
									<line x1="3" y1="6" x2="3.01" y2="6"></line>
									<line x1="3" y1="12" x2="3.01" y2="12"></line>
									<line x1="3" y1="18" x2="3.01" y2="18"></line>
								</svg>
							</div>
						{/if}
						<div class="collection-info">
							<h3>{playlist.name}</h3>
							<p>{playlist.track_count} {playlist.track_count === 1 ? 'track' : 'tracks'}</p>
						</div>
						<div class="collection-arrow">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<polyline points="9 18 15 12 9 6"></polyline>
							</svg>
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</section>
</div>

{#if showCreateModal}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="modal-overlay" role="presentation" onclick={() => { showCreateModal = false; newPlaylistName = ''; error = ''; }}>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="modal" role="dialog" aria-modal="true" aria-labelledby="create-playlist-title" tabindex="-1" onclick={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<h3 id="create-playlist-title">create playlist</h3>
				<button class="close-btn" aria-label="close" onclick={() => { showCreateModal = false; newPlaylistName = ''; error = ''; }}>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</button>
			</div>
			<div class="modal-body">
				<label for="playlist-name">name</label>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					id="playlist-name"
					type="text"
					bind:value={newPlaylistName}
					placeholder="my playlist"
					disabled={creating}
					autofocus
				/>
				{#if error}
					<p class="error">{error}</p>
				{/if}
			</div>
			<div class="modal-footer">
				<button class="cancel-btn" onclick={() => { showCreateModal = false; newPlaylistName = ''; error = ''; }} disabled={creating}>
					cancel
				</button>
				<button class="confirm-btn" onclick={createPlaylist} disabled={creating || !newPlaylistName.trim()}>
					{creating ? 'creating...' : 'create'}
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
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--border-default);
	}

	.page-header h1 {
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 0.25rem 0;
	}

	.page-header p {
		font-size: var(--text-base);
		color: var(--text-tertiary);
		margin: 0;
	}

	.collections {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.collection-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.25rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		text-decoration: none;
		color: inherit;
		transition: all 0.15s;
	}

	.collection-card:hover {
		border-color: var(--accent);
		background: var(--bg-hover);
	}

	.collection-card:active {
		transform: scale(0.99);
	}

	.collection-icon {
		width: 48px;
		height: 48px;
		border-radius: var(--radius-md);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.collection-icon.liked {
		background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05));
		color: #ef4444;
	}

	.collection-icon.playlist {
		background: linear-gradient(135deg, rgba(var(--accent-rgb, 139, 92, 246), 0.15), rgba(var(--accent-rgb, 139, 92, 246), 0.05));
		color: var(--accent);
	}

	.playlist-artwork {
		width: 48px;
		height: 48px;
		border-radius: var(--radius-md);
		object-fit: cover;
		flex-shrink: 0;
	}

	.collection-info {
		flex: 1;
		min-width: 0;
	}

	.collection-info h3 {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--text-primary);
		margin: 0 0 0.15rem 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.collection-info p {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		margin: 0;
	}

	.collection-arrow {
		color: var(--text-muted);
		flex-shrink: 0;
		transition: transform 0.15s;
	}

	.collection-card:hover .collection-arrow {
		transform: translateX(3px);
		color: var(--accent);
	}

	/* playlists section */
	.playlists-section {
		margin-top: 2rem;
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.section-header h2 {
		font-size: var(--text-xl);
		font-weight: 600;
		color: var(--text-primary);
		margin: 0;
	}

	.create-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-family: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.create-btn:hover {
		opacity: 0.9;
		transform: translateY(-1px);
	}

	.create-btn:active {
		transform: translateY(0);
	}

	.playlists-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 3rem 2rem;
		background: var(--bg-secondary);
		border: 1px dashed var(--border-default);
		border-radius: var(--radius-lg);
		text-align: center;
	}

	.empty-icon {
		width: 64px;
		height: 64px;
		border-radius: var(--radius-xl);
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-tertiary);
		color: var(--text-muted);
		margin-bottom: 1rem;
	}

	.empty-state p {
		font-size: var(--text-lg);
		font-weight: 500;
		color: var(--text-secondary);
		margin: 0 0 0.25rem 0;
	}

	.empty-state span {
		font-size: var(--text-sm);
		color: var(--text-muted);
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
		border-radius: var(--radius-xl);
		width: 100%;
		max-width: 400px;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border-default);
	}

	.modal-header h3 {
		font-size: var(--text-xl);
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
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s;
	}

	.close-btn:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.modal-body {
		padding: 1.5rem;
	}

	.modal-body label {
		display: block;
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
	}

	.modal-body input {
		width: 100%;
		padding: 0.75rem 1rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		font-family: inherit;
		font-size: var(--text-lg);
		color: var(--text-primary);
		transition: border-color 0.15s;
	}

	.modal-body input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.modal-body input::placeholder {
		color: var(--text-muted);
	}

	.modal-body .error {
		margin: 0.5rem 0 0 0;
		font-size: var(--text-sm);
		color: #ef4444;
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
		border-radius: var(--radius-md);
		font-family: inherit;
		font-size: var(--text-base);
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

	.confirm-btn:hover:not(:disabled) {
		opacity: 0.9;
	}

	.confirm-btn:disabled,
	.cancel-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (max-width: 768px) {
		.page {
			padding: 0 0.75rem calc(var(--player-height, 0px) + 1.25rem + env(safe-area-inset-bottom, 0px));
		}

		.page-header {
			margin-bottom: 1.5rem;
			padding-bottom: 1rem;
		}

		.page-header h1 {
			font-size: var(--text-3xl);
		}

		.collection-card {
			padding: 0.875rem 1rem;
		}

		.collection-icon {
			width: 44px;
			height: 44px;
		}

		.collection-info h3 {
			font-size: var(--text-base);
		}

		.section-header h2 {
			font-size: var(--text-lg);
		}

		.create-btn {
			padding: 0.5rem 0.875rem;
			font-size: var(--text-sm);
		}

		.empty-state {
			padding: 2rem 1.5rem;
		}

		.empty-icon {
			width: 56px;
			height: 56px;
		}
	}
</style>
