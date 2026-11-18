<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { resolve } from '$app/paths';
  import type { Track } from '@plyr/next-core/api';
  import { downloadAllowed } from '@plyr/next-core/downloads/model';
  import { isPrivateTrack } from '@plyr/next-core/track-access';
  import { invalidateAll } from '$app/navigation';
  import { trackHref } from '$lib/tracks';
  import { auth } from '$lib/auth';
  import LikeButton from '$lib/listening/LikeButton.svelte';
  import Loading from '$lib/ui/Loading.svelte';

  let { track, transport, compact = false }: { track: Track; transport: Snippet; compact?: boolean } = $props();
  let account = $state.raw(auth.getAuth());
  let picking = $state(false);
  let downloading = $state(false);
  let access = $state(false);
  onMount(() => auth.subscribe(() => { account = auth.getAuth(); picking = false; downloading = false; access = false; }));
  const owner = $derived(!!account.rpc && account.did === track.artist.did);
  const downloadable = $derived(downloadAllowed(track));

</script>

<div class="actions" class:compact>
  <LikeButton {track} />
  {@render transport()}
</div>
{#if !compact && account.ready && (account.rpc || downloadable)}
  <div class="actions">
    {#if account.rpc}<button class="text-button" type="button" aria-expanded={picking} onclick={() => { picking = !picking; downloading = access = false; }}>add to playlist</button>{/if}
    {#if downloadable}<button class="text-button" type="button" aria-expanded={downloading} onclick={() => { downloading = !downloading; picking = access = false; }}>download</button>{/if}
    {#if owner}<a class="text-button" href={resolve('/(app)/edit-track/[id]', { id: track.id })}>edit track</a>{/if}
    {#if owner && !isPrivateTrack(track)}<button class="text-button" type="button" aria-expanded={access} onclick={() => { access = !access; picking = downloading = false; }}>who can listen</button>{/if}
  </div>
{/if}
{#if access && !compact}
  <div class="panel access">
    {#await import('$lib/access/AccessDialog.svelte')}
      <Loading label="loading who can listen" inline />
    {:then panel}
      <panel.default subject={{ noun: 'track', tracks: [track], skey: track.record.rkey }} returnTo={trackHref(track)} onchange={() => void invalidateAll()} />
    {:catch}
      <p role="alert" class="state">could not open who can listen. reload the page and try again.</p>
    {/await}
  </div>
{/if}
{#if downloading && !compact}
  <div class="panel">
    {#await import('$lib/downloads/DownloadPanel.svelte')}
      <Loading label="loading download" inline />
    {:then panel}
      <panel.default {track} />
    {:catch}
      <p role="alert" class="state">could not open downloads. reload the page and try again.</p>
    {/await}
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
  .panel { display: grid; justify-items: center; text-align: center; }
  .panel :global(.download) { justify-items: center; }
  .access { justify-items: stretch; text-align: start; width: min(28rem, 100%); margin-inline: auto; }
  .actions { display: flex; align-items: center; justify-content: center; gap: 0.5rem; flex-wrap: wrap; }
  .compact { justify-content: space-between; }
</style>
