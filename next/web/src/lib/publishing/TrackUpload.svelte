<script lang="ts">
  import { resolve } from '$app/paths';
  import { auth } from '$lib/auth';
  import Icon from '$lib/ui/Icon.svelte';
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

{#snippet visibility()}
  <nav class="who" aria-label="Who can listen">
    {#if onlyYou}
      <a href={resolve('/(app)/upload')} aria-disabled={ownerBusy} onclick={event => { if (ownerBusy) event.preventDefault(); }}><Icon name="globe" size={16} />everyone</a>
      <span aria-current="page"><Icon name="lock" size={16} />only you</span>
    {:else}
      <span aria-current="page"><Icon name="globe" size={16} />everyone</span>
      <a href={resolve('/upload?visibility=only-you')} aria-disabled={openBusy} onclick={event => { if (openBusy) event.preventDefault(); }}><Icon name="lock" size={16} />only you</a>
    {/if}
  </nav>
{/snippet}

<div hidden={onlyYou}><UploadForm {account} {visibility} bind:submitting={openBusy} bind:audio bind:title bind:description bind:tags /></div>
{#if onlyYou || ownerVisited}
  <div hidden={!onlyYou}><OwnerTrackUpload {account} {visibility} selected={onlyYou} bind:busy={ownerBusy} bind:audio bind:title bind:description bind:tags /></div>
{/if}

<style>
  .who { display: inline-flex; flex: none; gap: 0.15rem; padding: 0.25rem; border-radius: 999px; background: var(--raised); border: 1px solid var(--line); }
  .who :is(a, span) { display: inline-flex; align-items: center; gap: 0.4rem; min-height: 2.5rem; padding: 0 0.95rem; border-radius: 999px; color: var(--muted); font-size: 0.9rem; font-weight: 600; white-space: nowrap; }
  .who a:hover { text-decoration: none; color: var(--text); }
  .who span { background: var(--surface); color: var(--text); box-shadow: 0 1px 3px rgb(0 0 0 / 0.14); }
  @media (max-width: 720px) { .who :is(a, span) { padding: 0 0.7rem; font-size: 0.85rem; } }
</style>
