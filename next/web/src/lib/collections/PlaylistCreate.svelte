<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount, untrack, type Snippet } from 'svelte';
  import { playlistIdFromUri, type Track } from '@plyr/next-core/api';
  import { auth } from '$lib/auth';
  import { createPds } from '$lib/pds';
  import Icon from '$lib/ui/Icon.svelte';
  import CollectionJournal from './CollectionJournal.svelte';
  import { collectionJournal } from './CollectionJournal.svelte.ts';

  let { account, first, onCreated, trigger }: {
    account: ReturnType<typeof auth.getAuth>; first?: Track; onCreated?: () => void;
    /** draws the control that opens the dialog, in place of the default button */
    trigger?: Snippet<[{ open: () => void; disabled: boolean }]>;
  } = $props();
  const pds = untrack(() => createPds(account));
  let live = false;
  const current = () => live && auth.getAuth().rpc === account.rpc;
  const journal = collectionJournal(pds, current);
  let name = $state('');
  let dialog: HTMLDialogElement;
  let showing = $state(false);
  let busy = $state(false);
  let error = $state('');
  let blocked = $derived(journal.view.loading || !!journal.view.error || journal.view.operations.some(operation => !operation.archived));

  onMount(() => {
    live = true;
    void journal.refresh();
    return () => { live = false; };
  });

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (!current() || busy || blocked || !name.trim()) return;
    busy = true;
    error = '';
    try {
      const result = await pds.createPlaylist(name, first);
      if (!current()) return;
      dialog.close();
      name = '';
      await journal.refresh();
      if (result.status === 'indexed' && current()) {
        const accepted = journal.view.operations.find(operation => operation.uri === result.uri && operation.cid);
        if (accepted) await pds.dismissCreate(accepted).catch(() => {});
        if (!current()) return;
        onCreated?.();
        await goto('/playlist/' + playlistIdFromUri(result.uri));
      }
    } catch (failure) {
      if (current()) {
        error = failure instanceof Error ? failure.message : 'could not create this playlist.';
        await journal.refresh();
        if (current() && blocked) dialog.close();
      }
    } finally { if (current()) busy = false; }
  }
</script>

{#snippet button({ open, disabled }: { open: () => void; disabled: boolean })}
  <button type="button" class="text-button new" {disabled} onclick={open}><Icon name="plus" size={18} /> new playlist</button>
{/snippet}
{@render (trigger ?? button)({ open: () => { error = ''; dialog.showModal(); showing = true; }, disabled: blocked || busy })}
<CollectionJournal {...journal.view} pds={pds} refresh={journal.refresh} />
{#if error && !showing}<p class="state" role="alert">{error}</p>{/if}

<dialog bind:this={dialog} aria-labelledby="new-playlist-title" onclose={() => { showing = false; }} oncancel={event => { if (busy) event.preventDefault(); }}>
  <h2 id="new-playlist-title">new playlist</h2>
  <form onsubmit={create}>
    <label>playlist name <input bind:value={name} required maxlength="64" disabled={busy} /></label>
    {#if error}<p role="alert">{error}</p>{/if}
    <div>
      <button type="submit" class="text-button new" disabled={busy || !name.trim()}>{busy ? 'creating…' : 'create playlist'}</button>
      <button type="button" class="text-button" disabled={busy} onclick={() => dialog.close()}>cancel</button>
    </div>
  </form>
</dialog>

<style>
  .new { background: var(--accent); color: var(--on-accent); padding-inline: 0.8rem; }
  .new:hover { background: var(--accent); filter: brightness(1.1); }
  dialog { width: min(26rem, calc(100% - 2rem)); border: 1px solid var(--line); border-radius: 0.85rem; background: var(--surface); color: var(--text); padding: 1rem; }
  dialog::backdrop { background: rgb(0 0 0 / 0.55); }
  form, label { display: grid; gap: 0.65rem; margin-top: 0.6rem; }
  input { width: 100%; height: 2.8rem; padding: 0.6rem; border: 1px solid var(--line); border-radius: 0.45rem; background: var(--bg); }
</style>
