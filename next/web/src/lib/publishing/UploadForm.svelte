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
	import { audioAccept } from '$lib/media/accept';
  import { onMount, untrack, type Snippet } from 'svelte';
  import type { CreateOperation } from '@plyr/next-core/publishing/create-operation';
  import { PUBLIC_AUDIO_FORMATS, type UploadOperation } from '@plyr/next-core/publishing/upload-model';
  import { draftInRecovery, type QueuedUploadDraft } from '@plyr/next-core/publishing/queued-upload-draft';
  import { needsPlyrStorage, uploadInProgress } from '@plyr/next-core/publishing/upload-queue-model';
  import { normalizeTrackTags } from '@plyr/next-core/publishing/track-tags';
  import { creditName } from '@plyr/next-core/publishing/credit-name';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth';
  import { coverImage } from '$lib/media/cover-image';
  import { canonicalAudioFile } from '$lib/media/audio-file';
  import { clock, fileSize } from '$lib/media/format';
  import { createPds } from '$lib/pds';
  import { queuedDrafts, uploadStorage } from '$lib/storage/upload-storage';
  import { uploadQueue } from '$lib/upload';
  import Artwork from '$lib/ui/Artwork.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import Loading from '$lib/ui/Loading.svelte';
  import AudioPreview from './AudioPreview.svelte';
  import UploadDetails from './UploadDetails.svelte';
  import UploadJobs from './UploadJobs.svelte';
  import CreateRecovery from './CreateRecovery.svelte';
  import LargeUpload from './LargeUpload.svelte';
  import QueuedUpload from './QueuedUpload.svelte';

  let { account, submitting = $bindable(false), audio = $bindable(), title = $bindable(''), description = $bindable(''), tags = $bindable(''), visibility }: {
    account: ReturnType<typeof auth.getAuth>; submitting: boolean; audio: File | undefined; title: string; description: string; tags: string; visibility?: Snippet;
  } = $props();

  const owner = untrack(() => account.did);
  const pds = untrack(() => createPds(account));
  const draftKey = `plyr-upload-draft:${owner}`;
  const consentKey = `plyr-storage-consent:${owner}`;
  const autoTagKey = `plyr-auto-tag:${owner}`;
  let live = false;
  let hydrated = $state(false);
  let profileName = $state<string>();
  let profileAvatar = $state<string>();
  let duration = $state<number>();
  let dragging = $state(false);
  let artist = $derived(profileName || account.handle || account.did || '');
  let cover = $state<File>();
  let coverPreview = $state<string>();
  let audioInput = $state<HTMLInputElement>();
  let coverInput = $state<HTMLInputElement>();
  let autoTitle = $state('');
  let album = $state('');
  let consent = $state(false);
  let autoTag = $state(false);
  let editorDraft = $derived(JSON.stringify({ title, album, description, tags, autoTag, named: !!title && title === autoTitle }));
  let reattach = $state(false);
  let imageBusy = $state(false);
  let imageVersion = 0;

  let audioProblem = $state('');
  let coverProblem = $state('');
  let formProblem = $state('');
  let draftProblem = $state('');
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

  let editing = $derived(!!audio || !!cover || reattach || !!(title || album || description || tags));
  let blocked = $derived(submitting || !audio || !title.trim() || !artist || !!tagProblem || imageBusy || loading || !!recoveryProblem || creationBlocksUpload || (service && (!consent || !account.uploadStorage)));

  function isImage(file: File) {
    return file.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|gif|avif)$/i.test(file.name);
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    if (!hydrated || submitting) return;
    const files = [...(event.dataTransfer?.files ?? [])];
    const image = files.find(isImage);
    const sound = files.find(file => file !== image);
    if (sound) pickAudio(sound);
    if (image) void pickCover(image);
  }

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
      const draft: unknown = JSON.parse(localStorage.getItem(draftKey) ?? 'null');
      title = draftField(draft, 'title');
      if (draft && typeof draft === 'object' && 'named' in draft && draft.named === true) autoTitle = title;
      album = draftField(draft, 'album');
      description = draftField(draft, 'description');
      tags = draftField(draft, 'tags');
      reattach = !!(title || album || description || tags);
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
    if (owner) void api.artist(owner).then(profile => {
      if (!current()) return;
      profileName = creditName(profile.display_name);
      profileAvatar = profile.avatar_url ?? undefined;
    }, () => {});

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
      const saved = JSON.stringify({ title: input.title, album: input.album, description: input.description, tags: input.tags?.join('\n'), autoTag: !!input.autoTag });
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
    const input = { file: audio, artwork: cover, title, artist, album, description, tags: tags.trim() ? tags.split('\n') : undefined, autoTag };
    try {
      await writeEditor(owner, async () => {
        await uploadQueue.add(input);
        try {
          if (localStorage.getItem(draftKey) === submittedDraft) localStorage.removeItem(draftKey);
        } catch {
          if (current()) draftProblem = 'the upload was queued, but this device could not clear the editor draft.';
        }
      });
      if (!current() || audio !== input.file || cover !== input.artwork || editorDraft !== submittedDraft) return;
      audio = undefined;
      cover = undefined;
      if (audioInput) audioInput.value = '';
      if (coverInput) coverInput.value = '';
      title = autoTitle = album = description = tags = formProblem = audioProblem = coverProblem = '';
    } catch (failure) {
      formProblem = message(failure, 'could not start the upload.');
    } finally { submitting = false; }
  }
