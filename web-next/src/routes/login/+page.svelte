<script lang="ts">
	import { auth } from '$lib/auth.svelte';

	let handle = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = null;
		try {
			await auth.login(handle.trim().replace(/^@/, ''));
		} catch (err) {
			error = (err as Error).message;
			busy = false;
		}
	}
</script>

<h1>sign in</h1>
<p class="muted">
	sign in with your atproto account. your browser talks to your PDS directly: likes, playlists and
	uploads are written to your repo, and plyr.fm just reads them back.
</p>
<form onsubmit={submit}>
	<input bind:value={handle} placeholder="you.bsky.social" autocomplete="username" required />
	<button class="btn" disabled={busy}>{busy ? 'redirecting…' : 'continue'}</button>
</form>
{#if error}<p class="error">{error}</p>{/if}

<style>
	form {
		display: flex;
		gap: 0.5rem;
		margin-top: 1rem;
	}
	input {
		flex: 1;
		max-width: 320px;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--surface-3);
		background: var(--surface-2);
		color: var(--text);
		font: inherit;
	}
</style>
