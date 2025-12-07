<script lang="ts">
	import { onMount } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import type { TokenInfo } from '$lib/types';
	import { API_URL } from '$lib/config';
	import { toast } from '$lib/toast.svelte';
	import { auth } from '$lib/auth.svelte';
	import { preferences, type Theme } from '$lib/preferences.svelte';
	import { queue } from '$lib/queue.svelte';

	let loading = $state(true);

	// derive from preferences store
	let allowComments = $derived(preferences.allowComments);
	let enableTealScrobbling = $derived(preferences.enableTealScrobbling);
	let tealNeedsReauth = $derived(preferences.tealNeedsReauth);
	let showSensitiveArtwork = $derived(preferences.showSensitiveArtwork);
	let currentTheme = $derived(preferences.theme);
	let currentColor = $derived(preferences.accentColor ?? '#6a9fff');
	let autoAdvance = $derived(preferences.autoAdvance);

	// account deletion state
	let showDeleteConfirm = $state(false);
	let deleteConfirmText = $state('');
	let deleteAtprotoRecords = $state(false);
	let deleting = $state(false);

	// developer token state
	let creatingToken = $state(false);
	let developerToken = $state<string | null>(null);
	let tokenExpiresDays = $state(90);
	let tokenName = $state('');
	let tokenCopied = $state(false);
	let existingTokens = $state<TokenInfo[]>([]);
	let loadingTokens = $state(false);
	let revokingToken = $state<string | null>(null);

	const presetColors = [
		{ name: 'blue', value: '#6a9fff' },
		{ name: 'purple', value: '#a78bfa' },
		{ name: 'pink', value: '#f472b6' },
		{ name: 'green', value: '#4ade80' },
		{ name: 'orange', value: '#fb923c' },
		{ name: 'red', value: '#ef4444' }
	];

	const themes: { value: Theme; label: string; icon: string }[] = [
		{ value: 'dark', label: 'dark', icon: 'moon' },
		{ value: 'light', label: 'light', icon: 'sun' },
		{ value: 'system', label: 'auto', icon: 'auto' }
	];

	onMount(async () => {
		// check if exchange_token is in URL (from OAuth callback for dev token)
		const params = new URLSearchParams(window.location.search);
		const exchangeToken = params.get('exchange_token');
		const isDevToken = params.get('dev_token') === 'true';

		if (exchangeToken && isDevToken) {
			try {
				const exchangeResponse = await fetch(`${API_URL}/auth/exchange`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({ exchange_token: exchangeToken })
				});

				if (exchangeResponse.ok) {
					const data = await exchangeResponse.json();
					developerToken = data.session_id;
					toast.success('developer token created - save it now!');
				}
			} catch (_e) {
				console.error('failed to exchange token:', _e);
			}

			// remove exchange_token from URL
			window.history.replaceState({}, '', '/settings');
		}

		// wait for auth to finish loading
		while (auth.loading) {
			await new Promise(resolve => setTimeout(resolve, 50));
		}

		if (!auth.isAuthenticated) {
			window.location.href = '/login';
			return;
		}

		await loadDeveloperTokens();
		loading = false;
	});

	async function loadDeveloperTokens() {
		loadingTokens = true;
		try {
			const response = await fetch(`${API_URL}/auth/developer-tokens`, {
				credentials: 'include'
			});
			if (response.ok) {
				const data = await response.json();
				existingTokens = data.tokens;
			}
		} catch (_e) {
			console.error('failed to load developer tokens:', _e);
		} finally {
			loadingTokens = false;
		}
	}

	// appearance
	function applyColorLocally(color: string) {
		document.documentElement.style.setProperty('--accent', color);
		const r = parseInt(color.slice(1, 3), 16);
		const g = parseInt(color.slice(3, 5), 16);
		const b = parseInt(color.slice(5, 7), 16);
		const hover = `rgb(${Math.min(255, r + 30)}, ${Math.min(255, g + 30)}, ${Math.min(255, b + 30)})`;
		document.documentElement.style.setProperty('--accent-hover', hover);
	}

	async function applyColor(color: string) {
		applyColorLocally(color);
		localStorage.setItem('accentColor', color);
		await preferences.update({ accent_color: color });
	}

	function handleColorInput(event: Event) {
		const input = event.target as HTMLInputElement;
		applyColor(input.value);
	}

	function selectPreset(color: string) {
		applyColor(color);
	}

	function selectTheme(theme: Theme) {
		preferences.setTheme(theme);
	}

	async function handleAutoAdvanceToggle(event: Event) {
		const input = event.target as HTMLInputElement;
		const value = input.checked;
		queue.setAutoAdvance(value);
		localStorage.setItem('autoAdvance', value ? '1' : '0');
		await preferences.update({ auto_advance: value });
	}

	// preferences
	async function saveAllowComments(enabled: boolean) {
		try {
			await preferences.update({ allow_comments: enabled });
			toast.success(enabled ? 'comments enabled on your tracks' : 'comments disabled');
		} catch (_e) {
			console.error('failed to save preference:', _e);
			toast.error('failed to update preference');
		}
	}

	async function saveTealScrobbling(enabled: boolean) {
		try {
			await preferences.update({ enable_teal_scrobbling: enabled });
			await preferences.fetch();
			toast.success(enabled ? 'teal.fm scrobbling enabled' : 'teal.fm scrobbling disabled');
		} catch (_e) {
			console.error('failed to save preference:', _e);
			toast.error('failed to update preference');
		}
	}

	async function saveShowSensitiveArtwork(enabled: boolean) {
		try {
			await preferences.update({ show_sensitive_artwork: enabled });
			toast.success(enabled ? 'sensitive artwork shown' : 'sensitive artwork hidden');
		} catch (_e) {
			console.error('failed to save preference:', _e);
			toast.error('failed to update preference');
		}
	}

	// developer tokens
	async function createDeveloperToken() {
		creatingToken = true;
		developerToken = null;
		tokenCopied = false;

		try {
			const response = await fetch(`${API_URL}/auth/developer-token/start`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					name: tokenName || null,
					expires_in_days: tokenExpiresDays
				})
			});

			if (!response.ok) {
				const error = await response.json();
				toast.error(error.detail || 'failed to start token creation');
				creatingToken = false;
				return;
			}

			const result = await response.json();
			tokenName = '';
			window.location.href = result.auth_url;
		} catch (e) {
			console.error('failed to create token:', e);
			toast.error('failed to create token');
			creatingToken = false;
		}
	}

	async function revokeToken(tokenId: string, name: string | null) {
		if (!confirm(`revoke token "${name || tokenId}"?`)) return;

		revokingToken = tokenId;
		try {
			const response = await fetch(`${API_URL}/auth/developer-tokens/${tokenId}`, {
				method: 'DELETE',
				credentials: 'include'
			});

			if (!response.ok) {
				const error = await response.json();
				toast.error(error.detail || 'failed to revoke token');
				return;
			}

			toast.success('token revoked');
			await loadDeveloperTokens();
		} catch (e) {
			console.error('failed to revoke token:', e);
			toast.error('failed to revoke token');
		} finally {
			revokingToken = null;
		}
	}

	async function copyToken() {
		if (!developerToken) return;
		try {
			await navigator.clipboard.writeText(developerToken);
			tokenCopied = true;
			toast.success('token copied to clipboard');
			setTimeout(() => { tokenCopied = false; }, 2000);
		} catch (e) {
			console.error('failed to copy:', e);
			toast.error('failed to copy token');
		}
	}

	// account deletion
	async function deleteAccount() {
		if (!auth.user || deleteConfirmText !== auth.user.handle) return;

		deleting = true;
		const toastId = toast.info('deleting account...', 0);

		try {
			const response = await fetch(`${API_URL}/account/`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					confirmation: deleteConfirmText,
					delete_atproto_records: deleteAtprotoRecords
				})
			});

			if (!response.ok) {
				const error = await response.json();
				toast.dismiss(toastId);
				toast.error(error.detail || 'failed to delete account');
				deleting = false;
				return;
			}

			const result = await response.json();
			toast.dismiss(toastId);

			const { deleted } = result;
			const summary = [
				deleted.tracks && `${deleted.tracks} tracks`,
				deleted.albums && `${deleted.albums} albums`,
				deleted.likes && `${deleted.likes} likes`,
				deleted.comments && `${deleted.comments} comments`,
				deleted.atproto_records && `${deleted.atproto_records} ATProto records`
			].filter(Boolean).join(', ');

			toast.success(`account deleted: ${summary || 'all data removed'}`);

			setTimeout(() => {
				window.location.href = '/';
			}, 2000);

		} catch (e) {
			console.error('delete failed:', e);
			toast.dismiss(toastId);
			toast.error('failed to delete account');
			deleting = false;
		}
	}

	async function logout() {
		await auth.logout();
		window.location.href = '/';
	}
