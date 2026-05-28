<script lang="ts">
	import { onMount } from 'svelte';
	import { API_URL } from '$lib/config';
	import { toast } from '$lib/toast.svelte';
	import { auth } from '$lib/auth.svelte';

	interface Props {
		atprotofansEligible: boolean;
		checkingAtprotofans: boolean;
	}

	let { atprotofansEligible, checkingAtprotofans }: Props = $props();

	let displayName = $state('');
	let bio = $state('');
	let avatarUrl = $state('');
	// support link mode: 'none' | 'atprotofans' | 'custom'
	let supportLinkMode = $state<'none' | 'atprotofans' | 'custom'>('none');
	let customSupportUrl = $state('');
	let savingProfile = $state(false);

	async function loadArtistProfile() {
		try {
			const [artistRes, prefsRes] = await Promise.all([
				fetch(`${API_URL}/artists/me`, { credentials: 'include' }),
				fetch(`${API_URL}/preferences/`, { credentials: 'include' })
			]);

			if (artistRes.ok) {
				const artist = await artistRes.json();
				displayName = artist.display_name;
				bio = artist.bio || '';
				avatarUrl = artist.avatar_url || '';
			}

			if (prefsRes.ok) {
				const prefs = await prefsRes.json();
				// parse support_url into mode + custom URL
				const url = prefs.support_url || '';
				if (!url) {
					supportLinkMode = 'none';
					customSupportUrl = '';
				} else if (url === 'atprotofans') {
					supportLinkMode = 'atprotofans';
					customSupportUrl = '';
				} else {
					supportLinkMode = 'custom';
					customSupportUrl = url;
				}
			}
		} catch (_e) {
			console.error('failed to load artist profile:', _e);
		}
	}

	async function saveProfile(e: SubmitEvent) {
		e.preventDefault();
		savingProfile = true;

		try {
			// compute support_url value based on mode
			let supportUrlValue = '';
			if (supportLinkMode === 'atprotofans') {
				supportUrlValue = 'atprotofans';
			} else if (supportLinkMode === 'custom') {
				const trimmed = customSupportUrl.trim();
				if (trimmed && !trimmed.startsWith('https://')) {
					toast.error('custom support link must start with https://');
					savingProfile = false;
					return;
				}
				supportUrlValue = trimmed;
			}

			// save artist profile and support URL in parallel
			const [artistRes, prefsRes] = await Promise.all([
				fetch(`${API_URL}/artists/me`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({
						display_name: displayName,
						bio: bio || null,
						avatar_url: avatarUrl || null
					})
				}),
				fetch(`${API_URL}/preferences/`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({ support_url: supportUrlValue })
				})
			]);

			if (artistRes.ok && prefsRes.ok) {
				toast.success('profile updated');
			} else if (!artistRes.ok) {
				const errorData = await artistRes.json();
				toast.error(errorData.detail || 'failed to update profile');
			} else {
				toast.error('failed to update support link');
			}
		} catch (e) {
			toast.error(`network error: ${e instanceof Error ? e.message : 'unknown error'}`);
		} finally {
			savingProfile = false;
		}
	}

	onMount(loadArtistProfile);
</script>

