<script lang="ts">
  import type { Track } from '@plyr/next-core/api';
  import { isPrivateTrack } from '@plyr/next-core/track-access';
  import { api } from '$lib/api';
  import PagedListing from '$lib/catalog/PagedListing.svelte';

  let { did, selected, add, disabled }: { did: string; selected: Set<string>; add: (track: Track) => void; disabled: boolean } = $props();
</script>

<h3>your published tracks</h3>
<PagedListing load={cursor => api.tracks({ artist_did: did, limit: 30, cursor })} label="published tracks" empty="no published tracks yet.">
  {#snippet items(tracks: Track[])}
    <ul>
      {#each tracks.filter(track => !isPrivateTrack(track)) as track (track.record.uri)}
        <li>
          <span>{track.metadata.title}</span>
          <button class="text-button" type="button" disabled={disabled || selected.has(track.record.uri)} aria-label={`Add ${track.metadata.title}`} onclick={() => add(track)}>
            {selected.has(track.record.uri) ? 'added' : 'add'}
          </button>
        </li>
      {/each}
    </ul>
  {/snippet}
</PagedListing>

<style>
  h3 { margin-block: 1rem 0.35rem; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { display: flex; gap: 0.5rem; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--line); padding-block: 0.25rem; overflow-wrap: anywhere; }
</style>