</script>

{#if loading}
	<div class="loading">
		<WaveLoading size="lg" message="loading..." />
	</div>
{:else if auth.user}
	<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={logout} />
	<main>
		<div class="page-header">
			<h1>settings</h1>
			<a href="/portal" class="portal-link">manage your content →</a>
		</div>

		<section class="settings-section">
			<h2>appearance</h2>
			<div class="settings-card">
				<div class="setting-row">
					<div class="setting-info">
						<h3>theme</h3>
						<p>choose your preferred color scheme</p>
					</div>
					<div class="theme-buttons">
						{#each themes as theme}
							<button
								class="theme-btn"
								class:active={currentTheme === theme.value}
								onclick={() => selectTheme(theme.value)}
								title={theme.label}
							>
								{#if theme.icon === 'moon'}
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
									</svg>
								{:else if theme.icon === 'sun'}
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<circle cx="12" cy="12" r="5" />
										<path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
									</svg>
								{:else}
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<circle cx="12" cy="12" r="9" />
										<path d="M12 3v18" />
										<path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" opacity="0.3" />
									</svg>
								{/if}
								<span>{theme.label}</span>
							</button>
						{/each}
					</div>
				</div>

				<div class="setting-row">
					<div class="setting-info">
						<h3>accent color</h3>
						<p>customize the accent color throughout the app</p>
					</div>
					<div class="color-controls">
						<input type="color" value={currentColor} oninput={handleColorInput} class="color-input" />
						<div class="preset-grid">
							{#each presetColors as preset}
								<button
									class="preset-btn"
									class:active={currentColor.toLowerCase() === preset.value.toLowerCase()}
									style="background: {preset.value}"
									onclick={() => selectPreset(preset.value)}
									title={preset.name}
								></button>
							{/each}
						</div>
					</div>
				</div>
			</div>
		</section>

		<section class="settings-section">
			<h2>playback</h2>
			<div class="settings-card">
				<div class="setting-row">
					<div class="setting-info">
						<h3>auto-play next</h3>
						<p>when a track ends, automatically play the next item in your queue</p>
					</div>
					<label class="toggle-switch">
						<input
							type="checkbox"
							checked={autoAdvance}
							onchange={handleAutoAdvanceToggle}
						/>
						<span class="toggle-slider"></span>
					</label>
				</div>
			</div>
		</section>

		<section class="settings-section">
			<h2>privacy & display</h2>
			<div class="settings-card">
				<div class="setting-row">
					<div class="setting-info">
						<h3>sensitive artwork</h3>
						<p>show artwork that has been flagged as sensitive (nudity, etc.)</p>
					</div>
					<label class="toggle-switch">
						<input
							type="checkbox"
							checked={showSensitiveArtwork}
							onchange={(e) => saveShowSensitiveArtwork((e.target as HTMLInputElement).checked)}
						/>
						<span class="toggle-slider"></span>
					</label>
				</div>

				<div class="setting-row">
					<div class="setting-info">
						<h3>timed comments</h3>
						<p>allow other users to leave comments on your tracks</p>
					</div>
					<label class="toggle-switch">
						<input
							type="checkbox"
							checked={allowComments}
							onchange={(e) => saveAllowComments((e.target as HTMLInputElement).checked)}
						/>
						<span class="toggle-slider"></span>
					</label>
				</div>
			</div>
		</section>

		<section class="settings-section">
			<h2>integrations</h2>
			<div class="settings-card">
				<div class="setting-row">
					<div class="setting-info">
						<h3>teal.fm scrobbling</h3>
						<p>
							track your listens as <a href="https://pdsls.dev/at://{auth.user?.did}/fm.teal.alpha.feed.play" target="_blank" rel="noopener">fm.teal.alpha.feed.play</a> records
						</p>
					</div>
					<label class="toggle-switch">
						<input
							type="checkbox"
							checked={enableTealScrobbling}
							onchange={(e) => saveTealScrobbling((e.target as HTMLInputElement).checked)}
						/>
						<span class="toggle-slider"></span>
					</label>
				</div>
				{#if tealNeedsReauth}
					<div class="reauth-notice">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="12" cy="12" r="10" />
							<path d="M12 16v-4M12 8h.01" />
						</svg>
						<span>please log out and back in to connect teal.fm</span>
					</div>
				{/if}
			</div>
		</section>

		<section class="settings-section">
			<h2>developer</h2>
			<div class="settings-card">
				<div class="setting-info full-width">
					<h3>developer tokens</h3>
					<p>
						create tokens for programmatic API access (uploads, track management).
						use with the <a href="https://github.com/zzstoatzz/plyr-python-client" target="_blank" rel="noopener">python SDK</a>
					</p>
				</div>

				{#if loadingTokens}
					<p class="loading-tokens">loading tokens...</p>
				{:else if existingTokens.length > 0}
					<div class="existing-tokens">
						<h4 class="tokens-header">active tokens</h4>
						<div class="tokens-list">
							{#each existingTokens as token}
								<div class="token-item">
									<div class="token-info">
										<span class="token-name">{token.name || `token_${token.session_id}`}</span>
										<span class="token-meta">
											created {new Date(token.created_at).toLocaleDateString()}
											{#if token.expires_at}
												· expires {new Date(token.expires_at).toLocaleDateString()}
											{:else}
												· never expires
											{/if}
										</span>
									</div>
									<button
										class="revoke-btn"
										onclick={() => revokeToken(token.session_id, token.name)}
										disabled={revokingToken === token.session_id}
										title="revoke token"
									>
										{revokingToken === token.session_id ? '...' : 'revoke'}
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if developerToken}
					<div class="token-display">
						<code class="token-value">{developerToken}</code>
						<button class="copy-btn" onclick={copyToken} title="copy token">
							{tokenCopied ? '✓' : 'copy'}
						</button>
						<button class="dismiss-btn" onclick={() => developerToken = null} title="dismiss">
							✕
						</button>
					</div>
					<p class="token-warning">save this token now - you won't be able to see it again</p>
				{:else}
					<div class="token-form">
						<input
							type="text"
							class="token-name-input"
							bind:value={tokenName}
							placeholder="token name (optional)"
							disabled={creatingToken}
						/>
						<label class="expires-label">
							<span>expires in</span>
							<select bind:value={tokenExpiresDays} class="expires-select">
								<option value={30}>30 days</option>
								<option value={90}>90 days</option>
								<option value={180}>180 days</option>
								<option value={365}>1 year</option>
								<option value={0}>never</option>
							</select>
						</label>
						<button
							class="create-token-btn"
							onclick={createDeveloperToken}
							disabled={creatingToken}
						>
							{creatingToken ? 'creating...' : 'create token'}
						</button>
					</div>
				{/if}
			</div>
		</section>

		<section class="settings-section danger-section">
			<h2>account</h2>
			<div class="settings-card danger-zone">
				<div class="setting-info full-width">
					<h3>delete account</h3>
					<p>
						permanently delete all your data from plyr.fm.
						<a href="https://github.com/zzstoatzz/plyr.fm/blob/main/docs/offboarding.md#account-deletion" target="_blank" rel="noopener">learn more</a>
					</p>
				</div>
				{#if !showDeleteConfirm}
					<button
						class="delete-account-btn"
						onclick={() => showDeleteConfirm = true}
					>
						delete account
					</button>
				{:else}
					<div class="delete-confirm-panel">
						<p class="delete-warning">
							this will permanently delete all your tracks, albums, likes, and comments from plyr.fm. this cannot be undone.
						</p>

						<div class="atproto-section">
							<label class="atproto-option">
								<input type="checkbox" bind:checked={deleteAtprotoRecords} />
								<span>also delete records from my ATProto repo</span>
							</label>
							<p class="atproto-note">
								you can manage your PDS records directly via <a href="https://pdsls.dev/at://{auth.user?.did}" target="_blank" rel="noopener">pdsls.dev</a>, or let us clean them up for you.
							</p>
							{#if deleteAtprotoRecords}
								<p class="atproto-warning">
									this removes track, like, and comment records from your PDS. other users' likes and comments that reference your tracks will become orphaned.
								</p>
							{/if}
						</div>

						<p class="confirm-prompt">
							type <strong>{auth.user?.handle}</strong> to confirm:
						</p>
						<input
							type="text"
							class="confirm-input"
							bind:value={deleteConfirmText}
							placeholder={auth.user?.handle}
							disabled={deleting}
						/>

						<div class="delete-actions">
							<button
								class="cancel-btn"
								onclick={() => {
									showDeleteConfirm = false;
									deleteConfirmText = '';
									deleteAtprotoRecords = false;
								}}
								disabled={deleting}
							>
								cancel
							</button>
							<button
								class="confirm-delete-btn"
								onclick={deleteAccount}
								disabled={deleting || deleteConfirmText !== auth.user?.handle}
							>
								{deleting ? 'deleting...' : 'delete everything'}
							</button>
						</div>
					</div>
				{/if}
			</div>
		</section>
	</main>
{/if}

<style>
	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		color: var(--text-tertiary);
		gap: 1rem;
	}

	main {
		max-width: 700px;
		margin: 0 auto;
		padding: 0 1rem calc(var(--player-height, 120px) + 2rem + env(safe-area-inset-bottom, 0px));
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 2rem;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.page-header h1 {
		font-size: var(--text-page-heading);
		margin: 0;
	}

	.portal-link {
		color: var(--text-secondary);
		text-decoration: none;
		font-size: 0.85rem;
		padding: 0.4rem 0.75rem;
		background: var(--bg-tertiary);
		border-radius: 6px;
		border: 1px solid var(--border-default);
		transition: all 0.15s;
	}

	.portal-link:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.settings-section {
		margin-bottom: 2rem;
	}

	.settings-section h2 {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-tertiary);
		margin-bottom: 0.75rem;
	}

	.settings-card {
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: 10px;
		padding: 1rem 1.25rem;
	}

	.setting-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1.5rem;
		padding: 0.75rem 0;
	}

	.setting-row:not(:last-child) {
		border-bottom: 1px solid var(--border-subtle);
	}

	.setting-info {
		flex: 1;
		min-width: 0;
	}

	.setting-info.full-width {
		margin-bottom: 1rem;
	}

	.setting-info h3 {
		margin: 0 0 0.25rem;
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.setting-info p {
		margin: 0;
		font-size: 0.8rem;
		color: var(--text-tertiary);
		line-height: 1.4;
	}

	.setting-info a {
		color: var(--accent);
		text-decoration: none;
	}

	.setting-info a:hover {
		text-decoration: underline;
	}

	/* theme buttons */
	.theme-buttons {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.theme-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		padding: 0.6rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 8px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s;
		min-width: 60px;
	}

	.theme-btn:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.theme-btn.active {
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		border-color: var(--accent);
		color: var(--accent);
	}

	.theme-btn svg {
		width: 18px;
		height: 18px;
	}

	.theme-btn span {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	/* color controls */
	.color-controls {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-shrink: 0;
	}

	.color-input {
		width: 40px;
		height: 40px;
		border: 1px solid var(--border-default);
		border-radius: 8px;
		cursor: pointer;
		background: transparent;
	}

	.color-input::-webkit-color-swatch-wrapper {
		padding: 3px;
	}

	.color-input::-webkit-color-swatch {
		border-radius: 4px;
		border: none;
	}

	.preset-grid {
		display: flex;
		gap: 0.4rem;
	}

	.preset-btn {
		width: 32px;
		height: 32px;
		border-radius: 6px;
		border: 2px solid transparent;
		cursor: pointer;
		transition: all 0.15s;
		padding: 0;
	}

	.preset-btn:hover {
		transform: scale(1.1);
	}

	.preset-btn.active {
		border-color: var(--text-primary);
		box-shadow: 0 0 0 1px var(--bg-secondary);
	}

	/* toggle switch */
	.toggle-switch {
		position: relative;
		display: inline-block;
		flex-shrink: 0;
	}

	.toggle-switch input {
		opacity: 0;
		width: 0;
		height: 0;
		position: absolute;
	}

	.toggle-slider {
		display: block;
		width: 48px;
		height: 28px;
		background: var(--border-default);
		border-radius: 999px;
		position: relative;
		cursor: pointer;
		transition: background 0.2s;
	}

	.toggle-slider::after {
		content: '';
		position: absolute;
		top: 4px;
		left: 4px;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--text-secondary);
		transition: transform 0.2s, background 0.2s;
	}

	.toggle-switch input:checked + .toggle-slider {
		background: color-mix(in srgb, var(--accent) 65%, transparent);
	}

	.toggle-switch input:checked + .toggle-slider::after {
		transform: translateX(20px);
		background: var(--accent);
	}

	/* reauth notice */
	.reauth-notice {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem;
		background: color-mix(in srgb, var(--warning) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--warning) 30%, transparent);
		border-radius: 6px;
		margin-top: 0.75rem;
		font-size: 0.8rem;
		color: var(--warning);
	}

	/* developer tokens */
	.loading-tokens {
		color: var(--text-tertiary);
		font-size: 0.85rem;
	}

	.existing-tokens {
		margin-top: 1rem;
	}

	.tokens-header {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary);
		margin: 0 0 0.75rem;
	}

	.tokens-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.token-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 6px;
	}

	.token-info {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}

	.token-name {
		font-weight: 500;
		color: var(--text-primary);
		font-size: 0.9rem;
	}

	.token-meta {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.revoke-btn {
		padding: 0.4rem 0.75rem;
		background: transparent;
		border: 1px solid var(--border-emphasis);
		border-radius: 4px;
		color: var(--text-secondary);
		font-family: inherit;
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}

	.revoke-btn:hover:not(:disabled) {
		border-color: var(--error);
		color: var(--error);
	}

	.revoke-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.token-display {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1rem;
		padding: 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 6px;
	}

	.token-value {
		flex: 1;
		font-size: 0.8rem;
		word-break: break-all;
		color: var(--accent);
	}

	.copy-btn,
	.dismiss-btn {
		padding: 0.4rem 0.6rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-secondary);
		font-family: inherit;
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.copy-btn:hover,
	.dismiss-btn:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.token-warning {
		margin-top: 0.5rem;
		font-size: 0.8rem;
		color: var(--warning);
	}

	.token-form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.token-name-input {
		flex: 1;
		min-width: 150px;
		padding: 0.6rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 6px;
		color: var(--text-primary);
		font-size: 0.9rem;
		font-family: inherit;
	}

	.token-name-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.expires-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: var(--text-secondary);
	}

	.expires-select {
		padding: 0.5rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 6px;
		color: var(--text-primary);
		font-size: 0.85rem;
		font-family: inherit;
		cursor: pointer;
	}

	.expires-select:focus {
		outline: none;
		border-color: var(--accent);
	}

	.create-token-btn {
		padding: 0.6rem 1rem;
		background: var(--accent);
		border: none;
		border-radius: 6px;
		color: var(--text-primary);
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}

	.create-token-btn:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.create-token-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* danger zone */
	.danger-section h2 {
		color: var(--error);
	}

	.danger-zone {
		border-color: color-mix(in srgb, var(--error) 30%, transparent);
	}

	.delete-account-btn {
		width: 100%;
		padding: 0.75rem;
		background: transparent;
		border: 1px solid var(--error);
		border-radius: 6px;
		color: var(--error);
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.delete-account-btn:hover {
		background: color-mix(in srgb, var(--error) 10%, transparent);
	}

	.delete-confirm-panel {
		margin-top: 1rem;
		padding: 1rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 8px;
	}

	.delete-warning {
		margin: 0 0 1rem;
		color: var(--error);
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.atproto-section {
		margin-bottom: 1rem;
		padding: 0.75rem;
		background: var(--bg-tertiary);
		border-radius: 6px;
	}

	.atproto-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: var(--text-primary);
		cursor: pointer;
	}

	.atproto-option input {
		width: 16px;
		height: 16px;
		accent-color: var(--accent);
	}

	.atproto-note {
		margin: 0.5rem 0 0;
		font-size: 0.8rem;
		color: var(--text-tertiary);
	}

	.atproto-note a {
		color: var(--accent);
		text-decoration: none;
	}

	.atproto-note a:hover {
		text-decoration: underline;
	}

	.atproto-warning {
		margin: 0.5rem 0 0;
		padding: 0.5rem;
		background: color-mix(in srgb, var(--warning) 10%, transparent);
		border-radius: 4px;
		font-size: 0.8rem;
		color: var(--warning);
	}

	.confirm-prompt {
		margin: 0 0 0.5rem;
		font-size: 0.9rem;
		color: var(--text-secondary);
	}

	.confirm-input {
		width: 100%;
		padding: 0.6rem 0.75rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: 6px;
		color: var(--text-primary);
		font-size: 0.9rem;
		font-family: inherit;
		margin-bottom: 1rem;
	}

	.confirm-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.delete-actions {
		display: flex;
		gap: 0.75rem;
	}

	.cancel-btn {
		flex: 1;
		padding: 0.6rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: 6px;
		color: var(--text-secondary);
		font-family: inherit;
		font-size: 0.9rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.cancel-btn:hover:not(:disabled) {
		border-color: var(--text-secondary);
	}

	.cancel-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.confirm-delete-btn {
		flex: 1;
		padding: 0.6rem;
		background: var(--error);
		border: none;
		border-radius: 6px;
		color: white;
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
	}

	.confirm-delete-btn:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.confirm-delete-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (max-width: 600px) {
		.setting-row {
			flex-direction: column;
			gap: 1rem;
		}

		.theme-buttons {
			width: 100%;
		}

		.theme-btn {
			flex: 1;
		}

		.color-controls {
			width: 100%;
			justify-content: flex-start;
		}

		.token-form {
			flex-direction: column;
		}

		.expires-label {
			width: 100%;
			justify-content: space-between;
		}
	}
</style>
