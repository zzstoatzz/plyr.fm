<script lang="ts">
	import { onMount } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import { API_URL } from '$lib/config';
	import type { User } from '$lib/types';

	let user: User | null = null;
	let loading = true;
	let saving = false;
	let error = '';
	let success = '';

	// form fields
	let displayName = '';
	let bio = '';
	let avatarUrl = '';

	onMount(async () => {
		try {
			const sessionId = localStorage.getItem('session_id');

			// get current user
			const userResponse = await fetch(`${API_URL}/auth/me`, {
				headers: {
					'Authorization': `Bearer ${sessionId}`
				}
			});

			if (!userResponse.ok) {
				window.location.href = '/login';
				return;
			}

			user = await userResponse.json();

			// get artist profile
			const artistResponse = await fetch(`${API_URL}/artists/me`, {
				headers: {
					'Authorization': `Bearer ${sessionId}`
				}
			});

			if (artistResponse.ok) {
				const artist = await artistResponse.json();
				displayName = artist.display_name;
				bio = artist.bio || '';
				avatarUrl = artist.avatar_url || '';
			} else {
				// no profile yet, redirect to setup
				window.location.href = '/profile/setup';
				return;
			}
		} catch (e) {
			error = `failed to load profile: ${e instanceof Error ? e.message : 'unknown error'}`;
		} finally {
			loading = false;
		}
	});

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();

		saving = true;
		error = '';
		success = '';

		try {
			const sessionId = localStorage.getItem('session_id');
			const response = await fetch(`${API_URL}/artists/me`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${sessionId}`
				},
				body: JSON.stringify({
					display_name: displayName,
					bio: bio || null,
					avatar_url: avatarUrl || null
				})
			});

			if (response.ok) {
				success = 'profile updated successfully!';
			} else {
				const errorData = await response.json();
				error = errorData.detail || 'failed to update profile';
			}
		} catch (e) {
			error = `network error: ${e instanceof Error ? e.message : 'unknown error'}`;
		} finally {
			saving = false;
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
		window.location.href = '/';
	}
</script>

{#if loading}
	<div class="loading">loading...</div>
{:else if user}
	<Header {user} isAuthenticated={!!user} onLogout={logout} />
	<main>
		<div class="profile-header">
			<h2>edit profile</h2>
			<a href="/portal" class="back-link">← back to portal</a>
		</div>

		{#if success}
			<div class="message success">{success}</div>
		{/if}

		{#if error}
			<div class="message error">{error}</div>
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
				<p class="hint">this is shown on all your tracks</p>
			</div>

			<div class="form-group">
				<label for="bio">bio</label>
				<textarea
					id="bio"
					bind:value={bio}
					disabled={saving}
					placeholder="tell us about your music..."
					rows="4"
				></textarea>
			</div>

			<div class="form-group">
				<label for="avatar">avatar url</label>
				<input
					id="avatar"
					type="url"
					bind:value={avatarUrl}
					disabled={saving}
					placeholder="https://example.com/avatar.jpg"
				/>
				{#if avatarUrl}
					<div class="avatar-preview">
						<img src={avatarUrl} alt="avatar preview" />
					</div>
				{/if}
			</div>

			<button type="submit" disabled={saving || !displayName}>
				{saving ? 'saving...' : 'save changes'}
			</button>
		</form>
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
		max-width: 600px;
		margin: 0 auto;
		padding: 0 1rem 2rem;
	}

	.profile-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 2rem;
	}

	.profile-header h2 {
		font-size: 1.5rem;
		margin: 0;
	}

	.back-link {
		color: #aaa;
		text-decoration: none;
		font-size: 0.9rem;
		transition: color 0.2s;
	}

	.back-link:hover {
		color: #fff;
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

	.avatar-preview {
		margin-top: 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.avatar-preview img {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid #333;
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
