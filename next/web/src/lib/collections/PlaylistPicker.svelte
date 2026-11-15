<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { ListSummary, Track } from '@plyr/next-core/api';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth';
  import PagedListing from '$lib/catalog/PagedListing.svelte';
  import { createPds } from '$lib/pds';
  import PlaylistCreate from './PlaylistCreate.svelte';

  let { account, track }: { account: ReturnType<typeof auth.getAuth>; track: Track } = $props();
  const pds = untrack(() => createPds(account));
  let live = false;
  let busy = $state(false);
  let error = $state('');
  let feedback = $state('');
  const current = () => live && auth.getAuth().rpc === account.rpc;
  onMount(() => {
    live = true;
    return () => { live = false; };
  });

  async function add(list: ListSummary) {
    if (!current() || busy) return;
    busy = true;
    error = feedback = '';
    try {
      const status = await pds.addToPlaylist(list.record.uri, track);
      if (!current()) return;
      feedback = status === 'indexed' ? 'added to playlist.' : status === 'rejected' ?
        'saved to your account. the catalog could not apply it.' : 'saved to your account. the catalog is catching up.';
    } catch (failure) {
      if (current()) error = failure instanceof Error ? failure.message : 'could not add this track.';
    } finally { if (current()) busy = false; }
  }
</script>

<section aria-label="Add to a playlist">
  <PagedListing load={cursor => api.playlists({ owner_did: account.did ?? undefined, limit: 30, cursor })} label="playlists" empty="no playlists yet." more="more playlists">
    {#snippet items(lists: ListSummary[])}
      <ul>
        {#each lists as list (list.id)}
          <li><button class="text-button" type="button" disabled={busy} onclick={() => add(list)}>{list.metadata.name || 'untitled playlist'}</button></li>
        {/each}
      </ul>
    {/snippet}
  </PagedListing>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if feedback}<p role="status">{feedback}</p>{/if}
  <PlaylistCreate {account} first={track} />
</section>

<style>
  section { width: min(100%, 30rem); border: 1px solid var(--line); padding: 0.8rem; border-radius: 0.65rem; text-align: start; }
  ul { list-style: none; padding: 0; margin: 0 0 0.7rem; }
  li > button { width: 100%; justify-content: start; overflow-wrap: anywhere; }
</style>
