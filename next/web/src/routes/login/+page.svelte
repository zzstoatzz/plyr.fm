<script lang="ts">
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import ScreenHeader from '$lib/ui/ScreenHeader.svelte';

	let handle = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = null;
		try {
			await auth.login(handle.trim().replace(/^@/, ''), page.url.searchParams.has('device-only'));
		} catch (err) {
			error = (err as Error).message;
			busy = false;
		}
	}
</script>

<ScreenHeader title="sign in" />
<div class="pad">
	<p class="lede">sign in with your atproto account (bluesky or any PDS).</p>
	<p class="muted small">
		your browser talks to your PDS directly: likes, playlists and uploads are written to your repo, and plyr.fm just
		reads them back.
	</p>
	{#if page.url.searchParams.has('device-only')}
	<p class="muted small">preferences will stay on this device for this sign-in.</p>
	{/if}
	<form onsubmit={submit}>
		<label class="field">
			<span>handle</span>
			<input bind:value={handle} placeholder="you.bsky.social" autocomplete="username" autocapitalize="none" spellcheck="false" required />
		</label>
		<button class="btn primary block lg" disabled={busy || !handle.trim()}>{busy ? 'redirecting…' : 'continue'}</button>
	</form>
	{#if error}<p class="error">{error}</p>{/if}
</div>

<style>
	.lede {
		font-size: var(--t-lg);
		font-weight: 600;
		margin: var(--s-sm) 0 var(--s-xs);
	}
	form {
		margin-top: var(--s-xl);
	}
</style>
