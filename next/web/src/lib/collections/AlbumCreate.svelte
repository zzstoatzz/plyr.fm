<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount, untrack } from 'svelte';
  import { albumIdFromUri, type Track } from '@plyr/next-core/api';
  import { auth } from '$lib/auth';
  import EditorPanel from '$lib/catalog/EditorPanel.svelte';
  import { createPds } from '$lib/pds';
  import AlbumTrackPicker from './AlbumTrackPicker.svelte';
  import CollectionJournal from './CollectionJournal.svelte';
  import { collectionJournal } from './CollectionJournal.svelte.ts';
  import OrderRows from './OrderRows.svelte';

  let { account }: { account: ReturnType<typeof auth.getAuth> & { did: string } } = $props();
  const pds = untrack(() => createPds(account));
  const organization = untrack(() => pds.albumOrganization());
  let live = false;
  const current = () => live && auth.getAuth().rpc === account.rpc;
  const journal = collectionJournal(pds, current);
  let name = $state('');
  let entries = $state.raw<Track[]>([]);
  let selected = $derived(new Set(entries.map(track => track.record.uri)));
  let error = $state('');
  let busy = $state(false);
  let blocked = $derived(busy || journal.view.loading || !!journal.view.error || journal.view.operations.some(operation => !operation.archived));

  onMount(() => {
    live = true;
    void journal.refresh();
    return () => { live = false; };
  });

  function move(from: number, to: number) {
    const next = [...entries];
    [next[from], next[to]] = [next[to], next[from]];
    entries = next;
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (blocked || !name.trim() || !entries.length || !current()) return;
    busy = true;
    error = '';
    try {
      const result = await organization.create(name, entries);
      if (!current()) return;
      await journal.refresh();
      if (result.status === 'indexed' && current()) {
        const accepted = journal.view.operations.find(operation => operation.uri === result.uri && operation.cid);
        if (accepted) await pds.dismissCreate(accepted).catch(() => {});
        if (current()) await goto('/album/' + albumIdFromUri(result.uri));
      }
    } catch (failure) {
      if (current()) error = failure instanceof Error ? failure.message : 'could not create this album.';
      await journal.refresh();
    } finally { if (current()) busy = false; }
  }
</script>

<EditorPanel title="new album" close="/portal" {busy}>
  <CollectionJournal {...journal.view} pds={pds} refresh={journal.refresh} />
  <form onsubmit={create}>
    <label>album name <input bind:value={name} required maxlength="64" disabled={blocked} /></label>
    {#if entries.length}
      <OrderRows rows={entries.map(track => ({ key: track.record.uri, title: track.metadata.title }))} {move}
        remove={index => { entries = entries.filter((_, position) => position !== index); }} disabled={blocked} />
    {/if}
    {#if error}<p role="alert">{error}</p>{/if}
    <div class="editor-actions">
      <button type="submit" class="text-button editor-save" disabled={blocked || !name.trim() || !entries.length}>
        {busy ? 'creating…' : 'create album'}
      </button>
    </div>
  </form>
  <AlbumTrackPicker did={account.did} {selected} disabled={blocked || entries.length >= 500} add={track => { entries = [...entries, track]; }} />
</EditorPanel>
