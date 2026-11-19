<script lang="ts">
  import { audioAccept } from '$lib/media/accept';
  import { onDestroy } from 'svelte';
  import { trackIdFromUri } from '@plyr/next-core/api';
  import type { UploadOperation } from '@plyr/next-core/publishing/upload-model';
  import { recoverUpload, type UploadRecoveryAction, type UploadRecoveryView } from '@plyr/next-core/publishing/upload-recovery';
  import { canonicalAudioType } from '@plyr/next-core/publishing/upload-queue-model';
  import { auth } from '$lib/auth';
  import type { createPds } from '$lib/pds';
  import { createUploadTransport, uploadQueue } from '$lib/upload';
  import { uploadStorage } from '$lib/storage/upload-storage';

  let { operation, account, pds, refresh }: {
    operation: UploadOperation;
    account: ReturnType<typeof auth.getAuth>;
    pds: ReturnType<typeof createPds>;
    refresh: () => Promise<void>;
  } = $props();

  let view = $state<UploadRecoveryView>({});
  let file = $state<File>();
  let controller = $state<AbortController>();
  let problem = $state('');
  let status = $derived(view.status);
  let complete = $derived(status?.state === 'complete' || status?.state === 'published');
  let allParts = $derived(status?.state === 'completing' || status?.state === 'processing' || (status && status.receivedParts.length === status.partCount));

  onDestroy(() => controller?.abort());

  async function run(action: UploadRecoveryAction) {
    if (controller) return;
    const abort = new AbortController();
    controller = abort;
    problem = '';
    const assertCurrent = () => {
      if (abort.signal.aborted || auth.getAuth().rpc !== account.rpc) throw new Error('account changed. resume from the original account.');
    };
    try {
      const disposition = await recoverUpload({
        operation, action, pds, storage: uploadStorage, assertCurrent,
        transport: createUploadTransport(account, operation, assertCurrent, abort.signal),
        update: patch => { view = { ...view, ...patch }; }
      });
      assertCurrent();
      if (disposition) uploadQueue.dismissRecovery(operation, disposition);
      await refresh();
    } catch (failure) {
      if (!abort.signal.aborted) problem = failure instanceof Error ? failure.message : 'upload stopped. check its status.';
    } finally { controller = undefined; }
  }

  function choose(picked?: File) {
    if (!picked) return;
    try {
      const type = canonicalAudioType(picked);
      file = picked.type === type ? picked : new File([picked], picked.name, { type, lastModified: picked.lastModified });
      problem = '';
    } catch (failure) {
      problem = failure instanceof Error ? failure.message : 'could not open the file.';
    }
  }

  function resume() {
    try {
      uploadQueue.continue(operation, allParts ? undefined : file);
      problem = '';
    } catch (failure) {
      problem = failure instanceof Error ? failure.message : 'could not resume this upload.';
    }
  }
</script>

<div class="recovery-card">
  <h3>{typeof operation.record.title === 'string' ? operation.record.title : operation.name}</h3>
  <p role="status" class="subtle">
    {#if controller}checking upload…
    {:else if status?.state === 'published'}track ready to play.
    {:else if complete}audio uploaded. check whether the track was saved.
    {:else if status?.state === 'processing'}{status.processingFailure === 'output_budget_exceeded' ? 'the mp3 needs more space than reserved. the original is kept.' : 'converting to mp3.'}
    {:else}you can resume this upload.{/if}
  </p>
  {#if problem || view.message}<p role="alert">{problem || view.message}</p>{/if}
  <button class="text-button" disabled={!!controller} onclick={() => run('check')}>check upload status</button>
  {#if status?.state === 'published'}
    <a class="text-button" href={`/track/${trackIdFromUri(operation.uri)}`}>view track</a>
    <button class="text-button" disabled={!!controller} onclick={() => run('done')}>done with upload</button>
  {:else if complete}
    {#if view.publication?.state === 'different'}
      <p>another track was saved instead.</p>
    {:else}
      <button class="text-button" disabled={!!controller} onclick={() => run(view.publication?.state === 'accepted' ? 'activate' : 'publish')}>
        {view.publication?.state === 'accepted' ? 'check if the track is ready' : 'publish this track'}
      </button>
    {/if}
    {#if !view.archived}<button class="text-button" disabled={!!controller} onclick={() => run('archive')}>set aside this attempt</button>{/if}
  {:else if status?.state === 'cancelled'}
    <button class="text-button" disabled={!!controller} onclick={() => run('done')}>done with upload</button>
  {:else}
    {#if !allParts}
      <label>reselect original audio <input type="file" accept={audioAccept()} disabled={!!controller} onchange={event => choose(event.currentTarget.files?.[0])} /></label>
    {/if}
    <button class="text-button" disabled={!!controller || (!allParts && !file)} onclick={resume}>resume upload</button>
    <button class="text-button" disabled={!!controller} onclick={() => run('cancel')}>cancel transfer</button>
  {/if}
</div>

<style>
  .recovery-card { background: var(--surface); border: 1px solid var(--line); border-radius: 0.75rem; padding: 0.9rem; }
  h3 { font-size: 1rem; overflow-wrap: anywhere; }
  p { margin-block: 0.4rem; }
  label, input { display: block; max-width: 100%; }
  input { margin-block: 0.4rem; font-size: 1rem; }
</style>
