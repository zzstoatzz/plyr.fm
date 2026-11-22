<script lang="ts">
  import { onMount } from 'svelte';
  import { auth } from '$lib/auth';
  import SellCard from '$lib/catalog/SellCard.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import Loading from '$lib/ui/Loading.svelte';

  let account = $state.raw(auth.getAuth());
  onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
</script>

<svelte:head><title>get paid · plyr.fm</title></svelte:head>

<section class="page-content get-paid">
  <header>
    <h1>get paid</h1>
    <a class="icon-button" href="/portal" aria-label="Close"><Icon name="x" /></a>
  </header>
  {#if !account.ready}
    <Loading label="loading account" inline />
  {:else if account.did}
    {#key account.did}<SellCard did={account.did} />{/key}
  {:else}
    <p class="state">sign in to choose where listeners can pay you.</p>
    <a class="text-button" href="/login?return_to=%2Fget-paid">sign in</a>
  {/if}
</section>

<style>
  .get-paid { max-width: 40rem; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0.5rem; }
  h1 { font-size: clamp(1.4rem, 4.5vw, 1.95rem); }
</style>
