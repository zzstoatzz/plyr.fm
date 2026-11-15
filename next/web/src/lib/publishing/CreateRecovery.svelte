<script lang="ts">
  import { albumIdFromUri, playlistIdFromUri, trackIdFromUri } from '$core/api';
  import type { CreateOperation } from '$core/publishing/create-operation';
  import type { CreateResult } from '$core/publishing/create-record';
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
        await pds.dismissCreate(operation, known?.state === 'different');
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
    {#if known?.state === 'accepted'}saved to your account.
    {:else if known?.state === 'different'}a different record is already at this address.
    {:else if known?.state === 'missing'}your account has no record at this address yet.
    {:else if operation.archived}earlier attempt. the {kind} might still appear.
    {:else}this {kind} still needs confirmation.{/if}
  </p>
  {#if problem}<p role="alert">{problem}</p>{/if}
  <button class="text-button" disabled={busy} onclick={() => run('check')}>check creation</button>
  {#if known?.state === 'accepted' || known?.state === 'different'}
    {#if known.state === 'accepted'}<a class="text-button" href={view()}>view {kind}</a>{/if}
    <button class="text-button" disabled={busy} onclick={() => run('dismiss')}>{known.state === 'accepted' ? 'done with creation' : 'keep existing record'}</button>
  {:else}
    <button class="text-button" disabled={busy} onclick={() => run('retry')}>resume creation</button>
    {#if !operation.archived}<button class="text-button" disabled={busy} onclick={() => run('archive')}>set aside creation</button>{/if}
  {/if}
</div>

<style>
  .recovery-card { background: var(--surface); border: 1px solid var(--line); border-radius: 0.75rem; padding: 0.9rem; }
  p { margin-block: 0.4rem; }
  h3 { font-size: 1rem; overflow-wrap: anywhere; }
</style>
