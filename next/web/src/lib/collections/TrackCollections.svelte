<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import { resolve } from '$app/paths';
  import type { Track } from '@plyr/next-core/api';
  import { downloadAllowed } from '@plyr/next-core/downloads/model';
  import { isPrivateTrack } from '@plyr/next-core/track-access';
  import { invalidateAll } from '$app/navigation';
  import { trackHref } from '$lib/tracks';
  import { auth } from '$lib/auth';
  import LikeButton from '$lib/listening/LikeButton.svelte';
  import Likers from '$lib/listening/Likers.svelte';
  import TrackDownload from '$lib/downloads/TrackDownload.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import Loading from '$lib/ui/Loading.svelte';
  import PlaylistSheet from './PlaylistSheet.svelte';

  let { track, transport, compact = false }: { track: Track; transport: Snippet; compact?: boolean } = $props();
  let account = $state.raw(auth.getAuth());
  let picking = $state(false);
  let picker = $state<PlaylistSheet>();
  let downloader = $state<TrackDownload>();
  let downloading = $state(false);
  let access = $state(false);
  onMount(() => auth.subscribe(() => { account = auth.getAuth(); access = false; }));
  const owner = $derived(!!account.rpc && account.did === track.artist.did);
  const downloadable = $derived(downloadAllowed(track));
  const signIn = $derived(`${resolve('/(app)/login')}?${new URLSearchParams({ return_to: trackHref(track) })}`);
</script>

<div class="actions" class:compact>
  {#if compact}<span class="like"><LikeButton {track} count={false} /><Likers {track} icon={false} /></span>{:else}<LikeButton {track} />{/if}
  {@render transport()}
</div>
{#if !compact && account.ready}
  <div class="actions chips">
    {#if account.rpc}
      <button class="chip" type="button" onclick={async () => { picking = true; await tick(); picker?.show(); }}><Icon name="playlist_add" size={18} />add to playlist</button>
    {:else}
      <a class="chip" href={signIn}><Icon name="playlist_add" size={18} />add to playlist</a>
    {/if}
    {#if downloadable}
      <button class="chip" type="button" disabled={downloading} aria-busy={downloading} onclick={() => downloader?.start()}>
        {#if downloading}<span class="spin" aria-hidden="true"></span>preparing…{:else}<Icon name="download" size={18} />download{/if}
      </button>
    {/if}
    {#if owner}<a class="chip" href={resolve('/(app)/edit-track/[id]', { id: track.id })}><Icon name="edit" size={18} />edit track</a>{/if}
    {#if owner && !isPrivateTrack(track)}<button class="chip" type="button" aria-expanded={access} onclick={() => { access = !access; }}><Icon name="lock" size={18} />who can listen</button>{/if}
  </div>
  {#if downloadable}<TrackDownload bind:this={downloader} bind:busy={downloading} {track} />{/if}
  {#if picking}<PlaylistSheet bind:this={picker} {track} onclose={() => { picking = false; }} />{/if}
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

<style>
  .panel { display: grid; justify-items: center; text-align: center; }
  .access { justify-items: stretch; text-align: start; width: min(28rem, 100%); margin-inline: auto; }
  .actions { display: flex; align-items: center; justify-content: center; gap: 0.5rem; flex-wrap: wrap; }
  .compact { justify-content: space-between; }
  .like { display: inline-flex; align-items: center; }
  /* the count sits beside the heart, never under its tile, so each pixel belongs to one control */
  .like :global(.likers) { min-height: 2.75rem; padding-inline: 0.25rem; font-size: var(--t-13-6); }
  .like :global(.likers .glyph:hover) { text-decoration: underline; text-underline-offset: 0.2em; }
  .chip { display: inline-flex; align-items: center; gap: 0.45rem; min-height: 2.75rem; padding: 0 1rem; border: 1px solid var(--line); border-radius: 999px; background: none; color: var(--text); font-size: var(--t-14-4); white-space: nowrap; }
  .chip :global(svg) { color: var(--muted); }
  .chip:hover:not(:disabled) { background: var(--hover); text-decoration: none; }
  .chip:disabled { opacity: 1; color: var(--muted); }
  .spin { width: 1rem; height: 1rem; border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
