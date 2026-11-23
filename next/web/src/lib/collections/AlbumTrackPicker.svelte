<script lang="ts">
  import { onMount } from 'svelte';
  import type { Track } from '@plyr/next-core/api';
  import { facets, filterTracks, loadAll } from '@plyr/next-core/catalog/owned';
  import { isPrivateTrack } from '@plyr/next-core/track-access';
  import { api } from '$lib/api';
  import Loading from '$lib/ui/Loading.svelte';

  // your tracks by search or tag, never one long list to scroll
  let { did, selected, add, disabled }: { did: string; selected: Set<string>; add: (track: Track) => void; disabled: boolean } = $props();
  let all = $state.raw<Track[]>();
  let failed = $state(false);
  let query = $state('');
  let tag = $state<string>();
  const noLabel = () => '';
  const tags = $derived(all ? facets(all, noLabel).tags.slice(0, 8) : []);
  const searching = $derived(!!query.trim() || !!tag);
  const found = $derived(all && searching ? filterTracks(all, { query, sort: 'recent', tag }, noLabel).slice(0, 30) : []);

  onMount(() => {
    let live = true;
    loadAll(cursor => api.tracks({ artist_did: did, limit: 100, cursor }))
      .then(tracks => { if (live) all = tracks.filter(track => track.artist.did === did && !isPrivateTrack(track)); }, () => { if (live) failed = true; });
    return () => { live = false; };
  });
</script>

<h3>add tracks you've posted</h3>
<input type="search" bind:value={query} placeholder="find your tracks" aria-label="find your tracks" autocomplete="off" {disabled} />
{#if tags.length}
  <div class="chips">
    {#each tags as item (item.name)}
      <button type="button" class="chip" aria-pressed={tag === item.name} onclick={() => { tag = tag === item.name ? undefined : item.name; }}>{item.name} <small>{item.count}</small></button>
    {/each}
  </div>
{/if}
{#if failed}<p role="alert">could not load your tracks.</p>
{:else if !all}<Loading label="loading your tracks" inline />
{:else if searching}
  {#if found.length}
    <ul>
      {#each found as track (track.record.uri)}
        <li>
          <span>{track.metadata.title}</span>
          <button class="text-button" type="button" disabled={disabled || selected.has(track.record.uri)} aria-label={`Add ${track.metadata.title}`} onclick={() => add(track)}>
            {selected.has(track.record.uri) ? 'added' : 'add'}
          </button>
        </li>
      {/each}
    </ul>
  {:else}<p class="subtle">nothing matches.</p>{/if}
{/if}

<style>
  h3 { margin-block: 1rem 0.35rem; }
  input { width: 100%; min-height: 2.75rem; padding: 0 0.9rem; border-radius: 0.75rem; border: 1px solid var(--line); background: var(--surface); color: var(--text); font-size: max(16px, 1rem); }
  .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-block: 0.6rem; }
  .chip { min-height: 2rem; padding: 0 0.75rem; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--text); }
  .chip[aria-pressed='true'] { background: var(--text); color: var(--bg); border-color: var(--text); }
  .chip small { opacity: 0.7; }
  .subtle { color: var(--muted); }
  ul { list-style: none; padding: 0; margin: 0.5rem 0 0; }
  li { display: flex; gap: 0.5rem; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--line); padding-block: 0.25rem; overflow-wrap: anywhere; }
</style>
