<script lang="ts">
	import { onMount } from 'svelte';
	import { auth } from '$lib/auth';
	import Loading from '$lib/ui/Loading.svelte';
	import PrivateMusic from '$lib/PrivateMusic.svelte';

	let account = $state.raw(auth.getAuth());
	onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
</script>

<svelte:head><title>private music · plyr.fm</title></svelte:head>

<section class="page-content">
	<h1>private music</h1>
	{#if !account.ready}
		<Loading label="loading your account" inline />
	{:else if !account.did}
		<p class="state"><a href="/login?return_to=%2Fprivate">sign in</a> to hear your private tracks.</p>
	{:else}
		{#key account.agent}<PrivateMusic {account} />{/key}
	{/if}
</section>
