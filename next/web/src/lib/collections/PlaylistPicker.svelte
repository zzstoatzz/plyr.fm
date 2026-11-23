<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount, tick, untrack } from 'svelte';
  import { playlistIdFromUri, type ListSummary, type Track } from '@plyr/next-core/api';
  import { playlistAddNotice, playlistName, playlistTrackCount, type PlaylistAddStatus } from '@plyr/next-core/collections/playlist-add';
  import { auth } from '$lib/auth';
  import Loading from '$lib/ui/Loading.svelte';
  import { ownPlaylists } from './own-playlists';
  import { createPds } from '$lib/pds';
  import { toast } from '$lib/toast.svelte';
  import Artwork from '$lib/ui/Artwork.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import CollectionJournal from './CollectionJournal.svelte';
  import { collectionJournal } from './CollectionJournal.svelte.ts';

  let { account, track, done, busy = $bindable(false) }: { account: ReturnType<typeof auth.getAuth>; track: Track; done: () => void; busy?: boolean } = $props();
  const pds = untrack(() => createPds(account));
  let live = false;
  const current = () => live && auth.getAuth().rpc === account.rpc;
  const journal = collectionJournal(pds, current);
  let adding = $state<string>();
  let creating = $state(false);
  let name = $state('');
  let error = $state('');
  let input = $state<HTMLInputElement>();
  const blocked = $derived(journal.view.loading || !!journal.view.error || journal.view.operations.some(operation => !operation.archived));
  // The account's playlists live for the session: the picker opens on them, and its own adds and creates update them in place.
  const did = untrack(() => account.did);
  let lists = $state.raw(ownPlaylists.snapshot(did));
  onMount(() => {
    live = true;
    void journal.refresh();
    const stop = ownPlaylists.subscribe(() => { lists = ownPlaylists.snapshot(did); });
    if (did) ownPlaylists.open(did);
    lists = ownPlaylists.snapshot(did);
    return () => { live = false; stop(); };
  });

  function announce(label: string, status: PlaylistAddStatus, id: string, created = false) {
    const notice = playlistAddNotice(label, status, created);
    const open = { label: 'open', run: () => void goto(resolve('/(app)/playlist/[id]', { id })) };
    toast.add(notice.message, notice.tone, notice.tone === 'error' ? 4000 : 5000, notice.tone === 'error' ? undefined : open);
    done();
  }

  async function add(list: ListSummary) {
    if (!current() || busy) return;
    busy = true;
    adding = list.id;
    error = '';
    try {
      const status = await pds.addToPlaylist(list.record.uri, track);
      if (did && (status === 'indexed' || status === 'pending')) ownPlaylists.added(did, list.record.uri, track);
      if (current()) announce(playlistName(list), status, list.id);
    } catch (failure) {
      if (current()) error = failure instanceof Error ? failure.message : 'could not add this track. try again.';
    } finally { if (current()) { busy = false; adding = undefined; } }
  }

  async function startCreate() {
    creating = true;
    error = '';
    await tick();
    input?.focus();
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    const label = name.trim();
    if (!current() || busy || blocked || !label) return;
    busy = true;
    error = '';
    try {
      const result = await pds.createPlaylist(label, track);
      const made = () => { if (did && (result.status === 'indexed' || result.status === 'pending')) ownPlaylists.created(did, result.uri, label, track); };
      made();
      if (!current()) return;
      await journal.refresh();
      if (!current()) return;
      if (result.status !== 'indexed') return;
      const accepted = journal.view.operations.find(operation => operation.uri === result.uri && operation.cid);
      if (accepted) await pds.dismissCreate(accepted).catch(() => {});
      // Dismissing settles the record once more, which counts as a change; this one is already in the list.
      made();
      if (current()) announce(label, 'indexed', playlistIdFromUri(result.uri), true);
    } catch (failure) {
      if (!current()) return;
      // Keep the name so a retry is one tap.
      error = failure instanceof Error ? failure.message : 'could not create this playlist. try again.';
      await journal.refresh();
    } finally { if (current()) busy = false; }
  }
