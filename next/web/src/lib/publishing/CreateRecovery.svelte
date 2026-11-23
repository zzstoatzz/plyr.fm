<script lang="ts">
  import { albumIdFromUri, playlistIdFromUri, trackIdFromUri } from '@plyr/next-core/api';
  import type { CreateOperation } from '@plyr/next-core/publishing/create-operation';
  import type { CreateResult } from '@plyr/next-core/publishing/create-record';
  import { applyGenreTags } from '@plyr/next-core/publishing/genre-tags';
  import type { createPds } from '$lib/pds';

  let { operation, pds, kind, refresh }: {
    operation: CreateOperation;
    pds: ReturnType<typeof createPds>;
    kind: 'track' | 'playlist' | 'album';
    refresh: () => Promise<void>;
  } = $props();

  let result = $state<CreateResult>();
  const known = $derived(result ?? (operation.cid ? { state: 'accepted' as const, uri: operation.uri, cid: operation.cid } : undefined));
  let busy = $state(false);
  let problem = $state('');
  let label = $derived(kind === 'track' ? operation.record.title : operation.record.name);

  function view() {
    const id = kind === 'track' ? trackIdFromUri(operation.uri) : kind === 'album' ? albumIdFromUri(operation.uri) : playlistIdFromUri(operation.uri);
    return `/${kind}/${id}`;
  }

  async function run(action: 'check' | 'retry' | 'archive' | 'dismiss') {
    if (busy) return;
    busy = true;
    problem = '';
    try {
      if (action === 'archive') {
        await pds.archiveCreate(operation, true);
        await refresh();
      } else if (action === 'dismiss') {
        if (kind === 'track' && known?.state === 'accepted' && operation.addTo) {
          await pds.albumOrganization().appendUpload(operation.addTo, operation.uri).catch(() => { problem = 'the track is up, but could not add it to the album.'; });
        }
        await pds.dismissCreate(operation, known?.state === 'different');
        if (kind === 'track' && known?.state === 'accepted' && operation.autoTag) {
          void applyGenreTags(() => pds, operation.uri).catch(() => undefined);
        }
        await refresh();
      } else {
        result = await pds.recoverCreate(operation, action === 'retry');
      }
    } catch (failure) {
      problem = failure instanceof Error ? failure.message : 'could not confirm this creation.';
    } finally { busy = false; }
  }
</script>

<div class="recovery-card">
  <h3>{typeof label === 'string' ? label : kind}</h3>
  <p class="subtle" role="status">
    {#if known?.state === 'accepted'}saved.
    {:else if known?.state === 'different'}another {kind} was saved instead.
    {:else if known?.state === 'missing'}this {kind} hasn’t been saved yet.
    {:else if operation.archived}an earlier attempt might still finish.
    {:else}this {kind} may already be saved. check its status before trying again.{/if}
  </p>
  {#if problem}<p role="alert">{problem}</p>{/if}
  <button class="text-button" disabled={busy} onclick={() => run('check')}>check status</button>
  {#if known?.state === 'accepted' || known?.state === 'different'}
    {#if known.state === 'accepted'}<a class="text-button" href={view()}>view {kind}</a>{/if}
    <button class="text-button" disabled={busy} onclick={() => run('dismiss')}>{known.state === 'accepted' ? 'done' : `keep existing ${kind}`}</button>
  {:else}
    <button class="text-button" disabled={busy} onclick={() => run('retry')}>try saving again</button>
    {#if !operation.archived}<button class="text-button" disabled={busy} onclick={() => run('archive')}>set aside this attempt</button>{/if}
  {/if}
</div>

<style>
  .recovery-card { background: var(--surface); border: 1px solid var(--line); border-radius: 0.75rem; padding: 0.9rem; }
  p { margin-block: 0.4rem; }
  h3 { font-size: var(--t-16); overflow-wrap: anywhere; }
</style>
