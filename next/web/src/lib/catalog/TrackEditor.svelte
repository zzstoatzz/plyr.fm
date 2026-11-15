<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount, tick, untrack } from 'svelte';
  import type { AwaitStatus, Track } from '@plyr/next-core/api';
  import { TrackRevisionConflict } from '@plyr/next-core/pds';
  import { canReplaceTrackAudio, TrackWriteUnconfirmed, validateReplacementAudio } from '@plyr/next-core/publishing/track-audio';
  import { recordTags } from '@plyr/next-core/publishing/track-tags';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth';
  import { coverImage } from '$lib/media/cover-image';
  import { fileDuration } from '$lib/media/file-duration';
  import { createPds } from '$lib/pds';
  import Loading from '$lib/ui/Loading.svelte';
  import EditorPanel from './EditorPanel.svelte';

  let { id, account, returnTo }: { id: string; returnTo?: string; account: ReturnType<typeof auth.getAuth> } = $props();
  const pds = untrack(() => createPds(account));
  type Revision = Awaited<ReturnType<typeof pds.myTrack>>;

  let track = $state.raw<Track>();
  let revision = $state.raw<Revision>();
  let title = $state('');
  let album = $state('');
  let description = $state('');
  let tags = $state('');
  let tagsEdited = $state(false);
  let artwork = $state<File | null>();
  let audio = $state<File>();
  let audioInput = $state<HTMLInputElement>();
  let artworkInput = $state<HTMLInputElement>();

  let live = false;
  const current = () => live && auth.getAuth().rpc === account.rpc;
  let loading = $state(true);
  let busy = $state(false);
  let imageBusy = $state(false);
  let conflict = $state(false);
  let confirm = $state(false);
  let failure = $state('');
  let conflictNotice = $state<HTMLDivElement>();
  let saved = $state<{ status: AwaitStatus; deleting: boolean }>();
  const trackPath = $derived(`/track/${encodeURIComponent(id)}`);
  const close = $derived(returnTo ?? trackPath);
  const canReplace = $derived(track?.access.visibility === 'public' && !!revision && canReplaceTrackAudio(revision.value));

  onMount(() => {
    live = true;
    void load();
    return () => { live = false; };
  });

  async function load() {
    failure = '';
    loading = true;
    try {
      const item = await api.track(id, { fresh: true });
      if (!current()) return;
      if (item.artist.did !== account.did) throw new Error('only the artist can edit this track.');
      const record = await pds.myTrack(item.record.uri);
      if (!current()) return;
      const text = (key: string) => {
        const value = record.value[key];
        return typeof value === 'string' ? value : '';
      };
      tags = (recordTags(record.value.tags) ?? []).join('\n');
      title = text('title');
      album = text('album');
      description = text('description');
      tagsEdited = false;
      audio = artwork = undefined;
      track = item;
      revision = record;
      conflict = confirm = false;
    } catch (error) {
      if (current()) failure = error instanceof Error ? error.message : 'could not load this track.';
    } finally { if (current()) loading = false; }
  }

  function chooseAudio(file?: File) {
    if (!file || !revision) return;
    try {
      validateReplacementAudio(revision.value, file);
      audio = file;
      failure = '';
    } catch (error) {
      if (audioInput) audioInput.value = '';
      audio = undefined;
      failure = error instanceof Error ? error.message : 'could not open this file.';
    }
  }

  async function chooseArtwork(file?: File) {
    if (!file || imageBusy) return;
    imageBusy = true;
    try {
      const cover = await coverImage(file);
      if (current()) { artwork = cover; failure = ''; }
    } catch (error) {
      if (current()) {
        if (artworkInput) artworkInput.value = '';
        failure = error instanceof Error ? error.message : 'could not open cover art.';
      }
    } finally { if (current()) imageBusy = false; }
  }

  async function save(deleting: boolean) {
    if (!track || !revision || !current() || busy || saved || conflict || imageBusy || (confirm && !deleting)) return;
    busy = true;
    failure = '';
    try {
      const duration = !deleting && audio ? await fileDuration(audio).catch(() => undefined) : undefined;
      if (!current()) return;
      const status = deleting ? await pds.deleteTrack(track.record.uri) : await pds.editTrack(track.record.uri, {
        title, album, description, artwork, tags: tagsEdited ? tags.split('\n') : undefined,
        audio: audio ? { file: audio, duration } : undefined
      }, revision);
      if (!current()) return;
      saved = { status, deleting };
      if (status === 'indexed' || status === 'deleted' || status === 'absent') await goto(deleting ? '/portal' : trackPath, { replaceState: true, invalidateAll: true });
    } catch (error) {
      if (!current()) return;
      conflict = error instanceof TrackRevisionConflict || error instanceof TrackWriteUnconfirmed;
      failure = error instanceof Error ? error.message : 'could not update this track.';
      if (conflict) {
        await tick();
        if (current()) conflictNotice?.focus();
      }
    } finally { if (current()) busy = false; }
  }
