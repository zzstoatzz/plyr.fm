<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { auth, logout } from '$lib/auth';

	let account = $state.raw(auth.getAuth());
	onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));

	async function signOut() {
		void logout();
		await goto('/');
	}
</script>

<svelte:head><title>settings · plyr.fm</title></svelte:head>

<section class="page-content">
	<h1>settings</h1>
	{#if account.did}
		<p class="state">{account.handle ? '@' + account.handle : account.did}</p>
		<p class="state">{account.accountSync ? 'your queue syncs across devices.' : 'your queue stays on this device.'}</p>
		{#if !account.accountSync}<a class="text-button" href="/login?return_to=%2Fsettings">set up queue sync</a>{/if}
		<a class="text-button" href="/portal">your music</a>
		<a class="text-button" href="/private">private music</a>
		<button type="button" class="text-button" onclick={signOut}>sign out</button>
	{:else if account.ready}
		<p class="state"><a href="/login?return_to=%2Fsettings">sign in</a> to see your account.</p>
	{/if}
</section>
