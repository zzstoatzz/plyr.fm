<script lang="ts">
	import { onMount } from 'svelte';
	import { APP_NAME } from '$lib/branding';
	import { API_URL } from '$lib/config';
	import HandleAutocomplete from '$lib/components/HandleAutocomplete.svelte';

	type Mode = 'signin' | 'create';

	interface PdsOption {
		name: string;
		url: string;
		recommended: boolean;
		description?: string;
	}

	let mode = $state<Mode>('signin');
	let handle = $state('');
	let loading = $state(false);
	let showHandleInfo = $state(false);
	let showPdsInfo = $state(false);

	// account creation state
	let creationEnabled = $state(false);
	let pdsOptions = $state<PdsOption[]>([]);
	let selectedPds = $state('');

	onMount(async () => {
		try {
			const res = await fetch(`${API_URL}/auth/pds-options`);
			if (res.ok) {
				const data = await res.json();
				creationEnabled = data.enabled;
				pdsOptions = data.options;
				// default to recommended PDS
				const recommended = data.options.find((p: PdsOption) => p.recommended);
				if (recommended) selectedPds = recommended.url;
			}
		} catch {
			// silently fail - creation just won't be available
		}
	});

	/**
	 * normalize user input to a valid identifier for OAuth
	 *
	 * accepts:
	 * - handles: "user.bsky.social", "@user.bsky.social", "at://user.bsky.social"
	 * - DIDs: "did:plc:abc123", "at://did:plc:abc123"
	 */
	function normalizeInput(input: string): string {
		let value = input.trim();

		// strip at:// prefix (valid for both handles and DIDs per AT-URI spec)
		if (value.startsWith('at://')) {
			value = value.slice(5);
		}

		// strip @ prefix from handles
		if (value.startsWith('@')) {
			value = value.slice(1);
		}

		return value;
	}

	function startOAuth(e: SubmitEvent) {
		e.preventDefault();
		loading = true;

		if (mode === 'signin') {
			if (!handle.trim()) return;
			const normalized = normalizeInput(handle);
			window.location.href = `${API_URL}/auth/start?handle=${encodeURIComponent(normalized)}`;
		} else {
			if (!selectedPds) return;
			window.location.href = `${API_URL}/auth/start?pds_url=${encodeURIComponent(selectedPds)}`;
		}
	}

	function handleSelect(selected: string) {
		handle = selected;
	}

	function switchToCreate() {
		mode = 'create';
		showPdsInfo = false;
	}
</script>

