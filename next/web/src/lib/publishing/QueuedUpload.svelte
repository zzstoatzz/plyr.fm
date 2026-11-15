<script lang="ts">
  import type { QueuedUploadDraft } from '@plyr/next-core/publishing/queued-upload-draft';
  import { canonicalAudioType } from '@plyr/next-core/publishing/upload-queue-model';
  import { coverImage } from '$lib/media/cover-image';
  import { queuedDrafts } from '$lib/storage/upload-storage';
  import { uploadQueue } from '$lib/upload';

  let { draft, refresh }: { draft: QueuedUploadDraft; refresh: () => Promise<void> } = $props();
  let audio = $state<File>();
  let cover = $state<File>();
  let busy = $state(false);
  let problem = $state('');

  function chooseAudio(file?: File) {
    audio = undefined;
    problem = '';
    if (!file) return;
    try {
      const type = canonicalAudioType(file);
      audio = file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
    } catch (failure) {
      problem = failure instanceof Error ? failure.message : 'could not open the audio file.';
    }
  }

  async function chooseCover(file?: File) {
    if (!file) return;
    busy = true;
    problem = '';
    try { cover = await coverImage(file); }
    catch { problem = 'could not open the cover. choose it again.'; }
    finally { busy = false; }
  }

  function resume() {
    if (!audio) return;
    try { uploadQueue.reattach(draft, audio, cover); }
    catch (failure) { problem = failure instanceof Error ? failure.message : 'could not resume the upload.'; }
  }

  async function discard() {
    busy = true;
    problem = '';
    try { await queuedDrafts.withLock(draft, () => queuedDrafts.take(draft)); await refresh(); }
    catch (failure) { problem = failure instanceof Error ? failure.message : 'could not discard the queued draft. try again.'; }
    finally { busy = false; }
  }
</script>

<div class="recovery-card">
  <h3>{draft.title}</h3>
  <p class="subtle">choose {draft.audio.name} to resume this upload.</p>
  <label>audio <input type="file" accept="audio/*,.aif,.aiff,.m4a,.mp3,.aac,.ogg,.opus,.wav,.flac,.webm" disabled={busy} onchange={event => chooseAudio(event.currentTarget.files?.[0])} /></label>
  {#if draft.coverName}
    <label>cover ({draft.coverName}) <input type="file" accept="image/*,.heic,.heif" disabled={busy} onchange={event => chooseCover(event.currentTarget.files?.[0])} /></label>
  {/if}
  {#if problem}<p role="alert">{problem}</p>{/if}
  <button class="text-button" disabled={busy || !audio || (!!draft.coverName && !cover)} onclick={resume}>resume queued upload</button>
  <button class="text-button" disabled={busy} onclick={discard}>discard queued draft</button>
</div>

<style>
  .recovery-card { background: var(--surface); border: 1px solid var(--line); border-radius: 0.75rem; padding: 0.9rem; }
  h3 { font-size: 1rem; overflow-wrap: anywhere; }
  p, label { margin-block: 0.4rem; overflow-wrap: anywhere; }
  label, input { display: block; max-width: 100%; }
  input { font-size: 1rem; }
</style>
