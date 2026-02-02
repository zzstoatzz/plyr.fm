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
		info_url?: string;
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
					<label for="handle">
						<a href="https://internethandle.org" target="_blank" rel="noopener" class="handle-label-link">internet handle</a>
					</label>
					<HandleAutocomplete
						bind:value={handle}
						onSelect={handleSelect}
						placeholder="you.bsky.social"
						disabled={loading}
					/>
					<div class="handle-hint">
						<span class="handle-hint-prefix">your </span><span>@handle from</span>
						<a href="https://bsky.app" target="_blank" rel="noopener" class="service-inline bluesky"><svg viewBox="0 0 600 530" width="12" height="11"><path d="m135.72 44.03c66.496 49.921 138.02 151.14 164.28 205.46 26.262-54.316 97.782-155.54 164.28-205.46 47.98-36.021 125.72-63.892 125.72 24.795 0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.3797-3.6904-10.832-3.7077-7.8964-0.0174-2.9357-1.1937 0.51669-3.7077 7.8964-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.4491-163.25-81.433-5.9562-21.282-16.111-152.36-16.111-170.07 0-88.687 77.742-60.816 125.72-24.795z" fill="currentColor"/></svg> Bluesky</a>
						<span>or</span>
						<a href="https://blackskyweb.xyz" target="_blank" rel="noopener" class="service-inline blacksky"><svg viewBox="0 0 88 75" width="11" height="10" fill="currentColor"><path d="M41.9565 74.9643L24.0161 74.9653L41.9565 74.9643ZM63.8511 74.9653H45.9097L63.8501 74.9643V57.3286H63.8511V74.9653ZM45.9097 44.5893C45.9099 49.2737 49.7077 53.0707 54.3921 53.0707H63.8501V57.3286H54.3921C49.7077 57.3286 45.9099 61.1257 45.9097 65.81V74.9643H41.9565V65.81C41.9563 61.1258 38.1593 57.3287 33.4751 57.3286H24.0161V53.0707H33.4741C38.1587 53.0707 41.9565 49.2729 41.9565 44.5883V35.1303H45.9097V44.5893ZM63.8511 53.0707H63.8501V35.1303H63.8511V53.0707Z"/><path d="M52.7272 9.83198C49.4148 13.1445 49.4148 18.5151 52.7272 21.8275L59.4155 28.5158L56.4051 31.5262L49.7169 24.8379C46.4044 21.5254 41.0338 21.5254 37.7213 24.8379L31.2482 31.3111L28.4527 28.5156L34.9259 22.0424C38.2383 18.7299 38.2383 13.3594 34.9259 10.0469L28.2378 3.35883L31.2482 0.348442L37.9365 7.03672C41.2489 10.3492 46.6195 10.3492 49.932 7.03672L56.6203 0.348442L59.4155 3.14371L52.7272 9.83198Z"/><path d="M24.3831 23.2335C23.1706 27.7584 25.8559 32.4095 30.3808 33.6219L39.5172 36.07L38.4154 40.182L29.2793 37.734C24.7544 36.5215 20.1033 39.2068 18.8909 43.7317L16.5215 52.5745L12.7028 51.5513L15.0721 42.7088C16.2846 38.1839 13.5993 33.5328 9.07434 32.3204L-0.0620117 29.8723L1.03987 25.76L10.1762 28.2081C14.7011 29.4206 19.3522 26.7352 20.5647 22.2103L23.0127 13.074L26.8311 14.0971L24.3831 23.2335Z"/><path d="M67.3676 22.0297C68.5801 26.5546 73.2311 29.2399 77.756 28.0275L86.8923 25.5794L87.9941 29.6914L78.8578 32.1394C74.3329 33.3519 71.6476 38.003 72.86 42.5279L75.2294 51.3707L71.411 52.3938L69.0417 43.5513C67.8293 39.0264 63.1782 36.3411 58.6533 37.5535L49.5169 40.0016L48.415 35.8894L57.5514 33.4413C62.0763 32.2288 64.7616 27.5778 63.5492 23.0528L61.1011 13.9165L64.9195 12.8934L67.3676 22.0297Z"/></svg> Blacksky</a>
					</div>
				</div>

				<button type="submit" class="primary" disabled={loading || !handle.trim()}>
					{loading ? 'redirecting...' : 'sign in'}
				</button>
			{:else}
				<div class="input-group">
					<span class="input-label">choose a <a href="https://at-me.zzstoatzz.io/view/?handle=zzstoatzz.io" target="_blank" rel="noopener" class="home-link">home</a> for your data</span>
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
										{#if pds.info_url}
											<a href={pds.info_url} target="_blank" rel="noopener" class="pds-description-link" onclick={(e) => e.stopPropagation()}>{pds.description}</a>
										{:else}
											<span class="pds-description">{pds.description}</span>
										{/if}
									{/if}
								</div>
							</label>
						{/each}
					</div>
					<p class="pds-note">
						<a href="https://bsky.app" target="_blank" rel="noopener" class="service-inline"><svg viewBox="0 0 600 530" width="12" height="11" fill="currentColor"><path d="m135.72 44.03c66.496 49.921 138.02 151.14 164.28 205.46 26.262-54.316 97.782-155.54 164.28-205.46 47.98-36.021 125.72-63.892 125.72 24.795 0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.3797-3.6904-10.832-3.7077-7.8964-0.0174-2.9357-1.1937 0.51669-3.7077 7.8964-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.4491-163.25-81.433-5.9562-21.282-16.111-152.36-16.111-170.07 0-88.687 77.742-60.816 125.72-24.795z"/></svg> Bluesky</a> and
						<a href="https://blackskyweb.xyz" target="_blank" rel="noopener" class="service-inline"><svg viewBox="0 0 88 75" width="11" height="10" fill="currentColor"><path d="M41.9565 74.9643L24.0161 74.9653L41.9565 74.9643ZM63.8511 74.9653H45.9097L63.8501 74.9643V57.3286H63.8511V74.9653ZM45.9097 44.5893C45.9099 49.2737 49.7077 53.0707 54.3921 53.0707H63.8501V57.3286H54.3921C49.7077 57.3286 45.9099 61.1257 45.9097 65.81V74.9643H41.9565V65.81C41.9563 61.1258 38.1593 57.3287 33.4751 57.3286H24.0161V53.0707H33.4741C38.1587 53.0707 41.9565 49.2729 41.9565 44.5883V35.1303H45.9097V44.5893ZM63.8511 53.0707H63.8501V35.1303H63.8511V53.0707Z"/><path d="M52.7272 9.83198C49.4148 13.1445 49.4148 18.5151 52.7272 21.8275L59.4155 28.5158L56.4051 31.5262L49.7169 24.8379C46.4044 21.5254 41.0338 21.5254 37.7213 24.8379L31.2482 31.3111L28.4527 28.5156L34.9259 22.0424C38.2383 18.7299 38.2383 13.3594 34.9259 10.0469L28.2378 3.35883L31.2482 0.348442L37.9365 7.03672C41.2489 10.3492 46.6195 10.3492 49.932 7.03672L56.6203 0.348442L59.4155 3.14371L52.7272 9.83198Z"/><path d="M24.3831 23.2335C23.1706 27.7584 25.8559 32.4095 30.3808 33.6219L39.5172 36.07L38.4154 40.182L29.2793 37.734C24.7544 36.5215 20.1033 39.2068 18.8909 43.7317L16.5215 52.5745L12.7028 51.5513L15.0721 42.7088C16.2846 38.1839 13.5993 33.5328 9.07434 32.3204L-0.0620117 29.8723L1.03987 25.76L10.1762 28.2081C14.7011 29.4206 19.3522 26.7352 20.5647 22.2103L23.0127 13.074L26.8311 14.0971L24.3831 23.2335Z"/><path d="M67.3676 22.0297C68.5801 26.5546 73.2311 29.2399 77.756 28.0275L86.8923 25.5794L87.9941 29.6914L78.8578 32.1394C74.3329 33.3519 71.6476 38.003 72.86 42.5279L75.2294 51.3707L71.411 52.3938L69.0417 43.5513C67.8293 39.0264 63.1782 36.3411 58.6533 37.5535L49.5169 40.0016L48.415 35.8894L57.5514 33.4413C62.0763 32.2288 64.7616 27.5778 63.5492 23.0528L61.1011 13.9165L64.9195 12.8934L67.3676 22.0297Z"/></svg> Blacksky</a> also host accounts.
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
					<span>new to <a href="https://atproto.com" target="_blank" rel="noopener" class="toggle-link" onclick={(e) => e.stopPropagation()}>the atmosphere</a>?</span>
					<svg class="chevron" class:open={showHandleInfo} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<polyline points="6 9 12 15 18 9"></polyline>
					</svg>
				</button>
				{#if showHandleInfo}
					<div class="faq-content">
						<p class="welcome">hey, welcome in! you'll need an account.</p>
						<p>
							{#if creationEnabled}
								<button class="link-button" onclick={switchToCreate}>create one here</button>, or
							{/if}
							sign up with <a href="https://bsky.app" target="_blank" rel="noopener">Bluesky</a> or <a href="https://blackskyweb.xyz" target="_blank" rel="noopener">Blacksky</a> and come back.
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
		& .handle-label-link { color: var(--text-secondary); text-decoration: none; border-bottom: 1px dashed var(--border-default); }
		& .handle-label-link:hover { color: var(--text-primary); border-bottom-color: var(--text-tertiary); }
		& .home-link { color: var(--accent); text-decoration: none; border-bottom: 1px solid var(--accent); }
		& .home-link:hover { border-bottom-style: dashed; }
	}

	.handle-hint {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
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

	.faq-toggle:hover { color: var(--text-primary); }

	.toggle-link { color: inherit; text-decoration: none; border-bottom: 1px dashed var(--border-default); }
	.toggle-link:hover { color: var(--accent); border-bottom-color: var(--accent); }

	.chevron { transition: transform 0.2s; flex-shrink: 0; }
	.chevron.open { transform: rotate(180deg); }

	.faq-content {
		padding: 0 0 1rem 0;
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		line-height: 1.6;
		& p { margin: 0 0 0.75rem 0; text-align: left; }
		& p:last-child { margin-bottom: 0; }
		& p.welcome { color: var(--text-primary); font-weight: 500; }
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

	.pds-description, .pds-description-link {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	.pds-description-link { text-decoration: none; }
	.pds-description-link:hover { color: var(--accent); }

	.pds-note {
		margin: 0.75rem 0 0;
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		text-align: center;
		& a { color: var(--accent); text-decoration: none; }
		& a:hover { text-decoration: underline; }
	}


	.service-inline {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		& svg { vertical-align: middle; }
		&.bluesky:hover { color: #0085ff; }
		&.blacksky:hover { color: #fff; }
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

		.handle-hint-prefix {
			display: none;
		}
	}
</style>
