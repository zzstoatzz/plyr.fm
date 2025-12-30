<script lang="ts">
	import { APP_NAME } from '$lib/branding';
	import { API_URL } from '$lib/config';
	import HandleAutocomplete from '$lib/components/HandleAutocomplete.svelte';

	let handle = $state('');
	let loading = $state(false);
	let showHandleInfo = $state(false);
	let showPdsInfo = $state(false);

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
		if (!handle.trim()) return;
		loading = true;
		const normalized = normalizeInput(handle);
		window.location.href = `${API_URL}/auth/start?handle=${encodeURIComponent(normalized)}`;
	}

	function handleSelect(selected: string) {
		handle = selected;
	}
</script>

<div class="container">
	<div class="login-card">
		<h1>sign in to {APP_NAME}</h1>

		<form onsubmit={startOAuth}>
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
		</form>

		<div class="faq">
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
						the easiest way to get one is to sign up for <a href="https://bsky.app" target="_blank" rel="noopener">Bluesky</a>.
						once you have an account, you can use that handle here.
					</p>
				</div>
			{/if}
		</div>
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

	label {
		color: var(--text-secondary);
		font-size: 0.9rem;
	}

	button.primary {
		width: 100%;
		padding: 0.85rem;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-size: 0.95rem;
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
		font-size: 0.9rem;
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
		font-size: 0.85rem;
		line-height: 1.6;
	}

	.faq-content p {
		margin: 0 0 0.75rem 0;
		text-align: left;
	}

	.faq-content p:last-child {
		margin-bottom: 0;
	}

	.faq-content a {
		color: var(--accent);
		text-decoration: none;
	}

	.faq-content a:hover {
		text-decoration: underline;
	}

	.faq-content code {
		background: var(--bg-secondary);
		padding: 0.15rem 0.4rem;
		border-radius: var(--radius-sm);
		font-size: 0.85em;
	}

	@media (max-width: 480px) {
		.login-card {
			padding: 2rem 1.5rem;
		}

		h1 {
			font-size: 1.5rem;
		}
	}
</style>
