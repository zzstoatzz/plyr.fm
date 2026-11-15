<script lang="ts">
  import { onMount } from 'svelte';
  import type { ListSummary, Track } from '$core/api';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth';
  import PagedListing from '$lib/catalog/PagedListing.svelte';
  import TrackRow from '$lib/TrackRow.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import Loading from '$lib/ui/Loading.svelte';
  import ListCards from './ListCards.svelte';
  import PlaylistCreate from './PlaylistCreate.svelte';

  let { likesOnly = false }: { likesOnly?: boolean } = $props();
  let account = $state.raw(auth.getAuth());
  let wide = $state(false);
  let version = $state(0);

  const heading = $derived(likesOnly ? 'liked tracks' : 'library');

  onMount(() => {
    const media = matchMedia('(min-width: 900px)');
    const match = () => { wide = media.matches; };
    match();
    media.addEventListener('change', match);
    const stop = auth.subscribe(() => { account = auth.getAuth(); });
    return () => { media.removeEventListener('change', match); stop(); };
  });
</script>

<svelte:head><title>{heading} · plyr.fm</title></svelte:head>
<section class="page-content library">
  <header><h1>{heading}</h1><a class="icon-button" href="/settings" aria-label="Settings"><Icon name="settings" /></a></header>
  {#if !account.ready}
    <Loading label="loading account" inline />
  {:else if !account.did || !account.rpc}
    <p class="state">sign in to see your liked tracks and playlists.</p>
    <a class="text-button primary" href={'/login?' + new URLSearchParams({ return_to: likesOnly ? '/liked' : '/library' })}>sign in</a>
  {:else}
    {@const did = account.did}
    {#key account.rpc}
      {#if !likesOnly}
        <div class="actions">
          <PlaylistCreate {account} onCreated={() => { version++; }} />
          <a class="text-button" href="/playlists">browse playlists</a>
        </div>
      {/if}
      <div class="parts" class:overview={!likesOnly}>
        <section class="liked">
          {#if !likesOnly}<h2>liked tracks</h2>{/if}
          {#key likesOnly || wide}
            <PagedListing load={cursor => api.actorLikes(did, { limit: likesOnly ? 30 : wide ? 10 : 5, cursor })} label="liked tracks"
              empty="no liked tracks yet." more={likesOnly ? 'more liked tracks' : undefined}>
              {#snippet items(tracks: Track[])}
                {#each tracks as track (track.id)}<TrackRow {track} collection={tracks} label="liked tracks" />{/each}
              {/snippet}
            </PagedListing>
          {/key}
          {#if !likesOnly}<a class="text-button" href="/liked">see all liked tracks</a>{/if}
        </section>
        {#if !likesOnly}
          <section class="playlists">
            <h2>your playlists</h2>
            <PagedListing load={cursor => api.playlists({ owner_did: did, cursor, limit: 30 })} label="playlists"
              empty="no playlists yet." more="more playlists" {version}>
              {#snippet items(lists: ListSummary[])}<ListCards {lists} />{/snippet}
            </PagedListing>
          </section>
        {/if}
      </div>
    {/key}
  {/if}
</section>

<style>
  .library { max-width: 62rem; }
  header { display: flex; justify-content: space-between; align-items: start; }
  .primary { background: var(--accent); color: var(--on-accent); padding-inline: 1rem; border-radius: 2rem; }
  .primary:hover { background: var(--accent); filter: brightness(1.1); }
  .actions { display: flex; gap: 0.45rem; flex-wrap: wrap; align-items: center; margin: 1rem 0; }
  .parts { display: grid; gap: 1.8rem; }
  h2 { font-size: 1.2rem; margin-block: 0.65rem; }
  @media (min-width: 900px) { .overview .playlists { grid-row: 1; } }
</style>
