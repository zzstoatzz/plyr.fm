<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { resolve } from '$app/paths';
  import type { Track } from '@plyr/next-core/api';
  import { auth } from '$lib/auth';
  import LikeButton from '$lib/listening/LikeButton.svelte';
  import Loading from '$lib/ui/Loading.svelte';

  let { track, transport, compact = false }: { track: Track; transport: Snippet; compact?: boolean } = $props();
  let account = $state.raw(auth.getAuth());
  let picking = $state(false);
  onMount(() => auth.subscribe(() => { account = auth.getAuth(); picking = false; }));

</script>

<div class="actions" class:compact>
  <LikeButton {track} />
  {@render transport()}
</div>
{#if !compact && account.ready && account.rpc}
  <div class="actions">
    <button class="text-button" type="button" aria-expanded={picking} onclick={() => { picking = !picking; }}>add to playlist</button>
    {#if account.did === track.artist.did}<a class="text-button" href={resolve('/(app)/edit-track/[id]', { id: track.id })}>edit track</a>{/if}
  </div>
{/if}
{#if picking && account.did && account.rpc}
  {#key account.rpc}
    {#await import('./PlaylistPicker.svelte')}
      <Loading label="loading playlists" inline />
    {:then picker}
      <picker.default {account} {track} />
    {:catch}
      <p role="alert" class="state">could not open your playlists.</p>
    {/await}
  {/key}
{/if}

<style>
  .actions { display: flex; align-items: center; justify-content: center; gap: 0.5rem; flex-wrap: wrap; }
  .compact { justify-content: space-between; }
</style>
