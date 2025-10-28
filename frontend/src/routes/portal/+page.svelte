<script lang="ts">
	import { onMount } from 'svelte';

	interface User {
		did: string;
		handle: string;
	}

	let user: User | null = null;
	let loading = true;

	// form state
	let uploading = false;
	let uploadError = '';
	let uploadSuccess = '';

	// form fields
	let title = '';
	let artist = '';
	let album = '';
	let file: File | null = null;

	onMount(async () => {
		try {
			const response = await fetch('http://localhost:8000/auth/me', {
				credentials: 'include'
			});
			if (response.ok) {
				user = await response.json();
			} else {
				// not authenticated, redirect to login
				window.location.href = '/login';
			}
		} catch (e) {
			window.location.href = '/login';
		} finally {
			loading = false;
		}
	});

	async function handleUpload(e: Event) {
		e.preventDefault();
		if (!file) return;

		uploading = true;
		uploadError = '';
		uploadSuccess = '';

		const formData = new FormData();
		formData.append('file', file);
		formData.append('title', title);
		formData.append('artist', artist);
		if (album) formData.append('album', album);

		try {
			const response = await fetch('http://localhost:8000/tracks/', {
				method: 'POST',
				body: formData,
				credentials: 'include'
			});

			if (response.ok) {
				uploadSuccess = 'track uploaded successfully!';
				// reset form
				title = '';
				artist = '';
				album = '';
				file = null;
				// @ts-ignore
				document.getElementById('file-input').value = '';
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

	function handleFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			file = target.files[0];
		}
	}
</script>

{#if loading}
	<div class="loading">loading...</div>
{:else if user}
	<main>
		<header>
			<div class="header-content">
				<div>
					<h1>artist portal</h1>
					<p class="user-info">logged in as @{user.handle}</p>
				</div>
				<a href="/" class="back-link">← back to tracks</a>
			</div>
		</header>

		<section class="upload-section">
			<h2>upload track</h2>

			{#if uploadSuccess}
				<div class="message success">{uploadSuccess}</div>
			{/if}

			{#if uploadError}
				<div class="message error">{uploadError}</div>
			{/if}

			<form on:submit={handleUpload}>
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
					<label for="artist">artist name</label>
					<input
						id="artist"
						type="text"
						bind:value={artist}
						required
						disabled={uploading}
						placeholder="artist name"
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
						on:change={handleFileChange}
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
	</main>
{/if}

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		background: #0a0a0a;
		color: #fff;
	}

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
		padding: 2rem 1rem;
	}

	header {
		margin-bottom: 3rem;
	}

	.header-content {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
	}

	h1 {
		font-size: 2.5rem;
		margin: 0 0 0.5rem;
	}

	.user-info {
		color: #888;
		margin: 0;
	}

	.back-link {
		color: #3a7dff;
		text-decoration: none;
		font-size: 0.9rem;
		padding: 0.5rem 1rem;
		border: 1px solid #3a7dff;
		border-radius: 4px;
		transition: all 0.2s;
	}

	.back-link:hover {
		background: #3a7dff;
		color: white;
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
</style>
