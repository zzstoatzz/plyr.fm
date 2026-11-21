<script lang="ts">
  import { onMount } from 'svelte';
  import { auth } from '$lib/auth';
  import CreatorPortal from '$lib/catalog/CreatorPortal.svelte';
  import Loading from '$lib/ui/Loading.svelte';

  let account = $state.raw(auth.getAuth());
  onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
</script>

<svelte:head><title>your uploads · plyr.fm</title></svelte:head>

<section class="page-content">
  {#if !account.ready}
    <Loading label="loading account" inline />
  {:else if account.did && account.rpc}
    {#key account.rpc}<CreatorPortal account={{ ...account, did: account.did, rpc: account.rpc }} />{/key}
  {:else}
    <h1>your uploads</h1>
    <p class="state">sign in to manage your uploads.</p>
    <a class="text-button sign-in" href="/login?return_to=%2Fportal">sign in</a>
  {/if}
</section>

<style>
  .sign-in { border: 1px solid var(--line); padding-inline: 1rem; border-radius: 2rem; }
</style>