<section class="profile-section">
	<div class="section-header">
		<h2>profile</h2>
		{#if auth.user}
			<a href="/u/{auth.user.handle}" class="view-profile-link">view public profile</a>
		{/if}
	</div>

	<form onsubmit={saveProfile}>
		<div class="form-group">
			<label for="display-name">artist name *</label>
			<input
				id="display-name"
				type="text"
				bind:value={displayName}
				required
				disabled={savingProfile}
				placeholder="your artist name"
			/>
			<p class="hint">this is shown on all your tracks</p>
		</div>

		<div class="form-group">
			<label for="bio">bio (optional)</label>
			<textarea
				id="bio"
				bind:value={bio}
				disabled={savingProfile}
				placeholder="tell us about your music..."
				rows="4"
				maxlength="2560"
			></textarea>
			{#if bio.length > 0}
				<div class="char-count">{bio.length} / 2560</div>
			{/if}
		</div>

		<div class="form-group">
			<label for="avatar">avatar url (optional)</label>
			<input
				id="avatar"
				type="url"
				bind:value={avatarUrl}
				disabled={savingProfile}
				placeholder="https://example.com/avatar.jpg"
			/>
			{#if avatarUrl}
				<div class="avatar-preview">
					<img src={avatarUrl} alt="avatar preview" />
				</div>
			{/if}
		</div>

		<div class="form-group support-link-group" role="group" aria-labelledby="support-link-label">
			<span id="support-link-label" class="form-label">support link (optional)</span>
			<div class="support-options">
				<label class="support-option">
					<input
						type="radio"
						name="support-mode"
						value="none"
						bind:group={supportLinkMode}
						disabled={savingProfile}
					/>
					<span>none</span>
				</label>
				<label class="support-option" class:disabled={!atprotofansEligible && supportLinkMode !== 'atprotofans'}>
					<input
						type="radio"
						name="support-mode"
						value="atprotofans"
						bind:group={supportLinkMode}
						disabled={savingProfile || (!atprotofansEligible && supportLinkMode !== 'atprotofans')}
					/>
					<span>atprotofans</span>
					{#if checkingAtprotofans}
						<span class="support-status">checking...</span>
					{:else if !atprotofansEligible}
						<a href="https://atprotofans.com" target="_blank" rel="noopener" class="support-setup-link">set up</a>
					{:else}
						<a href="https://atprotofans.com/u/{auth.user?.did}" target="_blank" rel="noopener" class="support-status-link">profile ready</a>
					{/if}
				</label>
				<label class="support-option">
					<input
						type="radio"
						name="support-mode"
						value="custom"
						bind:group={supportLinkMode}
						disabled={savingProfile}
					/>
					<span>custom link</span>
				</label>
			</div>
			{#if supportLinkMode === 'custom'}
				<input
					id="custom-support-url"
					type="url"
					bind:value={customSupportUrl}
					disabled={savingProfile}
					placeholder="https://ko-fi.com/yourname"
					class="custom-support-input"
				/>
			{/if}
			<p class="hint">
				{#if supportLinkMode === 'atprotofans'}
					uses <a href="https://atprotofans.com" target="_blank" rel="noopener">atprotofans</a> for ATProto-native support
				{:else if supportLinkMode === 'custom'}
					link to Ko-fi, Patreon, or similar - shown on your profile
				{:else}
					no support link will be shown on your profile
				{/if}
			</p>
		</div>

		<button type="submit" disabled={savingProfile || !displayName}>
			{savingProfile ? 'saving...' : 'save profile'}
		</button>
	</form>
</section>

<style>
	/* shared page-level primitives — duplicated here because Svelte scoped CSS
	   does not cross the component boundary; the parent keeps its own copies for
	   the remaining sections. */
	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.section-header h2 {
		margin-bottom: 0;
	}

	form {
		background: var(--bg-tertiary);
		padding: 1.25rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-subtle);
	}

	.form-group {
		margin-bottom: 1rem;
	}

	.form-group:last-of-type {
		margin-bottom: 1.25rem;
	}

	label {
		display: block;
		color: var(--text-secondary);
		margin-bottom: 0.4rem;
		font-size: var(--text-sm);
	}

	input[type='text'],
	input[type='url'],
	textarea {
		width: 100%;
		padding: 0.6rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: var(--text-base);
		font-family: inherit;
		transition: all 0.15s;
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
		min-height: 80px;
	}

	.hint {
		margin-top: 0.35rem;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.char-count {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		text-align: right;
	}

	.hint a {
		color: var(--accent);
		text-decoration: none;
	}

	.hint a:hover {
		text-decoration: underline;
	}

	/* profile section */
	.profile-section {
		margin-bottom: 2rem;
	}

	.profile-section h2 {
		font-size: var(--text-page-heading);
		margin-bottom: 1rem;
	}

	.view-profile-link {
		color: var(--text-secondary);
		text-decoration: none;
		font-size: var(--text-sm);
		padding: 0.35rem 0.6rem;
		background: var(--bg-tertiary);
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-default);
		transition: all 0.15s;
		white-space: nowrap;
	}

	.view-profile-link:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--bg-hover);
	}

	/* support link options */
	.support-link-group .form-label {
		display: block;
		color: var(--text-secondary);
		margin-bottom: 0.6rem;
		font-size: var(--text-sm);
	}

	.support-options {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.support-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		cursor: pointer;
		transition: all 0.15s;
		margin-bottom: 0;
	}

	.support-option:hover {
		border-color: var(--border-emphasis);
	}

	.support-option:has(input:checked) {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 8%, var(--bg-primary));
	}

	.support-option input[type='radio'] {
		width: 16px;
		height: 16px;
		accent-color: var(--accent);
		margin: 0;
	}

	.support-option span {
		font-size: var(--text-base);
		color: var(--text-primary);
	}

	.support-status {
		margin-left: auto;
		font-size: var(--text-xs);
		color: var(--text-tertiary);
	}

	.support-setup-link,
	.support-status-link {
		margin-left: auto;
		font-size: var(--text-xs);
		text-decoration: none;
	}

	.support-setup-link {
		color: var(--accent);
	}

	.support-status-link {
		color: var(--success, #22c55e);
	}

	.support-setup-link:hover,
	.support-status-link:hover {
		text-decoration: underline;
	}

	.support-option.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.support-option.disabled input {
		cursor: not-allowed;
	}

	.custom-support-input {
		width: 100%;
		padding: 0.6rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: var(--text-base);
		font-family: inherit;
		transition: all 0.15s;
		margin-bottom: 0.5rem;
	}

	.custom-support-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.custom-support-input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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
		border-radius: var(--radius-full);
		object-fit: cover;
		border: 2px solid var(--border-default);
	}

	/* form submit buttons only */
	form button[type="submit"] {
		width: 100%;
		padding: 0.75rem;
		background: var(--accent);
		color: var(--text-primary);
		border: none;
		border-radius: var(--radius-sm);
		font-size: var(--text-lg);
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
	}

	form button[type="submit"]:hover:not(:disabled) {
		background: var(--accent-hover);
		transform: translateY(-1px);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	form button[type="submit"]:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	form button[type="submit"]:active:not(:disabled) {
		transform: translateY(0);
	}

	/* mobile responsive */
	@media (max-width: 600px) {
		.profile-section h2 {
			font-size: var(--text-xl);
		}

		.section-header {
			margin-bottom: 0.75rem;
		}

		.view-profile-link {
			font-size: var(--text-xs);
			padding: 0.3rem 0.5rem;
		}

		form {
			padding: 1rem;
		}

		.form-group {
			margin-bottom: 0.85rem;
		}

		label {
			font-size: var(--text-sm);
			margin-bottom: 0.3rem;
		}

		input[type='text'],
		input[type='url'],
		textarea {
			padding: 0.5rem 0.6rem;
			font-size: var(--text-base);
		}

		textarea {
			min-height: 70px;
		}

		.hint {
			font-size: var(--text-xs);
		}

		.avatar-preview img {
			width: 48px;
			height: 48px;
		}

		form button[type="submit"] {
			padding: 0.6rem;
			font-size: var(--text-base);
		}
	}
</style>
