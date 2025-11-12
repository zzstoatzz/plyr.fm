<script lang="ts">
	import { APP_NAME, APP_TAGLINE } from '$lib/branding';
	import { API_URL } from '$lib/config';

	let handle = '';
	let loading = false;

	function startOAuth(e: SubmitEvent) {
		e.preventDefault();
		if (!handle.trim()) return;
		loading = true;
		// redirect to backend OAuth start endpoint
		window.location.href = `${API_URL}/auth/start?handle=${encodeURIComponent(handle)}`;
	}
</script>

<div class="container">
	<div class="login-card">
		<h1>{APP_NAME}</h1>
		<p>{APP_TAGLINE}</p>

		<form onsubmit={startOAuth}>
			<div class="input-group">
				<div class="label-row">
					<label for="handle">atproto handle</label>
					<a
						href="https://atproto.com/specs/handle"
						target="_blank"
						rel="noopener noreferrer"
						class="help-link"
						title="learn about ATProto handles"
					>
						what's this?
					</a>
				</div>
				<input
					id="handle"
					type="text"
					bind:value={handle}
					placeholder="yourname.bsky.social"
					disabled={loading}
					required
				/>
				<p class="input-help">
					don't have one?
					<a href="https://bsky.app" target="_blank" rel="noopener noreferrer">create a free Bluesky account</a>
					to get your ATProto identity
				</p>
			</div>

			<button type="submit" disabled={loading || !handle.trim()}>
				{loading ? 'redirecting...' : 'sign in with atproto'}
			</button>
		</form>
	</div>
</div>

<style>
	.container {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #0a0a0a;
		padding: 1rem;
	}

	.login-card {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		padding: 3rem;
		max-width: 400px;
		width: 100%;
	}

	h1 {
		font-size: 2.5rem;
		margin: 0 0 0.5rem 0;
		color: #fff;
		text-align: center;
	}

	p {
		color: #888;
		text-align: center;
		margin: 0 0 2rem 0;
		font-size: 0.95rem;
	}

	.input-group {
		margin-bottom: 1.5rem;
	}

	.label-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	label {
		color: #aaa;
		font-size: 0.9rem;
	}

	.help-link {
		color: var(--accent);
		text-decoration: none;
		font-size: 0.85rem;
		transition: color 0.2s;
	}

	.help-link:hover {
		color: var(--accent-hover);
		text-decoration: underline;
	}

	input {
		width: 100%;
		padding: 0.75rem;
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 4px;
		color: white;
		font-size: 1rem;
		font-family: inherit;
		transition: all 0.2s;
		box-sizing: border-box;
	}

	input:focus {
		outline: none;
		border-color: #3a7dff;
	}

	input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	input::placeholder {
		color: #666;
	}

	.input-help {
		margin: 0.5rem 0 0 0;
		font-size: 0.85rem;
		color: #888;
	}

	.input-help a {
		color: var(--accent);
		text-decoration: none;
		transition: color 0.2s;
	}

	.input-help a:hover {
		color: var(--accent-hover);
		text-decoration: underline;
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
		font-family: inherit;
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
