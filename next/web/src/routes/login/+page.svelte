<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { auth, login } from '$lib/auth';
	import { returnPath } from '@plyr/next-core/return-path';
	import AccountInput from '$lib/AccountInput.svelte';

	let account = $state.raw(auth.getAuth());
	let handle = $state('');
	let busy = $state(false);
	let failure = $state('');
	const intent = $derived(returnPath(page.url.searchParams.get('return_to')));

	onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));

	async function submit(value: string, deviceOnly = page.url.searchParams.get('deviceOnly') === 'true') {
		const identifier = value.trim().replace(/^at:\/\//, '').replace(/^@/, '');
		if (!identifier || busy) return;
		handle = identifier;
		failure = '';
		busy = true;
		try { await login(identifier, deviceOnly, intent); }
		catch {
			failure = 'could not sign in. check your handle and try again.';
			busy = false;
		}
	}
</script>

<svelte:window onpageshow={event => { if (event.persisted) busy = false; }} />
<svelte:head><title>sign in · plyr.fm</title></svelte:head>

<section class="page-content login">
	<form onsubmit={event => { event.preventDefault(); void submit(handle); }}>
		<h1>sign in to plyr.fm</h1>
		<label for="account-handle">atmosphere account</label>
		<AccountInput bind:value={handle} disabled={busy} select={value => { void submit(value); }} />
		<p class="subtle hint">your handle from Bluesky, Blacksky, or another atmosphere app</p>
		{#if failure || account.error}<p class="failure" role="alert">{failure || account.error}</p>{/if}
		<button class="submit" type="submit" disabled={busy || !handle.trim()}>{busy ? 'redirecting…' : 'sign in'}</button>
		{#if account.scopeRejected}
			<button type="button" class="text-button" disabled={busy || !handle.trim()} onclick={() => submit(handle, true)}>sign in on this device</button>
		{/if}
	</form>
</section>

<style>
	.login { min-height: min(42rem, 85dvh); display: grid; align-items: center; }
	form { width: min(100%, 27rem); margin-inline: auto; display: grid; gap: 0.65rem; padding: clamp(1rem, 4vw, 1.65rem); background: var(--surface); border: 1px solid var(--line); border-radius: 0.9rem; }
	h1 { font-size: 1.55rem; margin-bottom: 0.5rem; }
	label { font-weight: 600; }
	.hint, .failure { font-size: 0.9rem; }
	.failure { color: var(--danger, #bd2727); }
	.submit { width: 100%; background: var(--accent); color: var(--on-accent); padding: 0.6rem; min-height: 2.75rem; border-radius: 0.55rem; border: 0; font-weight: 650; }
</style>
