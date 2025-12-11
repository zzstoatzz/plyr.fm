<script lang="ts">
	import { goto } from '$app/navigation';
	import { APP_NAME } from '$lib/branding';
	import { auth } from '$lib/auth.svelte';
	import { preferences } from '$lib/preferences.svelte';

	let accepting = $state(false);
	let error = $state<string | null>(null);

	async function handleAccept() {
		accepting = true;
		error = null;

		const success = await preferences.acceptTerms();

		if (success) {
			// redirect to portal or wherever they were going
			goto('/portal');
		} else {
			error = 'failed to accept terms. please try again.';
			accepting = false;
		}
	}

	function handleDecline() {
		// log them out and send to home
		auth.logout();
		goto('/');
	}
</script>

<svelte:head>
	<title>accept terms - {APP_NAME}</title>
</svelte:head>

<div class="accept-terms-container">
	<div class="accept-terms-content">
		<h1>welcome to {APP_NAME}</h1>
		<p class="subtitle">please review and accept our terms to continue</p>

		<div class="terms-summary">
			<h2>key points</h2>
			<ul>
				<li>
					<strong>your content:</strong> you retain ownership of everything you upload.
					we get a license to host and stream it.
				</li>
				<li>
					<strong>copyright:</strong> don't upload content you don't have rights to.
					we follow DMCA takedown procedures.
				</li>
				<li>
					<strong>AT Protocol:</strong> your identity and some data lives on the decentralized
					network, not just our servers.
				</li>
				<li>
					<strong>privacy:</strong> we don't sell your data or use it for ads.
				</li>
			</ul>
		</div>

		<div class="full-terms-link">
			<p>
				read the full <a href="/terms" target="_blank">terms of service</a> and
				<a href="/privacy" target="_blank">privacy policy</a>
			</p>
		</div>

		{#if error}
			<p class="error">{error}</p>
		{/if}

		<div class="actions">
			<button class="accept-btn" onclick={handleAccept} disabled={accepting}>
				{accepting ? 'accepting...' : 'i accept'}
			</button>
			<button class="decline-btn" onclick={handleDecline} disabled={accepting}>
				decline & logout
			</button>
		</div>
	</div>
</div>

<style>
	.accept-terms-container {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
	}

	.accept-terms-content {
		max-width: 600px;
		width: 100%;
		text-align: center;
	}

	h1 {
		font-size: 2rem;
		margin: 0 0 0.5rem 0;
		color: var(--text-primary);
	}

	.subtitle {
		color: var(--text-tertiary);
		margin: 0 0 2rem 0;
	}

	.terms-summary {
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		padding: 1.5rem;
		text-align: left;
		margin-bottom: 1.5rem;
	}

	.terms-summary h2 {
		font-size: 1rem;
		margin: 0 0 1rem 0;
		color: var(--text-secondary);
		text-transform: lowercase;
	}

	.terms-summary ul {
		margin: 0;
		padding-left: 1.25rem;
	}

	.terms-summary li {
		margin-bottom: 0.75rem;
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.terms-summary li:last-child {
		margin-bottom: 0;
	}

	.terms-summary strong {
		color: var(--text-primary);
	}

	.full-terms-link {
		margin-bottom: 1.5rem;
	}

	.full-terms-link p {
		margin: 0;
		color: var(--text-tertiary);
		font-size: 0.9rem;
	}

	.full-terms-link a {
		color: var(--accent);
		text-decoration: none;
	}

	.full-terms-link a:hover {
		text-decoration: underline;
	}

	.error {
		color: var(--error);
		margin-bottom: 1rem;
	}

	.actions {
		display: flex;
		gap: 1rem;
		justify-content: center;
	}

	.accept-btn {
		background: var(--accent);
		color: white;
		border: none;
		padding: 0.75rem 2rem;
		border-radius: 6px;
		font-size: 1rem;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.accept-btn:hover:not(:disabled) {
		opacity: 0.9;
	}

	.accept-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.decline-btn {
		background: transparent;
		color: var(--text-tertiary);
		border: 1px solid var(--border-subtle);
		padding: 0.75rem 1.5rem;
		border-radius: 6px;
		font-size: 1rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.decline-btn:hover:not(:disabled) {
		border-color: var(--text-tertiary);
		color: var(--text-secondary);
	}

	.decline-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	@media (max-width: 500px) {
		.actions {
			flex-direction: column;
		}

		.accept-btn,
		.decline-btn {
			width: 100%;
		}
	}
</style>