</script>

<EditorPanel title="edit track" {close} busy={busy || imageBusy}>
  {#if loading}
    <Loading label="loading track" inline />
  {:else if !revision}
    <p role="alert" class="editor-error">{failure}</p>
    <button class="text-button" onclick={load}>retry loading track</button>
  {:else if saved}
    <p role="status" class="state">{saved.status === 'rejected' ? 'your change was saved. the catalog could not apply it.' : 'your change was saved. the catalog is catching up.'}</p>
    <a class="text-button" href={saved.deleting ? '/portal' : trackPath}>{saved.deleting ? 'back to your music' : 'view track'}</a>
  {:else}
    {#if conflict}
      <div class="editor-error" bind:this={conflictNotice} tabindex="-1">
        <p role="alert">{failure}</p>
        <button type="button" class="text-button" onclick={load}>discard draft and reload</button>
      </div>
    {/if}
    <form onsubmit={event => { event.preventDefault(); void save(false); }}>
      {#if canReplace}
        <label>replace audio <input type="file" accept="audio/*" bind:this={audioInput} disabled={busy || conflict || confirm} onchange={event => chooseAudio(event.currentTarget.files?.[0])} /></label>
        {#if audio}
          <p class="subtle">save replaces the audio at this track’s existing link. up to 100 MiB. your title, likes and playlists stay.</p>
          <div class="editor-actions"><button type="button" class="text-button" disabled={busy || confirm} onclick={() => { audio = undefined; if (audioInput) audioInput.value = ''; }}>keep current audio</button></div>
        {/if}
      {/if}
      <label>title <input bind:value={title} maxlength="256" required disabled={busy || confirm} /></label>
      <label>album <input bind:value={album} maxlength="256" disabled={busy || confirm} /></label>
      <label>description <textarea bind:value={description} maxlength="5000" rows="4" disabled={busy || confirm}></textarea></label>
      <label>tags <textarea bind:value={tags} oninput={() => { tagsEdited = true; }} placeholder="one tag per line" rows="2" disabled={busy || confirm}></textarea></label>
      <label>change cover <input type="file" accept="image/*,.heic,.heif" bind:this={artworkInput} disabled={busy || imageBusy || confirm} onchange={event => chooseArtwork(event.currentTarget.files?.[0])} /></label>
      <div class="editor-actions">
        <button type="button" class="text-button" disabled={busy || imageBusy || confirm} onclick={() => { artwork = artwork === null ? undefined : null; if (artworkInput) artworkInput.value = ''; }}>
          {artwork === null ? 'keep current cover' : 'remove cover'}
        </button>
      </div>
      {#if imageBusy}<p role="status">preparing your cover…</p>{/if}
      {#if failure && !conflict}<p role="alert" class="editor-error">{failure}</p>{/if}
      {#if confirm}
        <p>delete “{track?.metadata.title}”? it will be removed from your music.</p>
        <div class="editor-actions">
          <button type="button" class="text-button editor-danger" disabled={busy} onclick={() => save(true)}>confirm delete</button>
          <button type="button" class="text-button" disabled={busy} onclick={() => { confirm = false; }}>cancel delete</button>
        </div>
      {:else}
        <div class="editor-actions">
          <button class="text-button editor-save" type="submit" disabled={busy || conflict || imageBusy || !title.trim()}>{busy ? 'saving…' : 'save'}</button>
          <button type="button" class="text-button editor-danger" disabled={busy || conflict || imageBusy} onclick={() => { confirm = true; }}>delete track</button>
        </div>
      {/if}
    </form>
  {/if}
</EditorPanel>
