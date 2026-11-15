<script lang="ts">
  import type { CreateOperation } from '@plyr/next-core/publishing/create-operation';
  import type { createPds } from '$lib/pds';
  import CreateRecovery from '$lib/publishing/CreateRecovery.svelte';
  import Loading from '$lib/ui/Loading.svelte';

  let { operations, pds, refresh, loading, error }: {
    operations: CreateOperation[];
    pds: ReturnType<typeof createPds>;
    refresh: () => Promise<void>;
    loading: boolean;
    error: string;
  } = $props();

  const kind = (operation: CreateOperation) => operation.record.listType === 'album' ? 'album' : 'playlist';
</script>

{#if loading}<Loading label="checking earlier attempts" inline />{/if}
{#if error}
  <p class="state" role="alert">{error}</p>
  <button type="button" class="text-button" onclick={refresh}>retry recovery</button>
{/if}
{#each operations.filter(operation => !operation.archived) as operation (operation.rkey)}
  <CreateRecovery {operation} {pds} {refresh} kind={kind(operation)} />
{/each}
{#if operations.some(operation => operation.archived)}
  <details>
    <summary>earlier attempts</summary>
    {#each operations.filter(operation => operation.archived) as operation (operation.rkey)}
      <CreateRecovery {operation} {pds} {refresh} kind={kind(operation)} />
    {/each}
  </details>
{/if}
