<script lang="ts">
  import { resolve } from '$app/paths';
  import { auth } from '$lib/auth';
  import OwnerTrackUpload from './OwnerTrackUpload.svelte';
  import UploadForm from './UploadForm.svelte';

  let { account, onlyYou }: { account: ReturnType<typeof auth.getAuth>; onlyYou: boolean } = $props();
  let ownerBusy = $state(false);
  let openBusy = $state(false);
  let ownerVisited = $state(false);
  let audio = $state<File>();
  let title = $state('');
  let description = $state('');
  let tags = $state('');

  $effect(() => { if (onlyYou) ownerVisited = true; });
</script>

<div class="visibility">
  <span>who can listen?</span>
  <nav aria-label="Who can listen">
    {#if onlyYou}
      <a class="text-button" href={resolve('/(app)/upload')} aria-disabled={ownerBusy} onclick={event => { if (ownerBusy) event.preventDefault(); }}>everyone</a><span aria-current="page">only you</span>
    {:else}
      <span aria-current="page">everyone</span><a class="text-button" href={resolve('/upload?visibility=only-you')} aria-disabled={openBusy} onclick={event => { if (openBusy) event.preventDefault(); }}>only you</a>
    {/if}
  </nav>
</div>

<div hidden={onlyYou}><UploadForm {account} bind:submitting={openBusy} bind:audio bind:title bind:description bind:tags /></div>
{#if onlyYou || ownerVisited}
  <div hidden={!onlyYou}><OwnerTrackUpload {account} selected={onlyYou} bind:busy={ownerBusy} bind:audio bind:title bind:description bind:tags /></div>
{/if}

<style>
  .visibility { display: grid; gap: 0.35rem; }
  nav { display: flex; align-items: center; gap: 0.65rem; }
  nav span { background: var(--hover); border-radius: 0.55rem; padding: 0.65rem 0.8rem; }
</style>
