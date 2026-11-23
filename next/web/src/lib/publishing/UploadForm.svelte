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
  import { onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { CreateOperation } from '@plyr/next-core/publishing/create-operation';
  import { PUBLIC_AUDIO_FORMATS, type UploadOperation } from '@plyr/next-core/publishing/upload-model';
  import { draftInRecovery, type QueuedUploadDraft } from '@plyr/next-core/publishing/queued-upload-draft';
  import { needsPlyrStorage, originalOnPds, uploadInProgress } from '@plyr/next-core/publishing/upload-queue-model';
  import { normalizeTrackTags } from '@plyr/next-core/publishing/track-tags';
  import { creditName } from '@plyr/next-core/publishing/credit-name';
  import { accessFromRules, accessProblem, accessRules, accessSummary, DEFAULT_OPTIONS, onlyYou, optionsFromInput, optionsInput, readAccessDraft, readUploadOptions, sellProblem, type AccessDraft, type UploadOptions } from '@plyr/next-core/publishing/upload-access';
  import { memberDid } from '@plyr/next-core/access/policy-read';
  import { MAX_AUDIO_BYTES, type FeaturedArtist } from '@plyr/next-core/pds';
  import { toast } from '$lib/toast.svelte';
  import AccessPicker from './AccessPicker.svelte';
  import PrivateUploads from './PrivateUploads.svelte';
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
  import AlbumChoice, { type AlbumPick } from './AlbumChoice.svelte';
  import UploadDone from './UploadDone.svelte';
  import UploadDetails from './UploadDetails.svelte';
  import UploadJobs from './UploadJobs.svelte';
  import CreateRecovery from './CreateRecovery.svelte';
  import LargeUpload from './LargeUpload.svelte';
  import QueuedUpload from './QueuedUpload.svelte';

  // several files at once become an album, which the page shows instead of this form
  let { account, startOnlyYou = false, onAlbum }: { account: ReturnType<typeof auth.getAuth>; startOnlyYou?: boolean; onAlbum?: (files: File[], cover?: File) => void } = $props();
  let submitting = $state(false);
  let audio = $state<File>();
  let cover = $state<File>();
  let title = $state('');
  let description = $state('');
  let tags = $state('');
  let features = $state<FeaturedArtist[]>([]);
  let explicit = $state(false);
  let options = $state<UploadOptions>({ ...DEFAULT_OPTIONS });
  let access = $state<AccessDraft>(untrack(() => startOnlyYou) ? { closed: true, ways: [] } : { closed: false, ways: [] });
  // each way's problem shows once a submit has tried, not while typing
  let checked = $state(false);
  let privateUploads = $state<PrivateUploads>();
  let privateBusy = $state(false);
  let privateBlocked = $state(false);

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
  let coverPreview = $state<string>();
  let audioInput = $state<HTMLInputElement>();
  let coverInput = $state<HTMLInputElement>();
  let autoTitle = $state('');
  let album = $state('');
  let albums = $state.raw<AlbumPick[]>([]);
  let target = $state<AlbumPick>();
  let savedTarget = '';
  let dropTarget = $state<string>();
  let pickInto: AlbumPick | undefined;
  let finished = $state<{ jobId: string; title: string; cover?: File; joined?: AlbumPick }>();
  let consent = $state(false);
  let autoTag = $state(false);
  let editorDraft = $derived(JSON.stringify({ title, album, albumUri: target?.uri, description, tags, autoTag, features, explicit, access, options, named: !!title && title === autoTitle }));
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
  let service = $derived(!!audio && needsPlyrStorage(audio, access.closed));
  // asked only when plyr.fm would hold the sole copy
  let soleCopy = $derived(service && !!audio && !originalOnPds(audio));
  let privateTrack = $derived(onlyYou(access));
  let summary = $derived(accessSummary(access));
  let tooLargeClosed = $derived(access.closed && !!audio && audio.size > MAX_AUDIO_BYTES);
  const signInAgain = '/login?return_to=%2Fupload';
  // a closed track needs this session to be allowed to close music and write who can listen
  let accessSignIn = $derived(!access.closed ? '' : privateTrack ? (account.privatePublishing ? '' : signInAgain) : (account.closing && account.policyEditing ? '' : signInAgain));
  let tagProblem = $derived.by(() => {
    try { if (tags.trim()) normalizeTrackTags(tags.split('\n')); return ''; }
    catch (failure) { return message(failure, 'check the tags.'); }
  });

  let editing = $derived(!!audio || !!cover || reattach || !!(title || album || description || tags || features.length));
  let blocked = $derived(submitting || privateBusy || !audio || !title.trim() || !artist || !!tagProblem || imageBusy || tooLargeClosed || !!accessSignIn || (!privateTrack && !!options.sell && !account.accountSync)
    || (privateTrack ? privateBlocked : (loading || !!recoveryProblem || creationBlocksUpload || (service && ((soleCopy && !consent) || !account.uploadStorage)))));

  function isImage(file: File) {
    return file.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|gif|avif)$/i.test(file.name);
  }

  function drop(event: DragEvent, into?: AlbumPick) {
    event.preventDefault();
    dragging = false;
    dropTarget = undefined;
    if (!hydrated || submitting) return;
    const files = [...(event.dataTransfer?.files ?? [])];
    const image = files.find(isImage);
    const sounds = files.filter(file => file !== image);
    if (sounds.length > 1 && !editing && !into && onAlbum) return onAlbum(sounds, image);
    if (sounds.length > 1 && into) { audioProblem = `add one track at a time to ${into.name}.`; return; }
    if (sounds[0]) { if (into) chooseAlbum(into); pickAudio(sounds[0]); }
    if (image) void pickCover(image);
  }

  // a tap on an album cover opens the same picker; every other opener clears it so a cancelled pick can't linger
  function openPicker(into?: AlbumPick) {
    pickInto = into;
    audioInput?.click();
  }

  function chooseFiles(input: HTMLInputElement) {
    const files = [...(input.files ?? [])];
    const into = pickInto;
    pickInto = undefined;
    if (files.length > 1 && !editing && !into && onAlbum) {
      input.value = '';
      return onAlbum(files);
    }
    if (files.length > 1 && into) {
      input.value = '';
      audioProblem = `add one track at a time to ${into.name}.`;
      return;
    }
    if (files[0] && into) chooseAlbum(into);
    pickAudio(files[0]);
  }

  function chooseAlbum(pick: AlbumPick) {
    target = pick;
    album = pick.name;
    finished = undefined;
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
      savedTarget = draftField(draft, 'albumUri');
      target = albums.find(pick => pick.uri === savedTarget);
      description = draftField(draft, 'description');
      tags = draftField(draft, 'tags');
      if (draft && typeof draft === 'object') {
        const saved = draft as Record<string, unknown>;
        features = Array.isArray(saved.features) ? saved.features.filter((item): item is FeaturedArtist => !!item && typeof item === 'object' && typeof item.did === 'string').slice(0, 10) : [];
        explicit = saved.explicit === true;
        options = readUploadOptions(saved.options);
        if ('access' in saved && !startOnlyYou) access = readAccessDraft(saved.access);
      }
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

    if (owner) void api.albums(owner, { limit: 50 }).then(page => {
      if (!current()) return;
      albums = page.data.map(item => ({ uri: item.record.uri, name: item.metadata.name ?? 'untitled album', cover: item.media?.artwork?.url ?? undefined, count: item.metrics.member_count }));
      target ??= albums.find(pick => pick.uri === savedTarget);
    }, () => {});

    let settled = '';
    const unsubscribe = uploadQueue.subscribe(() => {
      jobs = uploadQueue.snapshot();
      const signature = jobs.filter(job => !uploadInProgress(job.phase)).map(job => job.id).join();
      if (signature !== settled) { settled = signature; void refresh(); }
    });
    void refresh();
    return () => { live = false; unsubscribe(); };
  });

  $effect(() => {
    if (!hydrated) return;
    try {
      if (title || album || description || tags || features.length) {
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
      const saved = JSON.stringify({ title: input.title, album: input.album, albumUri: input.addTo, description: input.description, tags: input.tags?.join('\n'), autoTag: !!input.autoTag, features: input.features ?? [], explicit: !!input.explicit, access: accessFromRules(input.waysIn), options: optionsFromInput(input) });
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
    savedTarget = input.addTo ?? '';
    target = albums.find(pick => pick.uri === savedTarget);
    description = input.description ?? '';
    tags = input.tags?.join('\n') ?? '';
    autoTag = !!input.autoTag;
    features = input.features ?? [];
    explicit = !!input.explicit;
    access = accessFromRules(input.waysIn);
    options = optionsFromInput(input);
    reattach = false;
    formProblem = '';
    audioProblem = '';
    coverProblem = '';
  }

  function clearEditor() {
    audio = undefined;
    cover = undefined;
    if (audioInput) audioInput.value = '';
    if (coverInput) coverInput.value = '';
    title = autoTitle = album = description = tags = formProblem = audioProblem = coverProblem = '';
    target = undefined;
    features = [];
    explicit = false;
    options = { ...DEFAULT_OPTIONS };
    checked = false;
  }

  async function savePrivate() {
    if (!audio || !privateUploads) return;
    const submittedDraft = editorDraft;
    submitting = true;
    try {
      const saved = await privateUploads.save({ file: audio, artwork: cover, title, artist, description, tags: tags.split('\n') });
      if (!saved || !current()) return;
      try { if (localStorage.getItem(draftKey) === submittedDraft) localStorage.removeItem(draftKey); } catch {}
      clearEditor();
      toast.add('saved to your library. only you can play it.', 'success');
      await goto(resolve('/(app)/portal'));
    } catch (failure) {
      if (current()) formProblem = message(failure, 'could not save this track.');
    } finally { submitting = false; }
  }

  async function upload(event: SubmitEvent) {
    event.preventDefault();
    const problem = accessProblem(access) ?? (privateTrack ? undefined : sellProblem(options.sell));
    if (problem) { checked = true; formProblem = problem; document.getElementById('who-can-listen')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (!owner || !hydrated || !current() || blocked || !audio) return;
    formProblem = '';
    if (privateTrack) return savePrivate();
    submitting = true;
    const submittedDraft = editorDraft;
    // everything is read before handles resolve, so typing during the lookup can't change what was sent
    const joined = target && !access.closed ? target : undefined;
    const base = { file: audio, artwork: cover, title, artist, album, ...(joined ? { addTo: joined.uri } : {}), description, tags: tags.trim() ? tags.split('\n') : undefined, autoTag,
      ...(features.length ? { features: [...features] } : {}), ...(explicit ? { explicit: true } : {}), ...optionsInput($state.snapshot(options), access, service) };
    const submittedAccess = $state.snapshot(access);
    try {
      const waysIn = await accessRules(submittedAccess, memberDid);
      const input = { ...base, ...(waysIn.length ? { waysIn } : {}) };
      let jobId = '';
      await writeEditor(owner, async () => {
        jobId = await uploadQueue.add(input);
        try {
          if (localStorage.getItem(draftKey) === submittedDraft) localStorage.removeItem(draftKey);
        } catch {
          if (current()) draftProblem = 'the upload was queued, but this device could not clear the editor draft.';
        }
      });
      if (!current() || audio !== input.file || cover !== input.artwork || editorDraft !== submittedDraft) return;
      finished = { jobId, title: input.title.trim(), cover: input.artwork ?? undefined, joined };
      clearEditor();
    } catch (failure) {
      formProblem = message(failure, 'could not start the upload.');
    } finally { submitting = false; }
  }
</script>

<UploadJobs jobs={jobs.filter(job => job.owner === owner && (job.id !== finished?.jobId || job.phase === 'failed'))} disabled={!hydrated || imageBusy || submitting} edit={editAgain} />
<PrivateUploads bind:this={privateUploads} {account} bind:busy={privateBusy} bind:blocked={privateBlocked} />
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
  <input type="file" aria-label="audio file" hidden multiple={!editing && !!onAlbum} accept={audioAccept()} bind:this={audioInput} onchange={event => chooseFiles(event.currentTarget)} />
  <input type="file" aria-label="cover image" hidden accept="image/*,.heic,.heif" bind:this={coverInput} onchange={event => pickCover(event.currentTarget.files?.[0])} />

  {#if !editing && finished && owner}
    <UploadDone {account} jobId={finished.jobId} title={finished.title} cover={finished.cover} joined={finished.joined} {albums} another={() => { finished = undefined; }} />
  {:else if !editing}
    <div class="door">
      <span class="drop-icon"><Icon name="wave" size={34} /></span>
      <h2><span class="wide">drop audio here</span><span class="narrow">add audio</span></h2>
      <p class="subtle">{onAlbum ? 'one file makes a track. several make an album.' : 'the title comes from the file name. everything else is optional.'}</p>
      <button type="button" class="pill primary" onclick={() => openPicker()}><Icon name="plus" size={18} />choose audio</button>
      <p class="formats">{PUBLIC_AUDIO_FORMATS.toLowerCase()} · up to 1.5 GB each</p>
      {#if audioProblem}<p class="problem" role="alert">{audioProblem}</p>{/if}
      {#if artist}<p class="formats">posts to your profile as {artist}</p>{/if}
    </div>
    {#if albums.length && !privateTrack}
      <section class="shelf" aria-labelledby="add-to-album">
        <header><h2 id="add-to-album">add to an album</h2><span class="formats wide">drop onto a cover</span></header>
        <ul>
          {#each albums.slice(0, 11) as pick (pick.uri)}
            <li>
              <button type="button" class="album" class:hot={dropTarget === pick.uri} aria-label="add a track to {pick.name}"
                onclick={() => openPicker(pick)}
                ondragover={event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); dragging = false; dropTarget = pick.uri; } }}
                ondragleave={() => { if (dropTarget === pick.uri) dropTarget = undefined; }}
                ondrop={event => { event.stopPropagation(); drop(event, pick); }}>
                <span class="art"><Artwork src={pick.cover} size={176} fallbackIcon="disc" />{#if dropTarget === pick.uri}<span class="into">add to {pick.name}</span>{/if}</span>
                <b>{pick.name}</b>
                <small>{pick.count} {pick.count === 1 ? 'track' : 'tracks'}</small>
              </button>
            </li>
          {/each}
          {#if albums.length > 11}<li><a class="album all" href={resolve('/(app)/library')}><span class="art"><span>all albums</span></span></a></li>{/if}
        </ul>
      </section>
    {/if}
  {:else}
    <div class="sheet">
      <div class="backdrop" aria-hidden="true">{#if coverPreview}<img src={coverPreview} alt="" />{/if}</div>
      <aside class="side">
        <div class="cover-slot">
          <button type="button" class="cover" class:empty={!coverPreview} disabled={imageBusy} onclick={() => coverInput?.click()} aria-label={cover ? 'change cover' : 'choose cover'}>
            {#if coverPreview}
              <img src={coverPreview} alt="selected cover preview" width="320" height="320" />
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
        <div class="meta">
          {#if audio}
            {#if duration}<span class="chip strong">{clock(duration)}</span>{/if}
            <span class="chip file" title={audio.name}>{audio.name} · {fileSize(audio.size)}</span>
            <button type="button" class="chip action" onclick={() => openPicker()}><Icon name="wave" size={15} />change audio</button>
          {:else}
            <span class="chip">your draft is still here. choose the audio file again.</span>
            <button type="button" class="chip action" onclick={() => openPicker()}><Icon name="wave" size={15} />choose audio</button>
          {/if}
        </div>
        {#if service}
          {#if soleCopy}<label class="consent"><input type="checkbox" bind:checked={consent} /><span><b>use plyr.fm storage</b> this file is over 100 MB, more than a track can keep on your PDS, so plyr.fm keeps it and serves it so it plays everywhere. playback and downloads are public.</span></label>
          {:else}<p class="consent note"><span><b>your PDS keeps the original</b> plyr.fm adds an mp3 copy so it plays everywhere. playback and downloads are public.</span></p>{/if}
          {#if !account.uploadStorage}<p class="problem">sign in again to allow plyr.fm storage. what you typed stays here. <a href="/login?return_to=%2Fupload">sign in again</a></p>{/if}
        {/if}
      </aside>
      <div class="main">
        <div class="copy">
          <span class="kind">new track</span>
          <label class="title">
            <input bind:value={title} aria-label="title" maxlength="256" required placeholder="name this track" />
            <Icon name="edit" size={18} />
          </label>
          {#if artist}
            <p class="owner"><span class="avatar"><Artwork src={profileAvatar} size={24} fallbackIcon="user" /></span>posts to your profile as {artist}</p>
          {/if}
          {#if audioProblem}<p class="problem" role="alert">{audioProblem}</p>{/if}
          {#if audio}<AudioPreview file={audio} bind:duration />{/if}
          {#if tooLargeClosed}<p class="problem" role="alert">closed tracks can be up to 100 MB for now. choose a smaller file or make it open.</p>{/if}
        </div>
        {#if !privateTrack}<AlbumChoice {albums} bind:target bind:album closed={access.closed} disabled={submitting} />{/if}
        <UploadDetails bind:tags bind:description bind:autoTag bind:features bind:explicit owner={owner ?? undefined} {tagProblem} onlyYou={privateTrack} />
        <AccessPicker bind:access bind:options plyrStorage={service} needsSettings={options.sell && !privateTrack && !account.accountSync ? signInAgain : undefined} {artist} {title} cover={coverPreview} disabled={submitting} {checked} needsSignIn={accessSignIn || undefined} />
      </div>
    </div>
  {/if}

  {#if draftProblem}<p class="problem" role="alert">{draftProblem}</p>{/if}
  {#if formProblem}<p class="problem" role="alert">{formProblem}</p>{/if}
  {#if editing}
  <div class="bar">
      <button type="button" class="summary" aria-label="who can listen: {summary.label}{summary.detail ? `, ${summary.detail}` : ''}. change" onclick={() => document.getElementById('who-can-listen')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
        <Icon name={access.closed ? 'lock' : 'globe'} size={17} /><b>{summary.label}</b>{#if summary.detail}<small>· {summary.detail}</small>{/if}<span class="caret"><Icon name="down" size={15} /></span>
      </button>
      <span class="hint rights">by uploading you confirm you have the rights to share this.</span>
    <button class="pill primary submit" type="submit" disabled={blocked}><Icon name="upload" size={18} />{submitting || privateBusy ? 'saving…' : 'upload'}</button>
  </div>
  <p class="rights-phone">by uploading you confirm you have the rights to share this.</p>
  {/if}
</form>

<style>
  form { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; border-radius: 1.25rem; }
  form.dragging .door, form.dragging .sheet .cover { outline: 3px solid var(--accent); outline-offset: 4px; }
  .problem { color: light-dark(#a3271f, #ff8f87); font-size: var(--t-14-4); }
  .problem a { color: inherit; text-decoration: underline; }
  .pill { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; min-height: 2.75rem; padding: 0 1.35rem; border: 0; border-radius: 999px; background: var(--raised); font-weight: 700; }
  .pill.primary { background: var(--accent); color: var(--on-accent); }
  .pill.primary:hover:not(:disabled) { filter: brightness(1.08); }

  .door { display: grid; justify-items: center; align-content: center; gap: 0.8rem; min-height: 22rem; padding: 2rem 1.25rem; text-align: center; border-radius: 1.25rem; border: 2px dashed color-mix(in srgb, var(--accent) 45%, var(--line)); background: radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 70%), var(--surface); }
  .drop-icon { width: 4.5rem; height: 4.5rem; display: grid; place-items: center; border-radius: 1.2rem; background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
  .door h2 { font-size: clamp(1.5rem, 3vw, 2rem); letter-spacing: -0.02em; }
  .door .narrow { display: none; }
  .door .subtle { color: var(--muted); }

  .shelf { display: grid; gap: 0.75rem; margin-top: 0.75rem; }
  .shelf header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
  .shelf h2 { font-size: var(--t-16); font-weight: 700; }
  .shelf ul { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: 1rem; margin: 0; padding: 0; list-style: none; }
  .album { display: grid; gap: 0.3rem; width: 100%; padding: 0; border: 0; background: none; color: inherit; text-align: left; }
  .album:hover { text-decoration: none; }
  .album .art { position: relative; display: grid; place-items: center; aspect-ratio: 1; border-radius: 0.75rem; overflow: hidden; background: var(--raised); border: 1px solid var(--line); color: var(--faint); font-weight: 700; transition: transform 0.15s; }
  .album .art :global(img) { width: 100%; height: 100%; object-fit: cover; }
  .album:hover .art, .album.hot .art { transform: translateY(-2px); }
  .album.hot .art { outline: 3px solid var(--accent); outline-offset: 3px; }
  .album .into { position: absolute; inset: 0; display: grid; place-items: center; padding: 0.75rem; text-align: center; background: color-mix(in srgb, var(--bg) 62%, transparent); backdrop-filter: blur(4px); color: var(--text); font-weight: 800; }
  .album b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--t-14-4); }
  .album small { color: var(--faint); font-size: var(--t-12-8); }
  .formats { color: var(--faint); font-size: var(--t-13-6); }

  .sheet { position: relative; isolation: isolate; display: grid; grid-template-columns: minmax(13rem, 20rem) minmax(0, 1fr); gap: clamp(1.5rem, 3vw, 2.5rem); align-items: start; }
  .side { position: sticky; top: 1.5rem; display: grid; gap: 0.75rem; min-width: 0; }
  .main { display: grid; gap: 1rem; min-width: 0; }
  .backdrop { position: absolute; z-index: -1; inset: -3rem calc(-1 * clamp(1rem, 3vw, 2.25rem)) auto; height: 34rem; overflow: hidden; pointer-events: none; mask-image: linear-gradient(to bottom, black 35%, transparent); }
  .backdrop img { width: 100%; height: 100%; object-fit: cover; filter: blur(48px) saturate(1.2); transform: scale(1.3); opacity: 0.55; }
  .cover-slot { position: relative; width: 100%; display: grid; gap: 0.5rem; }
  .cover { position: relative; display: block; width: 100%; aspect-ratio: 1; padding: 0; overflow: hidden; border-radius: 0.75rem; border: 0; background: var(--raised); box-shadow: 0 1.1rem 2.5rem rgb(0 0 0 / 0.3); }
  .cover.empty { box-shadow: none; border: 2px dashed var(--line); background: var(--surface); }
  .cover.empty:hover { border-color: var(--accent); }
  .cover img { width: 100%; height: 100%; object-fit: cover; }
  .cover-chip { position: absolute; left: 0.6rem; bottom: 0.6rem; display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.35rem 0.7rem; border-radius: 999px; background: rgb(0 0 0 / 0.55); color: white; font-size: var(--t-12-8); font-weight: 700; backdrop-filter: blur(8px); }
  .cover-empty { height: 100%; display: grid; place-items: center; align-content: center; gap: 0.4rem; padding: 1rem; color: var(--faint); }
  .cover-empty b { color: var(--text); }
  .cover-empty small { font-size: var(--t-12-8); }
  .remove { position: absolute; top: 0.5rem; right: 0.5rem; width: 2rem; height: 2rem; display: grid; place-items: center; border: 0; border-radius: 50%; background: rgb(0 0 0 / 0.55); color: white; backdrop-filter: blur(8px); }
  .cover-note { font-size: var(--t-13-6); }
  .copy { flex: 1; min-width: 0; display: grid; gap: 0.6rem; }
  .copy > * { max-width: 100%; min-width: 0; }
  .kind { color: var(--faint); font-size: var(--t-12); font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
  .title { display: flex; align-items: center; gap: 0.5rem; border-bottom: 2px dashed color-mix(in srgb, var(--text) 25%, transparent); color: var(--faint); }
  .title:focus-within { border-bottom-color: var(--accent); border-bottom-style: solid; }
  .title input { flex: 1; min-width: 0; padding: 0.1rem 0; border: 0; outline: 0; background: none; color: var(--text); font-size: clamp(1.75rem, 4.5vw, 3.1rem); font-weight: 700; letter-spacing: -0.03em; line-height: 1.15; }
  .title input::placeholder { color: var(--faint); opacity: 0.7; }
  .owner { display: flex; align-items: center; gap: 0.5rem; color: var(--muted); }
  .avatar { width: 1.5rem; flex: none; border-radius: 50%; overflow: hidden; }
  .meta { display: flex; flex-wrap: wrap; gap: 0.45rem; }
  .chip { display: inline-flex; align-items: center; gap: 0.35rem; min-height: 2rem; max-width: 100%; padding: 0.3rem 0.8rem; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--raised) 85%, transparent); color: var(--muted); font-size: var(--t-13-6); }
  .chip.strong { color: var(--text); font-weight: 700; font-variant-numeric: tabular-nums; }
  .chip.file { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; line-height: 1.4rem; }
  .chip.action { color: var(--text); font-weight: 700; }
  .chip.action:hover { background: var(--hover); }
  .consent { margin: 0; display: flex; align-items: flex-start; gap: 0.7rem; padding: 0.75rem 0.9rem; border-radius: 0.75rem; background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(16px); color: var(--muted); font-size: var(--t-14-4); line-height: 1.4; cursor: pointer; }
  .consent.note { cursor: default; }
  .consent b { color: var(--text); margin-right: 0.25rem; }
  .consent input { accent-color: var(--accent); }
  .consent input { width: 1.2rem; height: 1.2rem; flex: none; margin: 0.1rem 0 0; }


  .bar { position: sticky; bottom: calc(1rem + var(--bar-offset, 0px)); z-index: 3; display: flex; align-items: center; gap: 1rem; padding: 0.5rem 0.5rem 0.5rem 0.75rem; border-radius: 999px; background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(18px); box-shadow: 0 0.6rem 2rem rgb(0 0 0 / 0.14); }
  .hint { flex: 1; text-align: right; color: var(--faint); font-size: var(--t-13-6); }
  .submit { min-height: 3rem; padding: 0 1.75rem; font-size: var(--t-16); }
  .summary { display: inline-flex; align-items: center; gap: 0.45rem; min-width: 0; max-width: 24rem; min-height: 2.75rem; padding: 0 0.9rem 0 0.75rem; border-radius: 999px; border: 1px solid var(--line); background: var(--raised); color: var(--text); font-size: var(--t-14-4); white-space: nowrap; }
  .summary small { overflow: hidden; text-overflow: ellipsis; color: var(--faint); font-weight: 600; font-size: var(--t-13-6); }
  .summary .caret { display: inline-flex; color: var(--faint); transform: rotate(180deg); }
  .summary:hover { background: var(--hover); }
  .rights { text-align: left; line-height: 1.3; font-size: var(--t-12-8); }
  .rights-phone { display: none; }

  summary { cursor: pointer; padding: 0.6rem 0; }

  @media (max-width: 720px) {
    .door { min-height: 16rem; }
    .door .narrow { display: inline; }
    .wide { display: none; }
    .shelf ul { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.75rem; }
    .sheet { grid-template-columns: minmax(0, 1fr); gap: 1rem; }
    .side { position: static; justify-items: center; text-align: center; }
    .backdrop { inset: -2rem -1rem auto; height: 26rem; }
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
    .summary { flex: 1; min-height: 3rem; }
    .summary small { display: none; }
    .submit { flex: none; min-width: 0; padding: 0 1.2rem; }
    .rights-phone { display: block; margin-top: -0.25rem; text-align: center; color: var(--faint); font-size: var(--t-12-8); }
  }
</style>
