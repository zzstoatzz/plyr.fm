<script lang="ts">
	let handle = '';
	let loading = false;

	function startOAuth() {
		if (!handle.trim()) return;
		loading = true;
		// redirect to backend OAuth start endpoint
		window.location.href = `http://localhost:8000/auth/start?handle=${encodeURIComponent(handle)}`;
	}
</script>

<div class="container">
	<div class="login-card">
		<h1>relay</h1>
		<p>decentralized music streaming</p>

		<form on:submit|preventDefault={startOAuth}>
			<div class="input-group">
				<label for="handle">bluesky handle</label>
				<input
					id="handle"
					type="text"
					bind:value={handle}
					placeholder="yourname.bsky.social"
					disabled={loading}
					required
				/>
			</div>

			<button type="submit" disabled={loading || !handle.trim()}>
				{loading ? 'redirecting...' : 'login with bluesky'}
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
		background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
		padding: 1rem;
	}

	.login-card {
		background: #0f3460;
		border-radius: 12px;
		padding: 3rem;
		max-width: 400px;
		width: 100%;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
	}

	h1 {
		font-size: 2.5rem;
		margin: 0 0 0.5rem 0;
		color: #e94560;
		text-align: center;
	}

	p {
		color: rgba(255, 255, 255, 0.7);
		text-align: center;
		margin: 0 0 2rem 0;
	}

	.input-group {
		margin-bottom: 1.5rem;
	}

	label {
		display: block;
		color: rgba(255, 255, 255, 0.9);
		margin-bottom: 0.5rem;
		font-size: 0.9rem;
	}

	input {
		width: 100%;
		padding: 0.75rem;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 6px;
		color: white;
		font-size: 1rem;
		transition: all 0.2s;
	}

	input:focus {
		outline: none;
		border-color: #e94560;
		background: rgba(255, 255, 255, 0.08);
	}

	input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	input::placeholder {
		color: rgba(255, 255, 255, 0.3);
	}

	button {
		width: 100%;
		padding: 0.75rem;
		background: #e94560;
		color: white;
		border: none;
		border-radius: 6px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	button:hover:not(:disabled) {
		background: #d63651;
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(233, 69, 96, 0.3);
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
