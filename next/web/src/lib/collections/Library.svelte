<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount, untrack } from 'svelte';
  import { catalogRevision, subscribeCatalogChanges } from '@plyr/next-core/catalog/changes';
  import type { ListSummary, Track } from '@plyr/next-core/api';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth';
  import PagedListing from '$lib/catalog/PagedListing.svelte';
  import TrackRow from '$lib/TrackRow.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import Loading from '$lib/ui/Loading.svelte';
  import { loadAll } from '@plyr/next-core/catalog/owned';
  import { loadTracks } from '$lib/catalog/portal';
  import PinnedCollection from './PinnedCollection.svelte';
  import PlaylistCreate from './PlaylistCreate.svelte';
  import PlaylistShelf from './PlaylistShelf.svelte';

  let { likesOnly = false }: { likesOnly?: boolean } = $props();
  let account = $state.raw(auth.getAuth());
  let version = $state(0);
  // what this account wrote elsewhere (a like on now playing, a playlist edited in a sheet) re-reads the lists in place
  let written = $state(0);
  // re-read only when that scope changed, not on every write of this account
  const revision = (scope: 'likes' | 'collections') => { written; return account.did ? catalogRevision(account.did, scope) : 0; };
  const likedVersion = $derived(revision('likes'));
  const listsVersion = $derived(revision('collections'));

  const heading = $derived(likesOnly ? 'liked tracks' : 'library');

  onMount(() => {
    return auth.subscribe(() => { account = auth.getAuth(); });
  });
  $effect(() => {
    const did = account.did;
    if (!did) return;
    return subscribeCatalogChanges(did, () => { written++; });
  });

  // the overview reads whole collections: the pinned tiles count, play and shuffle all of them
  type Read<T> = { did: string; items?: T[]; failed?: boolean };
  let liked = $state.raw<Read<Track>>({ did: '' });
  let uploads = $state.raw<Read<Track>>({ did: '' });
  let lists = $state.raw<Read<ListSummary>>({ did: '' });
  function read<T>(did: string, load: () => Promise<T[]>, set: (value: Read<T>) => void, keep: Read<T>) {
    // a re-read keeps what is drawn until the new copy lands
    if (keep.did !== did) set({ did });
    let live = true;
    load().then(items => { if (live) set({ did, items }); }, () => { if (live) set({ did, items: keep.did === did ? keep.items : undefined, failed: true }); });
    return () => { live = false; };
  }
  $effect(() => {
    const did = account.did;
    if (likesOnly || !did) return;
    likedVersion;
    return read(did, () => loadAll(cursor => api.actorLikes(did, { limit: 100, cursor })), value => { liked = value; }, untrack(() => liked));
  });
  $effect(() => {
    const did = account.did;
    if (likesOnly || !did) return;
    return read(did, () => loadTracks(did), value => { uploads = value; }, untrack(() => uploads));
  });
  $effect(() => {
    const did = account.did;
    if (likesOnly || !did) return;
    version; listsVersion;
    return read(did, () => loadAll(cursor => api.playlists({ owner_did: did, limit: 100, cursor })), value => { lists = value; }, untrack(() => lists));
  });
</script>

<svelte:head><title>{heading} · plyr.fm</title></svelte:head>
<section class="page-content library" class:overview={!likesOnly}>
  <header>
    <h1>{heading}</h1>
    {#if !likesOnly}
      <span class="links">
        {#if account.did}<a class="text-button" href="/playlists">browse playlists</a>{/if}
        <a class="icon-button queue-link" href={resolve('/(app)/queue')} aria-label="open queue"><Icon name="queue" /></a>
      </span>
    {/if}
  </header>
  {#if !account.ready}
    <Loading label="loading account" inline />
  {:else if !account.did || !account.rpc}
    <p class="state">sign in to see your {likesOnly ? 'liked tracks' : 'liked tracks and playlists'}.</p>
    <a class="text-button primary" href={'/login?' + new URLSearchParams({ return_to: likesOnly ? '/liked' : '/library' })}>sign in</a>
  {:else if likesOnly}
    {@const did = account.did}
    {#key account.rpc}
      <PagedListing load={cursor => api.actorLikes(did, { limit: 30, cursor })} label="liked tracks"
        empty="no liked tracks yet." more="more liked tracks" version={likedVersion}>
        {#snippet items(tracks: Track[])}
          {#each tracks as track (track.id)}<TrackRow {track} collection={tracks} label="liked tracks" />{/each}
        {/snippet}
      </PagedListing>
    {/key}
  {:else}
    {@const did = account.did}
    <div class="pinned">
      <PinnedCollection liked title="liked tracks" href="/liked" tracks={liked.did === did ? liked.items : undefined} failed={liked.did === did && liked.failed && !liked.items} />
      {#if uploads.did === did && uploads.items?.length}
        <PinnedCollection title="your uploads" href="/portal" tracks={uploads.items} />
      {/if}
    </div>
    <h2>playlists {#if lists.did === did && lists.items}<span class="count">{lists.items.length}</span>{/if}</h2>
    {#if lists.did === did && lists.failed && !lists.items}<p class="state" role="alert">could not load your playlists.</p>{/if}
    {#key account.rpc}
      <PlaylistShelf lists={lists.did === did ? lists.items ?? [] : []}>
        {#snippet first()}
          <PlaylistCreate {account} onCreated={() => { version++; }}>
            {#snippet trigger({ open, disabled })}
              <button type="button" class="new-card" {disabled} onclick={open}><span class="plus"><Icon name="plus" size={34} /></span><strong>new playlist</strong></button>
            {/snippet}
          </PlaylistCreate>
        {/snippet}
      </PlaylistShelf>
    {/key}
  {/if}
</section>

<style>
  .library { max-width: 62rem; }
  .overview { max-width: 118rem; margin-inline: 0; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
  h1 { margin: 0; }
  .links { display: flex; align-items: center; gap: 0.25rem; }
  @media (min-width: 721px) { .queue-link { display: none; } }
  .primary { background: var(--accent); color: var(--on-accent); padding-inline: 1rem; border-radius: 2rem; }
  .primary:hover { background: var(--accent); filter: brightness(1.1); }
  .pinned { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr)); gap: 1rem; margin-top: 1.4rem; }
  h2 { display: flex; align-items: baseline; gap: 0.5rem; font-size: 1.2rem; margin: 2rem 0 0.9rem; }
  .count { color: var(--faint); font-weight: 400; }
  .new-card { display: grid; gap: 0.3rem; width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; }
  .plus { display: grid; place-items: center; aspect-ratio: 1; margin-bottom: 0.35rem; border: 1.5px dashed var(--line); border-radius: 0.6rem; color: var(--faint); }
  @media (hover: hover) { .new-card:hover:not(:disabled) .plus { color: var(--accent); border-color: var(--accent); } }
  .new-card:focus-visible .plus { outline: 2px solid var(--accent); outline-offset: 2px; }
  .new-card:disabled { opacity: 0.5; }
  @media (max-width: 720px) { .pinned { gap: 0.7rem; } }
</style>