</script>

<UploadJobs jobs={jobs.filter(job => job.owner === owner)} disabled={!hydrated || imageBusy || submitting} edit={editAgain} />
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

<form
  onsubmit={upload}
  inert={!hydrated || submitting}
  class:dragging
  ondragover={event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragging = true; } }}
  ondragleave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dragging = false; }}
  ondrop={drop}
>
  <input type="file" aria-label="audio file" hidden accept={audioAccept()} bind:this={audioInput} onchange={event => pickAudio(event.currentTarget.files?.[0])} />
  <input type="file" aria-label="cover image" hidden accept="image/*,.heic,.heif" bind:this={coverInput} onchange={event => pickCover(event.currentTarget.files?.[0])} />

  {#if !editing}
    <div class="drop">
      <span class="drop-icon"><Icon name="wave" size={34} /></span>
      <h2><span class="wide">drop a track here</span><span class="narrow">choose a track</span></h2>
      <p class="subtle">the title comes from the file name. everything else is optional.</p>
      <button type="button" class="pill primary" onclick={() => audioInput?.click()}><Icon name="plus" size={18} />choose audio</button>
      <p class="formats">{PUBLIC_AUDIO_FORMATS.toLowerCase()} · up to 1.5 GB</p>
      {#if audioProblem}<p class="problem" role="alert">{audioProblem}</p>{/if}
      {#if artist}<p class="formats">posts to your profile as {artist}</p>{/if}
    </div>
  {:else}
    <header class="hero">
      <div class="backdrop" aria-hidden="true">{#if coverPreview}<img src={coverPreview} alt="" />{/if}</div>
      <div class="cover-slot">
        <button type="button" class="cover" class:empty={!coverPreview} disabled={imageBusy} onclick={() => coverInput?.click()} aria-label={cover ? 'change cover' : 'choose cover'}>
          {#if coverPreview}
            <img src={coverPreview} alt="selected cover preview" width="240" height="240" />
            <span class="cover-chip"><Icon name="image" size={15} />change cover</span>
          {:else}
            <span class="cover-empty">
              <Icon name="image" size={30} stroke={1.6} />
              <b>{imageBusy ? 'preparing your cover…' : 'add a cover'}</b>
              <small>optional · any photo or image</small>
            </span>
          {/if}
        </button>
        {#if cover}
          <button type="button" class="remove" disabled={imageBusy} aria-label="remove cover" onclick={() => { cover = undefined; if (coverInput) coverInput.value = ''; }}><Icon name="x" size={16} /></button>
        {/if}
        {#if imageBusy && coverPreview}<p class="cover-note" role="status">preparing your cover…</p>{/if}
        {#if coverProblem}<p class="problem cover-note" role="alert">{coverProblem}</p>{/if}
      </div>
      <div class="copy">
        <span class="kind">new track</span>
        <label class="title">
          <input bind:value={title} aria-label="title" maxlength="256" required placeholder="name this track" />
          <Icon name="edit" size={18} />
        </label>
        {#if artist}
          <p class="owner"><span class="avatar"><Artwork src={profileAvatar} size={24} fallbackIcon="user" /></span>posts to your profile as {artist}</p>
        {/if}
        <div class="meta">
          {#if audio}
            {#if duration}<span class="chip strong">{clock(duration)}</span>{/if}
            <span class="chip file" title={audio.name}>{audio.name} · {fileSize(audio.size)}</span>
            <button type="button" class="chip action" onclick={() => audioInput?.click()}><Icon name="wave" size={15} />change audio</button>
          {:else}
            <span class="chip">your draft is still here. choose the audio file again.</span>
            <button type="button" class="chip action" onclick={() => audioInput?.click()}><Icon name="wave" size={15} />choose audio</button>
          {/if}
        </div>
        {#if audioProblem}<p class="problem" role="alert">{audioProblem}</p>{/if}
        {#if audio}<AudioPreview file={audio} bind:duration />{/if}
        {#if service}
          <label class="consent">
            <input type="checkbox" bind:checked={consent} />
            <span><b>use plyr storage</b> plyr keeps the original file and makes an mp3 so it plays everywhere. playback and downloads are public.</span>
          </label>
          {#if !account.uploadStorage}
            <p class="problem">sign in again to allow plyr storage. what you typed stays here. <a href="/login?return_to=%2Fupload">sign in again</a></p>
          {/if}
        {/if}
      </div>
    </header>

    <UploadDetails bind:album bind:tags bind:description bind:autoTag {tagProblem} />
  {/if}

  {#if draftProblem}<p class="problem" role="alert">{draftProblem}</p>{/if}
  {#if formProblem}<p class="problem" role="alert">{formProblem}</p>{/if}
  <div class="bar">
    {@render visibility?.()}
    <span class="hint">{audio ? 'you can keep browsing while it uploads' : ''}</span>
    <button class="pill primary submit" type="submit" disabled={blocked}><Icon name="upload" size={18} />upload</button>
  </div>
</form>

<style>
  form { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; border-radius: 1.25rem; }
  form.dragging .drop, form.dragging .hero .cover { outline: 3px solid var(--accent); outline-offset: 4px; }
  .problem { color: light-dark(#a3271f, #ff8f87); font-size: 0.9rem; }
  .problem a { color: inherit; text-decoration: underline; }
  .pill { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; min-height: 2.75rem; padding: 0 1.35rem; border: 0; border-radius: 999px; background: var(--raised); font-weight: 700; }
  .pill.primary { background: var(--accent); color: var(--on-accent); }
  .pill.primary:hover:not(:disabled) { filter: brightness(1.08); }

  .drop { display: grid; justify-items: center; align-content: center; gap: 0.8rem; min-height: 22rem; padding: 2rem 1.25rem; text-align: center; border-radius: 1.25rem; border: 2px dashed color-mix(in srgb, var(--accent) 45%, var(--line)); background: radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 70%), var(--surface); }
  .drop-icon { width: 4.5rem; height: 4.5rem; display: grid; place-items: center; border-radius: 1.2rem; background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
  .drop h2 { font-size: clamp(1.5rem, 3vw, 2rem); letter-spacing: -0.02em; }
  .drop .narrow { display: none; }
  .formats { color: var(--faint); font-size: 0.85rem; }

  .hero { position: relative; isolation: isolate; display: flex; align-items: flex-end; gap: 2rem; padding-block: 0.5rem 1.5rem; }
  .backdrop { position: absolute; z-index: -1; inset: -3rem calc(-1 * clamp(1rem, 3vw, 2.25rem)) -2rem; overflow: hidden; pointer-events: none; mask-image: linear-gradient(to bottom, transparent, black 25%, black 45%, transparent); }
  .backdrop img { width: 100%; height: 100%; object-fit: cover; filter: blur(48px) saturate(1.2); transform: scale(1.3); opacity: 0.55; }
  .cover-slot { position: relative; flex: none; width: min(15rem, 38vw); display: grid; gap: 0.5rem; }
  .cover { position: relative; display: block; width: 100%; aspect-ratio: 1; padding: 0; overflow: hidden; border-radius: 0.75rem; border: 0; background: var(--raised); box-shadow: 0 1.1rem 2.5rem rgb(0 0 0 / 0.3); }
  .cover.empty { box-shadow: none; border: 2px dashed var(--line); background: var(--surface); }
  .cover.empty:hover { border-color: var(--accent); }
  .cover img { width: 100%; height: 100%; object-fit: cover; }
  .cover-chip { position: absolute; left: 0.6rem; bottom: 0.6rem; display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.35rem 0.7rem; border-radius: 999px; background: rgb(0 0 0 / 0.55); color: white; font-size: 0.8rem; font-weight: 700; backdrop-filter: blur(8px); }
  .cover-empty { height: 100%; display: grid; place-items: center; align-content: center; gap: 0.4rem; padding: 1rem; color: var(--faint); }
  .cover-empty b { color: var(--text); }
  .cover-empty small { font-size: 0.8rem; }
  .remove { position: absolute; top: 0.5rem; right: 0.5rem; width: 2rem; height: 2rem; display: grid; place-items: center; border: 0; border-radius: 50%; background: rgb(0 0 0 / 0.55); color: white; backdrop-filter: blur(8px); }
  .cover-note { font-size: 0.85rem; }
  .copy { flex: 1; min-width: 0; display: grid; gap: 0.6rem; }
  .copy > * { max-width: 100%; min-width: 0; }
  .kind { color: var(--faint); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
  .title { display: flex; align-items: center; gap: 0.5rem; border-bottom: 2px dashed color-mix(in srgb, var(--text) 25%, transparent); color: var(--faint); }
  .title:focus-within { border-bottom-color: var(--accent); border-bottom-style: solid; }
  .title input { flex: 1; min-width: 0; padding: 0.1rem 0; border: 0; outline: 0; background: none; color: var(--text); font-size: clamp(1.75rem, 4.5vw, 3.1rem); font-weight: 700; letter-spacing: -0.03em; line-height: 1.15; }
  .title input::placeholder { color: var(--faint); opacity: 0.7; }
  .owner { display: flex; align-items: center; gap: 0.5rem; color: var(--muted); }
  .avatar { width: 1.5rem; flex: none; border-radius: 50%; overflow: hidden; }
  .meta { display: flex; flex-wrap: wrap; gap: 0.45rem; }
  .chip { display: inline-flex; align-items: center; gap: 0.35rem; min-height: 2rem; max-width: 100%; padding: 0.3rem 0.8rem; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--raised) 85%, transparent); color: var(--muted); font-size: 0.85rem; }
  .chip.strong { color: var(--text); font-weight: 700; font-variant-numeric: tabular-nums; }
  .chip.file { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; line-height: 1.4rem; }
  .chip.action { color: var(--text); font-weight: 700; }
  .chip.action:hover { background: var(--hover); }
  .consent { display: flex; align-items: flex-start; gap: 0.7rem; padding: 0.75rem 0.9rem; border-radius: 0.75rem; background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(16px); color: var(--muted); font-size: 0.9rem; line-height: 1.4; cursor: pointer; }
  .consent b { color: var(--text); margin-right: 0.25rem; }
  .consent input { accent-color: var(--accent); }
  .consent input { width: 1.2rem; height: 1.2rem; flex: none; margin: 0.1rem 0 0; }


  .bar { position: sticky; bottom: calc(1rem + var(--bar-offset, 0px)); z-index: 3; display: flex; align-items: center; gap: 1rem; padding: 0.5rem 0.5rem 0.5rem 0.75rem; border-radius: 999px; background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(18px); box-shadow: 0 0.6rem 2rem rgb(0 0 0 / 0.14); }
  .hint { flex: 1; text-align: right; color: var(--faint); font-size: 0.85rem; }
  .submit { min-height: 3rem; padding: 0 1.75rem; font-size: 1.02rem; }

  summary { cursor: pointer; padding: 0.6rem 0; }

  @media (max-width: 720px) {
    .drop { min-height: 18rem; }
    .drop .wide { display: none; }
    .drop .narrow { display: inline; }
    .hero { flex-direction: column; align-items: center; text-align: center; gap: 1rem; padding-top: 0; }
    .backdrop { inset: -2rem -1rem -2rem; }
    .cover-slot { width: min(15rem, 56vw); }
    .copy { width: 100%; justify-items: center; }
    .title { width: 100%; }
    .title input { text-align: center; }
    .owner, .meta { justify-content: center; }
    .meta { width: 100%; }
    .copy :global(.preview) { width: 100%; }
    .consent { text-align: left; }
    .bar { gap: 0.5rem; padding: 0.4rem; }
    .hint { display: none; }
    .submit { flex: 1; min-width: 0; padding: 0 1rem; }
  }
</style>
