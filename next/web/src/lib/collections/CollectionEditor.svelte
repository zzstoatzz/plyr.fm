<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount, tick, untrack } from 'svelte';
  import { trackIdFromUri, type AwaitStatus, type ListDetail, type Track } from '@plyr/next-core/api';
  import type { AlbumEntry } from '@plyr/next-core/collections/album-membership';
  import { CollectionOrderConflict, CollectionOrderUnconfirmed, type CollectionRevision } from '@plyr/next-core/collections/collection-order';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth';
  import { createPds } from '$lib/pds';
  import Loading from '$lib/ui/Loading.svelte';
  import AlbumCoverPicker from './AlbumCoverPicker.svelte';
  import AlbumTrackPicker from './AlbumTrackPicker.svelte';
  import OrderRows from './OrderRows.svelte';

  let { account, list, close, saved }: {
    account: ReturnType<typeof auth.getAuth>;
    list: ListDetail;
    close: () => void;
    saved: (revision: CollectionRevision, status: AwaitStatus, tracks: Track[]) => void;
  } = $props();

  const pds = untrack(() => createPds(account));
  const ordering = untrack(() => pds.collectionOrder(list.object));
  let live = false;
  let reader: AbortController | undefined;
  let revision = $state.raw<CollectionRevision>();
  let known = $state.raw<Track[]>([]);
  let entries = $state.raw<AlbumEntry[]>([]);
  let name = $state('');
  let artwork = $state<File>();
  let imagePending = $state(false);
  let loading = $state(true);
  let busy = $state(false);
  let conflict = $state(false);
  let finding = $state(false);
  let confirming = $state(false);
  let error = $state('');
  let deleted = $state(false);
  let notice = $state<HTMLParagraphElement>();
  let deleteButton = $state<HTMLButtonElement>();
  let cancelDeleteButton = $state<HTMLButtonElement>();
  const current = () => live && auth.getAuth().rpc === account.rpc;
  const selected = $derived(new Set(entries.flatMap(entry => {
    if (typeof entry !== 'number') return [entry.record.uri];
    const subject = revision?.value.items[entry]?.subject;
    return subject ? [subject.uri] : [];
  })));
  const trackVersions = $derived(new Map(known.map(track => [track.record.uri + '\0' + track.record.cid, track])));
  const rows = $derived(entries.map(entry => {
    if (typeof entry !== 'number') return { key: entry.record.uri, title: entry.metadata.title };
    const subject = revision?.value.items[entry]?.subject;
    const track = subject && trackVersions.get(subject.uri + '\0' + subject.cid);
    return { key: entry, title: track?.metadata.title || `unavailable track ${entry + 1}` };
  }));
  const changed = $derived(revision && (artwork || name.trim() !== (revision.value.name ?? '')
    || entries.length !== revision.value.items.length || entries.some((entry, index) => entry !== index)));

  onMount(() => {
    live = true;
    void load();
    return () => { live = false; reader?.abort(); };
  });

  async function load() {
    loading = true;
    artwork = undefined;
    imagePending = false;
    reader?.abort();
    const request = reader = new AbortController();
    error = '';
    try {
      const record = await ordering.read(list.record.uri);
      if (!current() || reader !== request) return;
      const displayed = list.members.flatMap(member => member.track ? [member.track] : []);
      const knownVersions = new Set(displayed.map(track => track.record.uri + '\0' + track.record.cid));
      const missing = [...new Set(record.value.items.flatMap(({ subject }) => knownVersions.has(subject.uri + '\0' + subject.cid) ? [] : [subject.uri]))];
      const resolved: Track[] = [];
      for (let offset = 0; offset < missing.length; offset += 100) {
        const result = await api.resolveTracks(missing.slice(offset, offset + 100).map(trackIdFromUri), request.signal).catch(() => undefined);
        if (!current() || request.signal.aborted) return;
        if (result) resolved.push(...result.data);
      }
      if (!current() || reader !== request) return;
      known = [...displayed, ...resolved];
      revision = record;
      entries = record.value.items.map((_, index) => index);
      name = typeof record.value.name === 'string' ? record.value.name : '';
      conflict = confirming = false;
    } catch (failure) {
      if (current() && reader === request) error = failure instanceof Error ? failure.message : 'could not load this collection.';
    } finally {
      if (current() && reader === request) loading = false;
    }
  }

  function move(from: number, to: number) {
    const next = [...entries];
    [next[from], next[to]] = [next[to], next[from]];
    entries = next;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!revision || !changed || busy || imagePending || conflict || confirming || !name.trim() || !current()) return;
    busy = true;
    error = '';
    try {
      const currentRevision = revision;
      const result = list.object === 'album' ? await pds.albumOrganization().save(currentRevision, entries, name.trim(), artwork) :
        await ordering.write(currentRevision, entries.flatMap(entry => typeof entry === 'number' ? [currentRevision.value.items[entry]] : []), name.trim());
      if (!current()) return;
      const additions = entries.filter((entry): entry is Track => typeof entry !== 'number');
      saved(result.revision, result.status, [...known, ...additions]);
    } catch (failure) {
      if (!current()) return;
      conflict = failure instanceof CollectionOrderConflict || failure instanceof CollectionOrderUnconfirmed;
      error = failure instanceof Error ? failure.message : 'could not save this collection.';
      if (conflict) { await tick(); if (current()) notice?.focus(); }
    } finally { if (current()) busy = false; }
  }

  async function confirmDeletion(show: boolean) {
    confirming = show;
    await tick();
    if (current()) (show ? cancelDeleteButton : deleteButton)?.focus();
  }

  async function deleteCollection() {
    if (!revision || busy || !confirming || !current()) return;
    busy = true;
    error = '';
    try {
      const status = await pds.deleteCollection(list.record.uri, list.object, revision.cid);
      if (!current()) return;
      deleted = true;
      if (status === 'deleted' || status === 'absent') await goto('/library', { replaceState: true });
    } catch (failure) {
      if (!current()) return;
      conflict = failure instanceof CollectionOrderConflict;
      error = failure instanceof CollectionOrderConflict ? failure.message : 'could not confirm deletion. try again.';
      if (conflict) { confirming = false; await tick(); if (current()) notice?.focus(); }
    } finally { if (current()) busy = false; }
  }