<div class="container">
	<div class="login-card">
		{#if creationEnabled}
			<div class="mode-tabs">
				<button
					class="mode-tab"
					class:active={mode === 'signin'}
					onclick={() => (mode = 'signin')}
				>
					sign in
				</button>
				<button
					class="mode-tab"
					class:active={mode === 'create'}
					onclick={() => (mode = 'create')}
				>
					create account
				</button>
			</div>
		{/if}

		<h1>{mode === 'signin' ? `sign in to ${APP_NAME}` : 'create account'}</h1>

		<form onsubmit={startOAuth}>
			{#if mode === 'signin'}
				<div class="input-group">
					<label for="handle">internet handle</label>
					<HandleAutocomplete
						bind:value={handle}
						onSelect={handleSelect}
						placeholder="you.bsky.social"
						disabled={loading}
					/>
				</div>

				<button type="submit" class="primary" disabled={loading || !handle.trim()}>
					{loading ? 'redirecting...' : 'sign in'}
				</button>
			{:else}
				<div class="input-group">
					<span class="input-label">pick a home on <a href="https://atproto.com" target="_blank" rel="noopener" class="atmosphere-link">the atmosphere</a></span>
					<div class="pds-options">
						{#each pdsOptions as pds (pds.url)}
							<label class="pds-option" class:selected={selectedPds === pds.url}>
								<input
									type="radio"
									name="pds"
									value={pds.url}
									bind:group={selectedPds}
									disabled={loading}
								/>
								<div class="pds-option-content">
									<div class="pds-option-header">
										<span class="pds-name">{pds.name}</span>
										{#if pds.recommended}
											<span class="pds-badge">recommended</span>
										{/if}
									</div>
									{#if pds.description}
										<span class="pds-description">{pds.description}</span>
									{/if}
								</div>
							</label>
						{/each}
					</div>
					<p class="pds-note">
						or sign up directly with
						<a href="https://bsky.app" target="_blank" rel="noopener">Bluesky</a>
						or
						<a href="https://blackskyweb.xyz" target="_blank" rel="noopener">Blacksky</a>
					</p>
				</div>

				<button type="submit" class="primary" disabled={loading || !selectedPds}>
					{loading ? 'redirecting...' : 'create account'}
				</button>
			{/if}
		</form>

		<div class="faq">
			{#if mode === 'signin'}
				<button
					class="faq-toggle"
					onclick={() => (showHandleInfo = !showHandleInfo)}
					aria-expanded={showHandleInfo}
				>
					<span>what is an internet handle?</span>
					<svg
						class="chevron"
						class:open={showHandleInfo}
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<polyline points="6 9 12 15 18 9"></polyline>
					</svg>
				</button>
				{#if showHandleInfo}
					<div class="faq-content">
						<p>
							your internet handle is a domain that identifies you across apps built on
							<a href="https://atproto.com" target="_blank" rel="noopener">AT Protocol</a>.
							if you signed up for Bluesky or another ATProto service, you already have one
							(like <code>yourname.bsky.social</code>).
						</p>
						<p>
							read more at <a href="https://internethandle.org" target="_blank" rel="noopener">internethandle.org</a>.
						</p>
					</div>
				{/if}

				<button
					class="faq-toggle"
					onclick={() => (showPdsInfo = !showPdsInfo)}
					aria-expanded={showPdsInfo}
				>
					<span>don't have one?</span>
					<svg
						class="chevron"
						class:open={showPdsInfo}
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<polyline points="6 9 12 15 18 9"></polyline>
					</svg>
				</button>
				{#if showPdsInfo}
					<div class="faq-content">
						<p>
							pick a home on the atmosphere &mdash;
							{#if creationEnabled}
								<button class="link-button" onclick={switchToCreate}>create an account</button>
							{:else}
								sign up for <a href="https://bsky.app" target="_blank" rel="noopener">Bluesky</a>
							{/if}
							to get started.
						</p>
					</div>
				{/if}
			{:else}
				<button
					class="faq-toggle"
					onclick={() => (showPdsInfo = !showPdsInfo)}
					aria-expanded={showPdsInfo}
				>
					<span>what is a PDS?</span>
					<svg
						class="chevron"
						class:open={showPdsInfo}
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<polyline points="6 9 12 15 18 9"></polyline>
					</svg>
				</button>
				{#if showPdsInfo}
					<div class="faq-content">
						<p>
							a Personal Data Server (PDS) is where your data lives on the
							<a href="https://atproto.com" target="_blank" rel="noopener">AT Protocol</a> network.
							think of it as choosing a home for your account &mdash; you can always move later.
						</p>
						<p>
							learn more at <a href="https://atproto.com/guides/self-hosting" target="_blank" rel="noopener">atproto.com</a>.
						</p>
					</div>
				{/if}
			{/if}
		</div>

		<a href="/" class="back-link">← back to home</a>
	</div>
</div>

<style>
	.container {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-primary);
		padding: 1rem;
	}

	.login-card {
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		padding: 2.5rem;
		max-width: 420px;
		width: 100%;
	}

	.mode-tabs {
		display: flex;
		gap: 0;
		margin-bottom: 1.5rem;
		background: var(--bg-secondary);
		border-radius: var(--radius-md);
		padding: 0.25rem;
	}

	.mode-tab {
		flex: 1;
		padding: 0.6rem 1rem;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--text-secondary);
		font-family: inherit;
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.mode-tab:hover:not(.active) {
		color: var(--text-primary);
	}

	.mode-tab.active {
		background: var(--bg-tertiary);
		color: var(--text-primary);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
	}

	h1 {
		font-size: 1.75rem;
		margin: 0 0 2rem 0;
		color: var(--text-primary);
		text-align: center;
		font-weight: 600;
		white-space: nowrap;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.input-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	label,
	.input-label {
		color: var(--text-secondary);
		font-size: var(--text-base);
		& .atmosphere-link { color: var(--accent); text-decoration: none; }
		& .atmosphere-link:hover { text-decoration: underline; }
	}

	button.primary {
		width: 100%;
		padding: 0.85rem;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-size: var(--text-base);
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
	}

	button.primary:hover:not(:disabled) {
		opacity: 0.9;
	}

	button.primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.faq {
		margin-top: 1.5rem;
		border-top: 1px solid var(--border-subtle);
		padding-top: 1rem;
	}

	.faq-toggle {
		width: 100%;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 0;
		background: none;
		border: none;
		color: var(--text-secondary);
		font-family: inherit;
		font-size: var(--text-base);
		cursor: pointer;
		text-align: left;
	}

	.faq-toggle:hover {
		color: var(--text-primary);
	}

	.chevron {
		transition: transform 0.2s;
		flex-shrink: 0;
	}

	.chevron.open {
		transform: rotate(180deg);
	}

	.faq-content {
		padding: 0 0 1rem 0;
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		line-height: 1.6;
		& p { margin: 0 0 0.75rem 0; text-align: left; }
		& p:last-child { margin-bottom: 0; }
		& a { color: var(--accent); text-decoration: none; }
		& a:hover { text-decoration: underline; }
		& code { background: var(--bg-secondary); padding: 0.15rem 0.4rem; border-radius: var(--radius-sm); font-size: 0.85em; }
	}

	.link-button {
		background: none;
		border: none;
		padding: 0;
		color: var(--accent);
		font-family: inherit;
		font-size: inherit;
		cursor: pointer;
		text-decoration: none;
	}

	.link-button:hover {
		text-decoration: underline;
	}

	/* PDS selection styles */
	.pds-options {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.pds-option {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: all 0.15s;
	}

	.pds-option:hover {
		border-color: var(--border-default);
	}

	.pds-option.selected {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 8%, var(--bg-secondary));
	}

	.pds-option input[type='radio'] {
		margin-top: 0.125rem;
		accent-color: var(--accent);
	}

	.pds-option-content {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1;
	}

	.pds-option-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.pds-name {
		color: var(--text-primary);
		font-weight: 500;
	}

	.pds-badge {
		font-size: var(--text-xs);
		padding: 0.125rem 0.375rem;
		background: var(--accent);
		color: white;
		border-radius: var(--radius-sm);
	}

	.pds-description {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	.pds-note {
		margin: 0.75rem 0 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		text-align: center;
		& a { color: var(--accent); text-decoration: none; }
		& a:hover { text-decoration: underline; }
	}

	.back-link {
		display: block;
		text-align: center;
		margin-top: 1.5rem;
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		text-decoration: none;
	}

	.back-link:hover {
		color: var(--text-secondary);
	}

	@media (max-width: 480px) {
		.login-card {
			padding: 2rem 1.5rem;
		}

		h1 {
			font-size: var(--text-3xl);
		}
	}
</style>
