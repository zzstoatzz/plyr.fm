<script lang="ts">
	import { onMount } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import type { User, Track} from '$lib/types';
	import { API_URL } from '$lib/config';

	let user: User | null = null;
	let loading = true;
	let tracks: Track[] = [];
	let loadingTracks = false;

	// form state
	let uploading = false;
	let uploadError = '';
	let uploadSuccess = '';

	// form fields
	let title = '';
	let album = '';
	let file: File | null = null;

	// editing state
	let editingTrackId: number | null = null;
	let editTitle = '';
	let editAlbum = '';

	onMount(async () => {
		// check if session_id is in URL (from OAuth callback)
		const params = new URLSearchParams(window.location.search);
		const sessionId = params.get('session_id');

		if (sessionId) {
			// store session_id in localStorage
			localStorage.setItem('session_id', sessionId);
			// remove from URL
			window.history.replaceState({}, '', '/portal');
		}

		// get session_id from localStorage
		const storedSessionId = localStorage.getItem('session_id');

		if (!storedSessionId) {
			window.location.href = '/login';
			return;
		}

		try {
			const response = await fetch(`${API_URL}/auth/me`, {
				headers: {
					'Authorization': `Bearer ${storedSessionId}`
				}
			});
			if (response.ok) {
				user = await response.json();
				await loadMyTracks();
			} else {
				// session invalid, clear and redirect
				localStorage.removeItem('session_id');
				window.location.href = '/login';
			}
		} catch (e) {
			localStorage.removeItem('session_id');
			window.location.href = '/login';
		} finally {
			loading = false;
		}
	});

	async function loadMyTracks() {
		loadingTracks = true;
		const sessionId = localStorage.getItem('session_id');
		try {
			const response = await fetch(`${API_URL}/tracks/me`, {
				headers: {
					'Authorization': `Bearer ${sessionId}`
				}
			});
			if (response.ok) {
				const data = await response.json();
				tracks = data.tracks;
			}
		} catch (e) {
			console.error('failed to load tracks:', e);
		} finally {
			loadingTracks = false;
		}
	}

	async function handleUpload(e: SubmitEvent) {
		e.preventDefault();
		if (!file) return;

		uploading = true;
		uploadError = '';
		uploadSuccess = '';

		const sessionId = localStorage.getItem('session_id');
		const formData = new FormData();
		formData.append('file', file);
		formData.append('title', title);
		if (album) formData.append('album', album);

		try {
			const response = await fetch(`${API_URL}/tracks/`, {
				method: 'POST',
				body: formData,
				headers: {
					'Authorization': `Bearer ${sessionId}`
				}
			});

			if (response.ok) {
				uploadSuccess = 'track uploaded successfully!';
				// reset form
				title = '';
				album = '';
				file = null;
				// @ts-ignore
				document.getElementById('file-input').value = '';
				// reload tracks
				await loadMyTracks();
			} else {
				const error = await response.json();
				uploadError = error.detail || `upload failed (${response.status} ${response.statusText})`;
			}
		} catch (e) {
			uploadError = `network error: ${e instanceof Error ? e.message : 'unknown error'}`;
		} finally {
			uploading = false;
		}
	}

	async function deleteTrack(trackId: number, trackTitle: string) {
		if (!confirm(`delete "${trackTitle}"?`)) return;

		const sessionId = localStorage.getItem('session_id');
		try {
			const response = await fetch(`${API_URL}/tracks/${trackId}`, {
				method: 'DELETE',
				headers: {
					'Authorization': `Bearer ${sessionId}`
				}
			});

			if (response.ok) {
				await loadMyTracks();
			} else {
				const error = await response.json();
				alert(error.detail || 'failed to delete track');
			}
		} catch (e) {
			alert(`network error: ${e instanceof Error ? e.message : 'unknown error'}`);
		}
	}

	function startEditTrack(track: typeof tracks[0]) {
		editingTrackId = track.id;
		editTitle = track.title;
		editAlbum = track.album || '';
	}

	function cancelEdit() {
		editingTrackId = null;
		editTitle = '';
		editAlbum = '';
	}

	async function saveTrackEdit(trackId: number) {
		const sessionId = localStorage.getItem('session_id');
		const formData = new FormData();
		formData.append('title', editTitle);
		formData.append('album', editAlbum);

		try {
			const response = await fetch(`${API_URL}/tracks/${trackId}`, {
				method: 'PATCH',
				body: formData,
				headers: {
					'Authorization': `Bearer ${sessionId}`
				}
			});

			if (response.ok) {
				await loadMyTracks();
				cancelEdit();
			} else {
				const error = await response.json();
				alert(error.detail || 'failed to update track');
			}
		} catch (e) {
			alert(`network error: ${e instanceof Error ? e.message : 'unknown error'}`);
		}
	}

	function handleFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			file = target.files[0];
		}
	}

	async function logout() {
		const sessionId = localStorage.getItem('session_id');
		await fetch(`${API_URL}/auth/logout`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${sessionId}`
			}
		});
		localStorage.removeItem('session_id');
		window.location.href = '/';
	}
</script>

{#if loading}
	<div class="loading">loading...</div>
{:else if user}
	<Header {user} onLogout={logout} />
	<main>
		<div class="portal-header">
			<h2>artist portal</h2>
		</div>

		<section class="upload-section">
			<h2>upload track</h2>

			{#if uploadSuccess}
				<div class="message success">{uploadSuccess}</div>
			{/if}

			{#if uploadError}
				<div class="message error">{uploadError}</div>
			{/if}

			<form onsubmit={handleUpload}>
				<div class="form-group">
					<label for="title">track title</label>
					<input
						id="title"
						type="text"
						bind:value={title}
						required
						disabled={uploading}
						placeholder="my awesome song"
					/>
				</div>

				<div class="form-group">
					<label for="album">album (optional)</label>
					<input
						id="album"
						type="text"
						bind:value={album}
						disabled={uploading}
						placeholder="album name"
					/>
				</div>

				<div class="form-group">
					<label for="file-input">audio file</label>
					<input
						id="file-input"
						type="file"
						accept="audio/*"
						onchange={handleFileChange}
						required
						disabled={uploading}
					/>
					{#if file}
						<p class="file-info">{file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)</p>
					{/if}
				</div>

				<button type="submit" disabled={uploading || !file}>
					{uploading ? 'uploading...' : 'upload track'}
				</button>
			</form>
		</section>

		<section class="tracks-section">
			<h2>your tracks</h2>

			{#if loadingTracks}
				<p class="empty">loading tracks...</p>
			{:else if tracks.length === 0}
				<p class="empty">no tracks uploaded yet</p>
			{:else}
				<div class="tracks-list">
					{#each tracks as track}
						<div class="track-item">
							{#if editingTrackId === track.id}
								<div class="track-info editing">
									<input
										type="text"
										bind:value={editTitle}
										placeholder="track title"
										class="edit-input"
									/>
									<input
										type="text"
										bind:value={editAlbum}
										placeholder="album (optional)"
										class="edit-input"
									/>
								</div>
								<div class="track-actions">
									<button
										class="action-btn save-btn"
										onclick={() => saveTrackEdit(track.id)}
										title="save changes"
									>
										✓
									</button>
									<button
										class="action-btn cancel-btn"
										onclick={cancelEdit}
										title="cancel"
									>
										✕
									</button>
								</div>
							{:else}
								<div class="track-info">
									<div class="track-title">{track.title}</div>
									<div class="track-meta">
										{track.artist}
										{#if track.album}
											<span class="separator">•</span>
											<span class="album">{track.album}</span>
										{/if}
									</div>
									<div class="track-date">
										{new Date(track.created_at).toLocaleDateString()}
									</div>
								</div>
								<div class="track-actions">
									<button
										class="action-btn edit-btn"
										onclick={() => startEditTrack(track)}
										title="edit track"
									>
										✎
									</button>
									<button
										class="action-btn delete-btn"
										onclick={() => deleteTrack(track.id, track.title)}
										title="delete track"
									>
										×
									</button>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>
	</main>
{/if}

<style>
	.loading {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		color: #888;
	}

	main {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 1rem 2rem;
	}

	.portal-header {
		margin-bottom: 2rem;
	}

	.portal-header h2 {
		font-size: 1.5rem;
		margin: 0;
	}


	.upload-section h2 {
		font-size: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.message {
		padding: 1rem;
		border-radius: 4px;
		margin-bottom: 1.5rem;
	}

	.message.success {
		background: rgba(46, 160, 67, 0.1);
		border: 1px solid rgba(46, 160, 67, 0.3);
		color: #5ce87b;
	}

	.message.error {
		background: rgba(233, 69, 96, 0.1);
		border: 1px solid rgba(233, 69, 96, 0.3);
		color: #ff6b6b;
	}

	form {
		background: #1a1a1a;
		padding: 2rem;
		border-radius: 8px;
		border: 1px solid #2a2a2a;
	}

	.form-group {
		margin-bottom: 1.5rem;
	}

	label {
		display: block;
		color: #aaa;
		margin-bottom: 0.5rem;
		font-size: 0.9rem;
	}

	input[type='text'] {
		width: 100%;
		padding: 0.75rem;
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 4px;
		color: white;
		font-size: 1rem;
		transition: all 0.2s;
	}

	input[type='text']:focus {
		outline: none;
		border-color: #3a7dff;
	}

	input[type='text']:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	input[type='file'] {
		width: 100%;
		padding: 0.75rem;
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 4px;
		color: white;
		font-size: 0.9rem;
		cursor: pointer;
	}

	input[type='file']:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.file-info {
		margin-top: 0.5rem;
		font-size: 0.85rem;
		color: #666;
	}

	button {
		width: 100%;
		padding: 0.75rem;
		background: #3a7dff;
		color: white;
		border: none;
		border-radius: 4px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	button:hover:not(:disabled) {
		background: #2868e6;
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(58, 125, 255, 0.3);
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	button:active:not(:disabled) {
		transform: translateY(0);
	}

	.tracks-section {
		margin-top: 3rem;
	}

	.tracks-section h2 {
		font-size: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.empty {
		color: #666;
		padding: 2rem;
		text-align: center;
		background: #1a1a1a;
		border-radius: 8px;
		border: 1px solid #2a2a2a;
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
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 6px;
		padding: 1rem;
		transition: all 0.2s;
	}

	.track-item:hover {
		background: #222;
		border-color: #333;
	}

	.track-info {
		flex: 1;
		min-width: 0;
	}

	.track-title {
		font-weight: 600;
		font-size: 1rem;
		margin-bottom: 0.25rem;
		color: #fff;
	}

	.track-meta {
		font-size: 0.9rem;
		color: #aaa;
		margin-bottom: 0.25rem;
	}

	.separator {
		margin: 0 0.5rem;
		color: #666;
	}

	.album {
		color: #888;
	}

	.track-date {
		font-size: 0.85rem;
		color: #666;
	}

	.track-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
		margin-left: 1rem;
		padding-top: 0.25rem;
	}

	.action-btn {
		width: 36px;
		height: 36px;
		padding: 0;
		background: transparent;
		border: 1px solid #444;
		border-radius: 4px;
		color: #888;
		font-size: 1.2rem;
		line-height: 1;
		cursor: pointer;
		transition: all 0.2s;
	}

	.edit-btn:hover {
		background: rgba(106, 159, 255, 0.1);
		border-color: rgba(106, 159, 255, 0.5);
		color: #6a9fff;
		transform: none;
		box-shadow: none;
	}

	.delete-btn {
		font-size: 1.5rem;
	}

	.delete-btn:hover {
		background: rgba(233, 69, 96, 0.1);
		border-color: rgba(233, 69, 96, 0.5);
		color: #ff6b6b;
		transform: none;
		box-shadow: none;
	}

	.save-btn:hover {
		background: rgba(46, 160, 67, 0.1);
		border-color: rgba(46, 160, 67, 0.5);
		color: #5ce87b;
		transform: none;
		box-shadow: none;
	}

	.cancel-btn:hover {
		background: rgba(136, 136, 136, 0.1);
		border-color: rgba(136, 136, 136, 0.5);
		color: #aaa;
		transform: none;
		box-shadow: none;
	}

	.track-info.editing {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
	}

	.edit-input {
		width: 100%;
		padding: 0.5rem;
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 4px;
		color: white;
		font-size: 0.9rem;
	}

	.edit-input:focus {
		outline: none;
		border-color: #6a9fff;
	}
</style>