</script>

<section class="editing" aria-labelledby="edit-collection">
  <h2 id="edit-collection">edit {list.object}</h2>
  {#if loading}
    <Loading label={`loading ${list.object}`} inline />
  {:else if deleted}
    <p role="status">{list.object} deleted. the catalog is catching up.</p>
    <a class="text-button" href="/library">back to library</a>
  {:else if !revision}
    <p role="alert">{error}</p>
    <button type="button" class="text-button" onclick={load}>retry loading {list.object}</button>
  {:else}
    {#if error}<p role="alert" tabindex="-1" bind:this={notice}>{error}</p>{/if}
    {#if conflict}<button type="button" class="text-button" onclick={load}>{changed ? 'discard draft and reload' : 'reload latest ' + list.object}</button>{/if}
    <form onsubmit={save}>
      <label>{list.object} name <input bind:value={name} maxlength="64" required disabled={busy || confirming} /></label>
      {#if list.object === 'album'}
        <AlbumCoverPicker bind:file={artwork} bind:pending={imagePending} disabled={busy || conflict || confirming} editing />
      {/if}
      <OrderRows {rows} {move} remove={index => { entries = entries.filter((_, position) => position !== index); }} disabled={busy || conflict || confirming} />
      {#if confirming}
        <p>delete this {list.object}?{list.object === 'album' ? ' its songs will stay published.' : ''}</p>
        <div class="actions">
          <button type="button" class="text-button" disabled={busy} onclick={deleteCollection}>confirm delete</button>
          <button type="button" class="text-button" bind:this={cancelDeleteButton} disabled={busy} onclick={() => confirmDeletion(false)}>cancel delete</button>
        </div>
      {:else}
        <div class="actions">
          <button type="submit" class="text-button save" disabled={busy || imagePending || conflict || !changed || !name.trim()}>{busy ? 'saving…' : 'save changes'}</button>
          <button type="button" class="text-button" disabled={busy} onclick={close}>cancel</button>
          <button type="button" class="text-button" bind:this={deleteButton} disabled={busy || conflict} onclick={() => confirmDeletion(true)}>delete {list.object}</button>
          {#if list.object === 'album'}
            <button type="button" class="text-button" disabled={busy || conflict} onclick={() => { finding = !finding; }} aria-expanded={finding}>{finding ? 'hide published tracks' : 'add tracks'}</button>
          {/if}
        </div>
      {/if}
    </form>
    {#if finding && account.did}
      <AlbumTrackPicker did={account.did} {selected} disabled={busy || conflict || entries.length >= 500} add={track => { entries = [...entries, track]; }} />
    {/if}
  {/if}
  {#if loading || !revision}
    <button type="button" class="text-button" disabled={busy} onclick={close}>cancel</button>
  {/if}
</section>

<style>
  .editing { padding: 1rem; margin-bottom: 1rem; border: 1px solid var(--line); border-radius: 0.75rem; background: var(--surface); }
  form, label { display: grid; gap: 0.55rem; margin-top: 0.75rem; }
  input { width: 100%; padding: 0.55rem; border: 1px solid var(--line); border-radius: 0.45rem; background: var(--bg); }
  .actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .save { color: var(--on-accent); background: var(--accent); padding-inline: 0.85rem; }
  .save:hover { background: var(--accent); filter: brightness(1.1); }
</style>
