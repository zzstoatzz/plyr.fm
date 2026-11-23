<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import { trackIdFromUri, type Track } from '@plyr/next-core/api';
  import { jobLine, uploadInProgress } from '@plyr/next-core/publishing/upload-queue-model';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth';
  import PlaylistSheet from '$lib/collections/PlaylistSheet.svelte';
  import { createPds } from '$lib/pds';
  import { toast } from '$lib/toast.svelte';
  import Artwork from '$lib/ui/Artwork.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import { uploadQueue } from '$lib/upload';
  import type { AlbumPick } from './AlbumChoice.svelte';

  // what you just sent, held on the page until you start another, with the next things people usually do
  let { account, jobId, title, cover, albums, joined, another }: {
    account: ReturnType<typeof auth.getAuth>; jobId: string; title: string; cover?: File; albums: AlbumPick[]; joined?: AlbumPick; another: () => void;
  } = $props();
  const pds = untrack(() => createPds(account));
  let job = $state.raw(uploadQueue.snapshot().find(item => item.id === jobId));
  let art = $state<string>();
  let added = $state<string[]>([]);
  let adding = $state<string>();
  let track = $state.raw<Track>();
  let opening = $state(false);
  let playlists = $state<PlaylistSheet>();
  const uri = $derived(job?.phase === 'done' ? job.uri : undefined);
  const href = $derived(uri ? resolve('/(app)/track/[id]', { id: trackIdFromUri(uri) }) : undefined);
  const working = $derived(!job || uploadInProgress(job.phase));
  // the album it was dropped onto stays offered only if joining it failed
  const offered = $derived(albums.filter(album => !added.includes(album.uri) && !(album.uri === joined?.uri && !job?.error)).slice(0, 3));

  onMount(() => {
    const stop = uploadQueue.subscribe(() => { job = uploadQueue.snapshot().find(item => item.id === jobId) ?? job; });
    return stop;
  });
  $effect(() => {
    const url = cover && URL.createObjectURL(cover);
    art = url;
    if (url) return () => URL.revokeObjectURL(url);
  });

  async function addTo(album: AlbumPick) {
    if (!uri || adding) return;
    adding = album.uri;
    try {
      await pds.albumOrganization().appendUpload(album.uri, uri);
      added = [...added, album.uri];
      toast.add(`added to ${album.name}`, 'success');
    } catch (failure) {
      toast.add(failure instanceof Error ? failure.message : `could not add it to ${album.name}.`, 'error');
    } finally { adding = undefined; }
  }

  async function openPlaylists() {
    if (!uri || opening) return;
    opening = true;
    try {
      // the listing catches up a moment after the record exists
      track ??= await api.track(trackIdFromUri(uri), { fresh: true });
      queueMicrotask(() => playlists?.show());
    } catch {
      toast.add('still getting it ready. try again in a moment.', 'info');
    } finally { opening = false; }
  }

  async function copy() {
    if (!href) return;
    try {
      await navigator.clipboard.writeText(new URL(href, location.origin).href);
      toast.add('link copied', 'success');
    } catch { toast.add('could not copy the link.', 'error'); }
  }
</script>

<section class="done" aria-live="polite">
  <div class="backdrop" aria-hidden="true">{#if art}<img src={art} alt="" />{/if}</div>
  <div class="art"><Artwork src={art} size={208} fallbackIcon="music" /></div>
  <div class="copy">
    {#if job?.phase === 'failed'}
      <h2>{title} didn't upload</h2>
      <p class="line">{jobLine(job)}. you can edit it and try again from the list above.</p>
    {:else if uri}
      <h2>{title} is up</h2>
      {#if job?.error}<p class="line">{job.error}.</p>{:else}<p class="line">{joined ? `on your profile and in ${joined.name}` : 'on your profile'}</p>{/if}
    {:else}
      <h2>{title}</h2>
      <p class="line" role="status">{job ? jobLine(job) : 'starting…'}</p>
    {/if}
    {#if uri}
      <div class="group">
        <span class="label">add it to</span>
        <div class="row">
          {#each offered as album (album.uri)}
            <button type="button" class="pill" disabled={!!adding} onclick={() => addTo(album)}>
              <span class="mini"><Artwork src={album.cover} size={22} fallbackIcon="disc" /></span>{adding === album.uri ? 'adding…' : album.name}
            </button>
          {/each}
          <button type="button" class="pill" disabled={opening} onclick={openPlaylists}><Icon name="plus" size={17} />{opening ? 'opening…' : 'a playlist'}</button>
        </div>
      </div>
    {/if}
    <div class="row">
      <button type="button" class="pill primary" onclick={another}><Icon name="upload" size={17} />upload another</button>
      {#if href}
        <a class="pill" href={href}>open</a>
        <button type="button" class="pill" onclick={copy}><Icon name="link" size={17} />copy link</button>
      {:else if working}
        <span class="hint">you can leave this page. the upload keeps going.</span>
      {/if}
    </div>
  </div>
</section>
{#if track}<PlaylistSheet bind:this={playlists} {track} />{/if}

<style>
  .done { position: relative; isolation: isolate; display: grid; grid-template-columns: 13rem minmax(0, 1fr); gap: 1.75rem; align-items: center; padding: 1.4rem; border-radius: 1.25rem; border: 1px solid var(--line); background: color-mix(in srgb, var(--surface) 86%, transparent); overflow: hidden; }
  .backdrop { position: absolute; z-index: -1; inset: 0; pointer-events: none; }
  .backdrop img { width: 100%; height: 100%; object-fit: cover; filter: blur(56px) saturate(1.25); transform: scale(1.4); opacity: 0.4; }
  .art { width: 13rem; aspect-ratio: 1; border-radius: 0.9rem; overflow: hidden; box-shadow: 0 1rem 2.4rem rgb(0 0 0 / 0.28); }
  .art :global(img) { width: 100%; height: 100%; object-fit: cover; }
  .copy { min-width: 0; display: grid; gap: 0.9rem; }
  h2 { font-size: clamp(1.6rem, 3.5vw, 2.2rem); letter-spacing: -0.03em; line-height: 1.1; overflow-wrap: anywhere; }
  .line { margin: -0.4rem 0 0; color: var(--muted); }
  .group { display: grid; gap: 0.5rem; }
  .label { color: var(--faint); font-size: var(--t-12-8); font-weight: 700; letter-spacing: 0.04em; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  .pill { display: inline-flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; max-width: 100%; padding: 0 1.1rem; border: 1px solid var(--line); border-radius: 999px; background: var(--raised); color: var(--text); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pill:hover:not(:disabled) { background: var(--hover); text-decoration: none; }
  .pill.primary { background: var(--accent); color: var(--on-accent); border-color: transparent; }
  .pill.primary:hover { filter: brightness(1.08); background: var(--accent); }
  .mini { width: 1.4rem; height: 1.4rem; flex: none; margin-left: -0.35rem; border-radius: 0.3rem; overflow: hidden; }
  .hint { color: var(--faint); font-size: var(--t-13-6); }
  @media (max-width: 720px) {
    .done { grid-template-columns: minmax(0, 1fr); justify-items: center; text-align: center; padding: 1.25rem 1rem; }
    .art { width: min(13rem, 60vw); }
    .copy { width: 100%; justify-items: center; }
    .row { justify-content: center; }
    .group { justify-items: center; }
  }
</style>
