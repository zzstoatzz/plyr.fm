<script module lang="ts">
  function editorLock(owner: string) {
    return `plyr-next-upload-editor/${owner}`;
  }

  function writeEditor<T>(owner: string, task: () => Promise<T>): Promise<T> {
    if (!navigator.locks) return task();
    return navigator.locks.request(editorLock(owner), { ifAvailable: true }, lock => {
      if (!lock) throw new Error('another upload is saving its draft.');
      return task();
    });
  }
</script>

<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { trackIdFromUri } from '@plyr/next-core/api';
  import type { CreateOperation } from '@plyr/next-core/publishing/create-operation';
  import { PUBLIC_AUDIO_FORMATS, type UploadOperation } from '@plyr/next-core/publishing/upload-model';
  import { draftInRecovery, type QueuedUploadDraft } from '@plyr/next-core/publishing/queued-upload-draft';
  import { jobLine, needsPlyrStorage, uploadInProgress } from '@plyr/next-core/publishing/upload-queue-model';
  import { normalizeTrackTags } from '@plyr/next-core/publishing/track-tags';
  import { creditName } from '@plyr/next-core/publishing/credit-name';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth';
  import { coverImage } from '$lib/media/cover-image';
  import { canonicalAudioFile } from '$lib/media/audio-file';
  import { createPds } from '$lib/pds';
  import { queuedDrafts, uploadStorage } from '$lib/storage/upload-storage';
  import { uploadQueue } from '$lib/upload';
  import Loading from '$lib/ui/Loading.svelte';
  import CreateRecovery from './CreateRecovery.svelte';
  import LargeUpload from './LargeUpload.svelte';
  import QueuedUpload from './QueuedUpload.svelte';

  let { account }: { account: ReturnType<typeof auth.getAuth> } = $props();

  const owner = untrack(() => account.did);
  const pds = untrack(() => createPds(account));
  const legacyDraftKey = `plyr-upload-draft:${owner}`;
  const draftKey = `${legacyDraftKey}:v2`;
  const consentKey = `plyr-storage-consent:${owner}`;
  const autoTagKey = `plyr-auto-tag:${owner}`;
  let live = false;
  let hydrated = $state(false);
  let profileName = $state<string>();
  let artist = $derived(profileName || account.handle || account.did || '');
  let audio = $state<File>();
  let cover = $state<File>();
  let coverPreview = $state<string>();
  let audioInput = $state<HTMLInputElement>();
  let coverInput = $state<HTMLInputElement>();
  let title = $state('');
  let autoTitle = $state('');
  let album = $state('');
  let description = $state('');
  let tags = $state('');
  let details = $state(false);
  let consent = $state(false);
  let autoTag = $state(false);
  let unlisted = $state(false);
  let editorDraft = $derived(JSON.stringify({ title, album, description, tags, autoTag, unlisted, named: !!title && title === autoTitle }));
  let reattach = $state(false);
  let imageBusy = $state(false);
  let imageVersion = 0;

  let audioProblem = $state('');
  let coverProblem = $state('');
  let formProblem = $state('');
  let draftProblem = $state('');
  let submitting = $state(false);
  let recoveryProblem = $state('');
  let queuedProblem = $state('');
  let loading = $state(true);
  let pending = $state.raw<CreateOperation[]>([]);
  let transfers = $state.raw<UploadOperation[]>([]);
  let drafts = $state.raw<QueuedUploadDraft[]>([]);
  let jobs = $state.raw(uploadQueue.snapshot());
  let active = $derived.by(() => { jobs; return uploadQueue.busy(); });
  let transfersToRecover = $derived(transfers.filter(operation => !active.uploadIds.has(operation.uploadId)));
  let draftsToRecover = $derived(drafts.filter(draft => !draftInRecovery(draft, pending, transfers) && !jobs.some(job => job.id === draft.id && !(draft.reservedRkey && job.phase === 'failed'))));
  let creationsToRecover = $derived(pending.filter(operation => !active.rkeys.has(operation.rkey) && !transfers.some(transfer => transfer.rkey === operation.rkey)));
  let creationBlocksUpload = $derived(creationsToRecover.some(operation => !operation.archived));
  let service = $derived(!!audio && needsPlyrStorage(audio));
  let tagProblem = $derived.by(() => {
    try { if (tags.trim()) normalizeTrackTags(tags.split('\n')); return ''; }
    catch (failure) { return message(failure, 'check the tags.'); }
  });

  function message(failure: unknown, fallback: string) {
    return failure instanceof Error ? failure.message : fallback;
  }

  function current() {
    return live && auth.getAuth().rpc === account.rpc;
  }

  function draftField(value: unknown, key: string) {
    if (!value || typeof value !== 'object') return '';
    const field = Object.entries(value).find(([name]) => name === key)?.[1];
    return typeof field === 'string' ? field : '';
  }

  function restoreEditor() {
    if (!current()) return;
    try {
      const legacy = localStorage.getItem(legacyDraftKey);
      const draft: unknown = JSON.parse(localStorage.getItem(draftKey) ?? legacy ?? 'null');
      if (legacy !== null) {
        if (localStorage.getItem(draftKey) === null) localStorage.setItem(draftKey, legacy);
        localStorage.removeItem(legacyDraftKey);
      }
      title = draftField(draft, 'title');
      if (draft && typeof draft === 'object' && 'named' in draft && draft.named === true) autoTitle = title;
      album = draftField(draft, 'album');
      description = draftField(draft, 'description');
      tags = draftField(draft, 'tags');
      unlisted = !!draft && typeof draft === 'object' && 'unlisted' in draft && draft.unlisted === true;
      details = !!(album || description || tags);
      reattach = !!(title || details);
      consent = localStorage.getItem(consentKey) === 'yes';
      autoTag = draft && typeof draft === 'object' && 'autoTag' in draft && typeof draft.autoTag === 'boolean'
        ? draft.autoTag
        : localStorage.getItem(autoTagKey) === 'yes';
    } catch { draftProblem = 'could not restore your draft on this device.'; }
    hydrated = true;
  }

  onMount(() => {
    live = true;
    if (owner && navigator.locks) void navigator.locks.request(editorLock(owner), restoreEditor).catch(restoreEditor);
    else restoreEditor();
    if (owner) void api.artist(owner).then(profile => { if (current()) profileName = creditName(profile.display_name); }, () => {});

    let finished = '';
    const unsubscribe = uploadQueue.subscribe(() => {
      jobs = uploadQueue.snapshot();
      const signature = jobs.filter(job => !uploadInProgress(job.phase)).map(job => job.id).join();
      if (signature !== finished) { finished = signature; void refresh(); }
    });
    void refresh();
    return () => { live = false; unsubscribe(); };
  });

  $effect(() => {
    if (!hydrated) return;
    try {
      if (title || album || description || tags) {
        localStorage.setItem(draftKey, editorDraft);
      } else localStorage.removeItem(draftKey);
      draftProblem = '';
    } catch { draftProblem = 'changes to this draft could not be saved on this device.'; }
    try {
      if (consent) localStorage.setItem(consentKey, 'yes');
      else localStorage.removeItem(consentKey);
      if (autoTag) localStorage.setItem(autoTagKey, 'yes');
      else localStorage.removeItem(autoTagKey);
    } catch {}
  });

  let refreshVersion = 0;
  async function refresh() {
    if (!owner || !current()) return;
    const version = ++refreshVersion;
    try {
      const [creates, uploads] = await Promise.all([pds.pendingCreates('track'), uploadStorage.load(owner), refreshDrafts()]);
      if (!current() || version !== refreshVersion) return;
      pending = creates;
      transfers = uploads;
      recoveryProblem = '';
    } catch {
      if (current() && version === refreshVersion) recoveryProblem = 'could not load upload recovery. try again.';
    } finally {
      if (current() && version === refreshVersion) loading = false;
    }
  }

  let draftVersion = 0;
  async function refreshDrafts() {
    if (!owner || !current()) return;
    const version = ++draftVersion;
    try {
      const saved = await queuedDrafts.load(owner);
      if (current() && version === draftVersion) {
        drafts = saved;
        queuedProblem = '';
      }
    } catch {
      if (current() && version === draftVersion) queuedProblem = 'could not load queued uploads. try again.';
    }
  }

  $effect(() => {
    const url = cover && URL.createObjectURL(cover);
    coverPreview = url;
    if (url) return () => URL.revokeObjectURL(url);
  });

  function pickAudio(file?: File) {
    audioProblem = '';
    formProblem = '';
    if (!file) return;
    try {
      audio = canonicalAudioFile(file);
      reattach = false;
      if (!title.trim() || title === autoTitle) {
        autoTitle = file.name.replace(/\.[^.]+$/, '').slice(0, 256);
        title = autoTitle;
      }
    } catch (failure) {
      if (audioInput) audioInput.value = '';
      audioProblem = message(failure, 'could not open the audio file.');
    }
  }

  async function pickCover(file?: File) {
    if (!file) return;
    const version = ++imageVersion;
    imageBusy = true;
    coverProblem = '';
    try {
      const image = await coverImage(file);
      if (current() && version === imageVersion) cover = image;
    } catch (failure) {
      if (current() && version === imageVersion) {
        if (coverInput) coverInput.value = '';
        coverProblem = message(failure, 'could not open the cover.');
      }
    } finally {
      if (current() && version === imageVersion) imageBusy = false;
    }
  }

  async function editAgain(id: string) {
    if (!owner || !hydrated || !current() || imageBusy) return;
    const input = await writeEditor(owner, () => uploadQueue.takeBack(id, input => {
      if (!current()) throw new Error('reopen the upload page to edit this draft.');
      const previous = localStorage.getItem(draftKey);
      const saved = JSON.stringify({ title: input.title, album: input.album, description: input.description, tags: input.tags?.join('\n'), autoTag: !!input.autoTag, unlisted: !!input.unlisted });
      localStorage.setItem(draftKey, saved);
      return () => {
        if (localStorage.getItem(draftKey) !== saved) return;
        if (previous === null) localStorage.removeItem(draftKey);
        else localStorage.setItem(draftKey, previous);
      };
    })).catch(failure => {
      if (current()) formProblem = message(failure, 'could not reopen the upload. try again.');
    });
    if (!current() || !input || !(input.file instanceof File)) return;
    audio = input.file;
    cover = input.artwork instanceof File ? input.artwork : undefined;
    title = input.title;
    autoTitle = '';
    album = input.album ?? '';
    description = input.description ?? '';
    tags = input.tags?.join('\n') ?? '';
    autoTag = !!input.autoTag;
    unlisted = !!input.unlisted;
    details = !!(album || description || tags);
    reattach = false;
    formProblem = '';
    audioProblem = '';
    coverProblem = '';
  }

  async function upload(event: SubmitEvent) {
    event.preventDefault();
    if (!owner || !hydrated || submitting || !current() || !audio || !title.trim() || !artist || tagProblem || imageBusy || loading || recoveryProblem || creationBlocksUpload || (service && (!consent || !account.uploadStorage))) return;
    submitting = true;
    const submittedDraft = editorDraft;
    const input = { file: audio, artwork: cover, title, artist, album, description, tags: tags.trim() ? tags.split('\n') : undefined, autoTag, unlisted };
    try {
      await writeEditor(owner, async () => {
        await uploadQueue.add(input);
        try {
          if (localStorage.getItem(draftKey) === submittedDraft) localStorage.removeItem(draftKey);
        } catch {
          if (current()) draftProblem = 'the upload was queued, but this device could not clear the editor draft.';
        }
      });
      if (!current()) return;
      audio = undefined;
      cover = undefined;
      if (audioInput) audioInput.value = '';
      if (coverInput) coverInput.value = '';
      title = autoTitle = album = description = tags = formProblem = audioProblem = coverProblem = '';
      details = false;
      unlisted = false;
    } catch (failure) {
      formProblem = message(failure, 'could not start the upload.');
    } finally { submitting = false; }
  }
