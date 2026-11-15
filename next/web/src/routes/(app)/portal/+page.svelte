<script lang="ts">
  import { onMount } from 'svelte';
  import { auth } from '$lib/auth';
  import CreatorPortal from '$lib/catalog/CreatorPortal.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import Loading from '$lib/ui/Loading.svelte';

  let account = $state.raw(auth.getAuth());
  onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
</script>

<svelte:head><title>your music · plyr.fm</title></svelte:head>

<section class="page-content">
  {#if !account.ready}
    <Loading label="loading account" inline />
  {:else if account.did && account.rpc}
    {#key account.rpc}<CreatorPortal account={{ ...account, did: account.did, rpc: account.rpc }} />{/key}
  {:else}
    <div class="header">
      <h1>your music</h1>
      <a class="icon-button" href="/settings" aria-label="Settings"><Icon name="settings" /></a>
    </div>
    <p class="state">sign in to manage your music.</p>
    <a class="text-button sign-in" href="/login?return_to=%2Fportal">sign in</a>
  {/if}
</section>

<style>
  .header { display: flex; align-items: start; justify-content: space-between; }
  .sign-in { border: 1px solid var(--line); padding-inline: 1rem; border-radius: 2rem; }
</style>
