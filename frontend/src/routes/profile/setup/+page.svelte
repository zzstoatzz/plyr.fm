<script lang="ts">
	import { onMount } from 'svelte';
	import { API_URL } from '$lib/config';
	import type { User } from '$lib/types';

	let user: User | null = null;
	let loading = true;
	let saving = false;
	let error = '';
	let fetchingAvatar = false;

	// form fields
	let displayName = '';
	let bio = '';
	let avatarUrl = '';

	onMount(async () => {
		// check if session_id is in URL (from OAuth callback)
		const params = new URLSearchParams(window.location.search);
		const sessionId = params.get('session_id');

		if (sessionId) {
			// store session_id in localStorage
			localStorage.setItem('session_id', sessionId);
			// remove from URL
			window.history.replaceState({}, '', '/profile/setup');
		}

		// get session_id from localStorage
		const storedSessionId = localStorage.getItem('session_id');

		if (!storedSessionId) {
			window.location.href = '/login';
			return;
		}

		try {
			// get current user
			const response = await fetch(`${API_URL}/auth/me`, {
				headers: {
					'Authorization': `Bearer ${storedSessionId}`
				}
			});

			if (response.ok) {
				user = await response.json();
				// pre-fill display name with handle
				displayName = user.handle;

				// try to fetch avatar from bluesky
				await fetchAvatar();
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

	async function fetchAvatar() {
		if (!user) return;

		fetchingAvatar = true;
		const sessionId = localStorage.getItem('session_id');

		try {
			// call our backend which will use the Bluesky API
			const response = await fetch(`${API_URL}/artists/${user.did}`, {
				headers: {
					'Authorization': `Bearer ${sessionId}`
				}
			});

			// if artist profile already exists, redirect to portal
			if (response.ok) {
				window.location.href = '/portal';
				return;
			}
		} catch (e) {
			// profile doesn't exist, which is expected
		} finally {
			fetchingAvatar = false;
		}
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!user) return;

		saving = true;
		error = '';

		const sessionId = localStorage.getItem('session_id');

		try {
			const response = await fetch(`${API_URL}/artists/`, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${sessionId}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					display_name: displayName,
					bio: bio || null,
					avatar_url: avatarUrl || null
				})
			});

			if (response.ok) {
				// redirect to portal
				window.location.href = '/portal';
			} else {
				const errorData = await response.json();
				error = errorData.detail || 'failed to create artist profile';
			}
		} catch (e) {
			error = `network error: ${e instanceof Error ? e.message : 'unknown error'}`;
		} finally {
			saving = false;
		}
	}
</script>

{#if loading}
	<div class="loading">loading...</div>
{:else if user}
	<main>
		<div class="setup-container">
			<h1>set up your artist profile</h1>
			<p class="subtitle">
				welcome to relay! please set up your artist profile to start uploading music.
			</p>

			{#if error}
				<div class="error">{error}</div>
			{/if}

			<form on:submit={handleSubmit}>
				<div class="form-group">
					<label for="display-name">artist name *</label>
					<input
						id="display-name"
						type="text"
						bind:value={displayName}
						required
						disabled={saving}
						placeholder="your artist name"
					/>
					<p class="hint">this will be shown on your tracks</p>
				</div>

				<div class="form-group">
					<label for="bio">bio (optional)</label>
					<textarea
						id="bio"
						bind:value={bio}
						disabled={saving}
						placeholder="tell us about your music..."
						rows="4"
					/>
				</div>

				<div class="form-group">
					<label for="avatar">avatar url (optional)</label>
					<input
						id="avatar"
						type="url"
						bind:value={avatarUrl}
						disabled={saving}
						placeholder="https://example.com/avatar.jpg"
					/>
					<p class="hint">
						{#if fetchingAvatar}
							discovering your bluesky avatar...
						{:else}
							we'll try to use your bluesky avatar automatically
						{/if}
					</p>
				</div>

				<button type="submit" disabled={saving || !displayName}>
					{saving ? 'creating profile...' : 'create profile'}
				</button>
			</form>
		</div>
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
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
	}

	.setup-container {
		max-width: 500px;
		width: 100%;
	}

	h1 {
		font-size: 2rem;
		margin-bottom: 0.5rem;
	}

	.subtitle {
		color: #aaa;
		margin-bottom: 2rem;
		line-height: 1.5;
	}

	.error {
		padding: 1rem;
		border-radius: 4px;
		margin-bottom: 1.5rem;
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

	.form-group:last-of-type {
		margin-bottom: 2rem;
	}

	label {
		display: block;
		color: #aaa;
		margin-bottom: 0.5rem;
		font-size: 0.9rem;
		font-weight: 500;
	}

	input[type='text'],
	input[type='url'],
	textarea {
		width: 100%;
		padding: 0.75rem;
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 4px;
		color: white;
		font-size: 1rem;
		font-family: inherit;
		transition: all 0.2s;
	}

	input[type='text']:focus,
	input[type='url']:focus,
	textarea:focus {
		outline: none;
		border-color: #3a7dff;
	}

	input[type='text']:disabled,
	input[type='url']:disabled,
	textarea:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	textarea {
		resize: vertical;
		min-height: 100px;
	}

	.hint {
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
