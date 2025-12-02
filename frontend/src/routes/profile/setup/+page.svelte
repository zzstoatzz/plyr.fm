
<script lang="ts">
	import { APP_NAME } from '$lib/branding';
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { API_URL } from '$lib/config';
	import { auth } from '$lib/auth.svelte';

	let loading = true;
	let saving = false;
	let error = '';
	let fetchingAvatar = false;

	// form fields
	let displayName = '';
	let bio = '';
	let avatarUrl = '';

	onMount(async () => {
		// check if exchange_token is in URL (from OAuth callback)
		const params = new URLSearchParams(window.location.search);
		const exchangeToken = params.get('exchange_token');

		if (exchangeToken) {
			// exchange token for session_id (cookie is set automatically by backend)
			try {
				const exchangeResponse = await fetch(`${API_URL}/auth/exchange`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({ exchange_token: exchangeToken })
				});

				if (exchangeResponse.ok) {
					await auth.initialize();
				}
			} catch (_e) {
				console.error('failed to exchange token:', _e);
			}

			// remove exchange_token from URL
			replaceState('/profile/setup', {});
		}

		if (!auth.isAuthenticated) {
			window.location.href = '/login';
			return;
		}

		try {
			// pre-fill display name with handle
			displayName = auth.user?.handle || "";

			// try to fetch avatar from bluesky
			await fetchAvatar();
		} catch {
			auth.clearSession();
			window.location.href = '/login';
		} finally {
			loading = false;
		}
	});

	async function fetchAvatar() {
		if (!auth.user) return;

		fetchingAvatar = true;

		try {
			// call our backend which will use the Bluesky API
			const response = await fetch(`${API_URL}/artists/${auth.user.did}`, {
				credentials: 'include'
			});

			// if artist profile already exists, redirect to portal
			if (response.ok) {
				window.location.href = '/portal';
				return;
			}
		} catch {
			// profile doesn't exist, which is expected
		} finally {
			fetchingAvatar = false;
		}
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!auth.user) return;

		saving = true;
		error = '';

		try {
			const response = await fetch(`${API_URL}/artists/`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				credentials: 'include',
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
{:else if auth.user}
	<main>
		<div class="setup-container">
			<h1>set up your artist profile</h1>
			<p class="subtitle">
			welcome to {APP_NAME}! please set up your artist profile to start uploading audio.
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
					></textarea>
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
		color: var(--text-tertiary);
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
		color: var(--text-secondary);
		margin-bottom: 2rem;
		line-height: 1.5;
	}

	.error {
		padding: 1rem;
		border-radius: 4px;
		margin-bottom: 1.5rem;
		background: color-mix(in srgb, var(--error) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--error) 30%, transparent);
		color: var(--error);
	}

	form {
		background: var(--bg-tertiary);
		padding: 2rem;
		border-radius: 8px;
		border: 1px solid var(--border-subtle);
	}

	.form-group {
		margin-bottom: 1.5rem;
	}

	.form-group:last-of-type {
		margin-bottom: 2rem;
	}

	label {
		display: block;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
		font-size: 0.9rem;
		font-weight: 500;
	}

	input[type='text'],
	input[type='url'],
	textarea {
		width: 100%;
		padding: 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-primary);
		font-size: 1rem;
		font-family: inherit;
		transition: all 0.2s;
	}

	input[type='text']:focus,
	input[type='url']:focus,
	textarea:focus {
		outline: none;
		border-color: var(--accent);
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
		color: var(--text-muted);
	}

	button {
		width: 100%;
		padding: 0.75rem;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: 4px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	button:hover:not(:disabled) {
		background: var(--accent-hover);
		transform: translateY(-1px);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent);
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
