<script lang="ts">
	import { APP_NAME } from '$lib/branding';
	import { auth } from '$lib/auth.svelte';
	import { preferences } from '$lib/preferences.svelte';

	let accepting = $state(false);
	let error = $state<string | null>(null);

	async function handleAccept() {
		accepting = true;
		error = null;

		const success = await preferences.acceptTerms();

		if (!success) {
			error = 'failed to accept terms. please try again.';
			accepting = false;
		}
	}

	async function handleDecline() {
		await auth.logout();
		// force page reload to clear layout data
		window.location.href = '/';
	}
</script>

<div class="terms-overlay">
	<div class="terms-modal">
		<h1>welcome to {APP_NAME}</h1>
		<p class="subtitle">please review and accept our terms to continue</p>

		<div class="terms-summary">
			<h2>key points</h2>
			<ul>
				<li>
					<strong>your content:</strong> you own what you upload. audio files are stored
					in public blob storage we control; track metadata is written to your PDS. delete
					through {APP_NAME} and we remove the audio from storage.
				</li>
				<li>
					<strong>copyright:</strong> don't upload content you don't have rights to.
					we follow DMCA takedown procedures.
				</li>
				<li>
					<strong>AT Protocol:</strong> your identity and public data (likes, comments,
					playlists) are stored on your
					<a href="https://atproto.com/guides/glossary#pds-personal-data-server" target="_blank" rel="noopener">PDS</a>.
					this data is public and accessible via ATProto.
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
	.terms-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.9);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 9999;
		padding: 1rem;
	}

	.terms-modal {
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		padding: 2rem;
		max-width: 600px;
		width: 100%;
		max-height: 90vh;
		overflow-y: auto;
		text-align: center;
	}

	h1 {
		font-size: 1.75rem;
		margin: 0 0 0.5rem 0;
		color: var(--text-primary);
	}

	.subtitle {
		color: var(--text-tertiary);
		margin: 0 0 1.5rem 0;
	}

	.terms-summary {
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		padding: 1.25rem;
		text-align: left;
		margin-bottom: 1.25rem;
	}

	.terms-summary h2 {
		font-size: 0.9rem;
		margin: 0 0 0.75rem 0;
		color: var(--text-secondary);
		text-transform: lowercase;
	}

	.terms-summary ul {
		margin: 0;
		padding-left: 1.25rem;
	}

	.terms-summary li {
		margin-bottom: 0.6rem;
		color: var(--text-secondary);
		line-height: 1.5;
		font-size: 0.9rem;
	}

	.terms-summary li:last-child {
		margin-bottom: 0;
	}

	.terms-summary strong {
		color: var(--text-primary);
	}

	.terms-summary a {
		color: var(--accent);
		text-decoration: none;
	}

	.terms-summary a:hover {
		text-decoration: underline;
	}

	.full-terms-link {
		margin-bottom: 1.25rem;
	}

	.full-terms-link p {
		margin: 0;
		color: var(--text-tertiary);
		font-size: 0.85rem;
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
		font-size: 0.9rem;
	}

	.actions {
		display: flex;
		gap: 0.75rem;
		justify-content: center;
	}

	.accept-btn {
		background: var(--accent);
		color: white;
		border: none;
		padding: 0.7rem 1.75rem;
		border-radius: 6px;
		font-family: inherit;
		font-size: 0.95rem;
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
		padding: 0.7rem 1.25rem;
		border-radius: 6px;
		font-family: inherit;
		font-size: 0.95rem;
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
		.terms-modal {
			padding: 1.5rem;
		}

		h1 {
			font-size: 1.5rem;
		}

		.actions {
			flex-direction: column;
		}

		.accept-btn,
		.decline-btn {
			width: 100%;
		}
	}
</style>