</script>

{#if jobs.some(job => job.owner === owner)}
  <ul class="jobs" aria-label="Upload queue" aria-live="polite">
    {#each jobs.filter(job => job.owner === owner) as job (job.id)}
      <li>
        {jobLine(job)}
        {#if job.phase === 'done' && job.uri}<a class="text-button" href={`/track/${trackIdFromUri(job.uri)}`}>view track</a>{/if}
        {#if job.phase === 'failed' && uploadQueue.editable(job.id)}<button class="text-button" onclick={() => editAgain(job.id)} disabled={!hydrated || imageBusy || submitting}>edit and try again</button>{/if}
      </li>
    {/each}
  </ul>
{/if}
{#if queuedProblem}
  <p role="alert">{queuedProblem}</p>
  <button class="text-button" onclick={refreshDrafts}>retry queued uploads</button>
{/if}
{#each draftsToRecover as draft (draft.id)}
  <QueuedUpload {draft} refresh={refreshDrafts} />
{/each}

{#if loading}<Loading label="checking for earlier uploads" inline />{/if}
{#if recoveryProblem}
  <p role="alert">{recoveryProblem}</p>
  <button class="text-button" onclick={refresh}>retry recovery</button>
{/if}
{#each transfersToRecover as operation (operation.uploadId)}
  <LargeUpload {operation} {account} {pds} {refresh} />
{/each}
{#each creationsToRecover.filter(operation => !operation.archived) as operation (operation.rkey)}
  <CreateRecovery {operation} {pds} {refresh} kind="track" />
{/each}
{#if creationsToRecover.some(operation => operation.archived)}
  <details class="earlier">
    <summary>earlier upload attempts</summary>
    {#each creationsToRecover.filter(operation => operation.archived) as operation (operation.rkey)}
      <CreateRecovery {operation} {pds} {refresh} kind="track" />
    {/each}
  </details>
{/if}

<form onsubmit={upload} inert={!hydrated || submitting}>
  <div class="file-field">
    <strong>audio</strong>
    <span class="subtle">{PUBLIC_AUDIO_FORMATS.toLowerCase()} · up to 1.5 GiB</span>
    <div class="audio-selection">
      <button type="button" class="text-button" onclick={() => audioInput?.click()}>{audio ? 'change audio' : 'choose audio'}</button>
      {#if audio}<span>selected: {audio.name}</span>{/if}
    </div>
    <input type="file" aria-label="audio file" hidden accept="audio/*,.aif,.aiff,.m4a,.mp3,.aac,.ogg,.opus,.wav,.flac,.webm" bind:this={audioInput} onchange={event => pickAudio(event.currentTarget.files?.[0])} />
  </div>
  {#if audioProblem}<p role="alert">{audioProblem}</p>
  {:else if reattach && !audio}<p class="subtle">your draft is still here. choose the audio file again.</p>{/if}
  {#if service}
    <p class="subtle">plyr stores this file and makes an mp3 for playback when needed. playback and downloads are public.</p>
    <label class="check"><input type="checkbox" bind:checked={consent} /> use plyr storage</label>
    {#if !account.uploadStorage}
      <p>sign in again to allow plyr storage. what you typed stays here.</p>
      <a class="text-button" href="/login?return_to=%2Fupload">sign in again</a>
    {/if}
  {/if}

  <label>title <input bind:value={title} maxlength="256" required placeholder="track title" /></label>
  <label class="file-field">
    <strong>cover</strong>
    <span class="subtle">optional · any photo or image</span>
    <input type="file" accept="image/*,.heic,.heif" bind:this={coverInput} onchange={event => pickCover(event.currentTarget.files?.[0])} />
    {#if cover && !coverInput?.files?.length}<span>{cover.name}</span>{/if}
  </label>
  {#if imageBusy}<p role="status">preparing your cover…</p>{/if}
  {#if coverProblem}<p role="alert">{coverProblem}</p>{/if}
  {#if coverPreview}
    <div class="cover-preview">
      <img src={coverPreview} alt="selected cover preview" width="64" height="64" />
      <button type="button" class="text-button" disabled={imageBusy} onclick={() => { cover = undefined; if (coverInput) { coverInput.value = ''; coverInput.focus(); } }}>remove cover</button>
    </div>
  {/if}

  {#if details}
    <label>album <input bind:value={album} maxlength="256" placeholder="optional" /></label>
    <label>description <textarea bind:value={description} maxlength="5000" rows="3" placeholder="liner notes, credits…"></textarea></label>
    <label>tags <textarea bind:value={tags} rows="2" placeholder="one tag per line"></textarea></label>
    {#if tagProblem}<p role="alert">{tagProblem}</p>{/if}
  {:else}
    <button type="button" class="text-button" onclick={() => { details = true; }}>add album, description or tags</button>
  {/if}
  <label class="check"><input type="checkbox" bind:checked={unlisted} /> unlisted</label>
  {#if unlisted}<p class="subtle">people can play this track from its link. it stays out of home, search, and radio.</p>{/if}
  <label class="check"><input type="checkbox" bind:checked={autoTag} /> auto-tag with recommended genres</label>
  {#if draftProblem}<p role="alert">{draftProblem}</p>{/if}
  {#if formProblem}<p role="alert">{formProblem}</p>{/if}
  <button class="text-button submit" type="submit" disabled={submitting || !audio || !title.trim() || !artist || !!tagProblem || imageBusy || loading || !!recoveryProblem || creationBlocksUpload || (service && (!consent || !account.uploadStorage))}>upload</button>
  {#if artist}<p class="subtle">posts to your profile as {artist}. you can keep browsing while it uploads.</p>{/if}
</form>

<style>
  form { display: grid; gap: 1rem; padding: 1rem; background: var(--surface); border: 1px solid var(--line); border-radius: 0.8rem; }
  label { display: grid; gap: 0.45rem; }
  .check { display: flex; align-items: center; gap: 0.65rem; min-height: 2.75rem; }
  .check input { width: 1.15rem; height: 1.15rem; accent-color: var(--accent); }
  .cover-preview { display: flex; align-items: center; gap: 0.65rem; }
  .cover-preview img { border-radius: 0.45rem; object-fit: cover; }
  .audio-selection { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  .file-field { display: grid; gap: 0.45rem; padding: 0.9rem; border: 1px dashed var(--line); border-radius: 0.55rem; overflow-wrap: anywhere; }
  input:not([type='checkbox']), textarea { width: 100%; min-width: 0; border: 1px solid var(--line); padding: 0.6rem; border-radius: 0.5rem; background: var(--bg); color: inherit; }
  .text-button { justify-self: start; }
  .submit { background: var(--accent); color: var(--on-accent); padding-inline: 1rem; }
  .submit:hover { background: var(--accent); filter: brightness(1.12); }
  .jobs { margin: 0; padding: 0; list-style: none; }
  .jobs li { border-bottom: 1px solid var(--line); padding: 0.35rem 0; }
  summary { cursor: pointer; padding: 0.6rem 0; }
</style>
