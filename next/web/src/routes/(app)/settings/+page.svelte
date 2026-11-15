<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { auth, logout } from '$lib/auth';
	import { activeUploadCount } from '$lib/upload-activity.svelte';

	let account = $state.raw(auth.getAuth());
	const uploading = $derived(activeUploadCount(account.did));
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
		<a class="text-button" href="/upload">{uploading === 0 ? 'upload' : uploading === 1 ? '1 upload in progress' : `${uploading} uploads in progress`}</a>
		<a class="text-button" href="/private">private music</a>
		<button type="button" class="text-button" onclick={signOut}>sign out</button>
	{:else if account.ready}
		<p class="state"><a href="/login?return_to=%2Fsettings">sign in</a> to see your account.</p>
	{/if}
	<a class="text-button" href={resolve('/(app)/stats')}>stats</a>
</section>