</script>

<div class="picker">
  {#if creating}
    <form class="create" onsubmit={create}>
      <input bind:this={input} bind:value={name} aria-label="playlist name" placeholder="playlist name" maxlength="64" required disabled={busy} autocomplete="off"
        onkeydown={event => { if (event.key === 'Escape' && !busy && !name) { event.preventDefault(); creating = false; } }} />
      <button type="submit" class="go" disabled={busy || blocked || !name.trim()}>{busy && !adding ? 'creating…' : 'create & add'}</button>
    </form>
  {:else}
    <button type="button" class="row new" disabled={busy || blocked} onclick={startCreate}>
      <span class="thumb"><Icon name="plus" size={20} /></span><span class="name">new playlist</span>
    </button>
  {/if}
  {#if !journal.view.loading && (journal.view.error || journal.view.operations.length)}
    <div class="journal"><CollectionJournal {...journal.view} {pds} refresh={journal.refresh} /></div>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <hr>
  <div class="lists">
    {#if lists.data.length}
      <ul aria-label="your playlists">
        {#each lists.data as list (list.id)}
          <li>
            <button type="button" class="row" disabled={busy} aria-busy={adding === list.id} aria-label={`${playlistName(list)}, ${playlistTrackCount(list)}`} onclick={() => add(list)}>
              <span class="thumb"><Artwork src={list.media?.artwork?.url} fallbackIcon="music" size={88} /></span>
              <span class="name"><span class="truncate">{playlistName(list)}</span><small>{playlistTrackCount(list)}</small></span>
              {#if adding === list.id}<span class="spin" aria-hidden="true"></span>{:else}<Icon name="plus" size={18} />{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if lists.error}
      <p class="state" role="alert">{lists.error}</p>
      <button type="button" class="text-button" onclick={() => did && ownPlaylists.retry(did)}>retry your playlists</button>
    {:else if lists.loading}
      <Loading label="loading your playlists" inline />
    {:else if !lists.data.length}
      <p class="state">no playlists yet. start one above.</p>
    {/if}
    {#if lists.cursor && !lists.loading && !lists.error}
      <button type="button" class="text-button" onclick={() => did && ownPlaylists.more(did)}>more playlists</button>
    {/if}
  </div>
</div>

<style>
  .picker { display: flex; flex-direction: column; min-height: 0; flex: 1; }
  .lists { overflow-y: auto; min-height: 0; flex: 1; overscroll-behavior: contain; }
  .lists :global(.state), .lists :global(.text-button), .journal, .error { margin-inline: 1.25rem; }
  ul { list-style: none; margin: 0; padding: 0; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 0.3rem 1.25rem; }
  .row { display: flex; align-items: center; gap: 0.8rem; width: 100%; min-height: 3.6rem; padding: 0.45rem 1.25rem; border: 0; background: none; color: var(--faint); text-align: start; }
  .row:hover:not(:disabled) { background: var(--hover); }
  .row:disabled { opacity: 0.6; }
  .thumb { width: 2.75rem; height: 2.75rem; flex: none; border-radius: 0.45rem; overflow: hidden; display: grid; place-items: center; background: var(--raised); }
  .name { flex: 1; min-width: 0; display: grid; color: var(--text); }
  small { color: var(--faint); font-size: var(--t-12-8); }
  .new .thumb { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
  .new .name { color: var(--accent); font-weight: 620; }
  .create { display: flex; gap: 0.5rem; padding: 0.45rem 1.25rem; }
  .create input { flex: 1; min-width: 0; height: 2.75rem; padding: 0 0.75rem; border: 1px solid var(--accent); border-radius: 0.6rem; background: var(--bg); }
  .go { flex: none; height: 2.75rem; padding: 0 0.95rem; border: 0; border-radius: 0.6rem; background: var(--accent); color: var(--on-accent); font-weight: 650; white-space: nowrap; }
  .error { color: var(--text); font-size: var(--t-14); padding: 0.3rem 0; }
  .spin { width: 1rem; height: 1rem; border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 2.4s; } }
</style>
