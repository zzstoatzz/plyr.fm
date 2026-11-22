<script lang="ts">
  import { audioAccept } from '$lib/media/accept';
  import TagInput from '$lib/publishing/TagInput.svelte';
  import { goto } from '$app/navigation';
  import { onMount, tick, untrack } from 'svelte';
  import { isOpen } from '@plyr/next-core/access/policy';
  import type { AwaitStatus, Track } from '@plyr/next-core/api';
  import { TrackRevisionConflict } from '@plyr/next-core/pds';
  import { canReplaceTrackAudio, TrackWriteUnconfirmed, validateReplacementAudio } from '@plyr/next-core/publishing/track-audio';
  import { recordTags } from '@plyr/next-core/publishing/track-tags';
  import { api } from '$lib/api';
  import { toast } from '$lib/toast.svelte';
  import { auth } from '$lib/auth';
  import { coverImage } from '$lib/media/cover-image';
  import { fileDuration } from '$lib/media/file-duration';
  import { createPds } from '$lib/pds';
  import Loading from '$lib/ui/Loading.svelte';
  import { clock, fileSize } from '$lib/media/format';
  import Icon from '$lib/ui/Icon.svelte';
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
  let artworkPreview = $state<string>();
  $effect(() => {
    const url = artwork && URL.createObjectURL(artwork);
    artworkPreview = url || undefined;
    if (url) return () => URL.revokeObjectURL(url);
  });
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
  let deleteNotice = $state<HTMLDivElement>();
  $effect(() => { if (deleteNotice) { deleteNotice.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); deleteNotice.focus({ preventScroll: true }); } });
  let saved = $state<{ status: AwaitStatus }>();
  const trackPath = $derived(`/track/${encodeURIComponent(id)}`);
  const close = $derived(returnTo ?? trackPath);
  const cover = $derived(artwork === null ? undefined : artworkPreview ?? track?.media.artwork?.url ?? undefined);
  const locked = $derived(busy || imageBusy || confirm);
  const canReplace = $derived(!!track && isOpen(track) && !!revision && canReplaceTrackAudio(revision.value));

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
      if (item.artist.did !== account.did) {
        failure = 'only the artist can edit this track.';
        return;
      }
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
    } catch {
      if (current()) failure = 'could not load this track.';
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
      if (deleting) {
        // The record is gone from the PDS once this resolves; the catalog follows on its own, so there is nothing left to edit.
        await pds.deleteTrack(track.record.uri);
        if (!current()) return;
        toast.add(`deleted "${track.metadata.title}"`, 'success');
        await goto('/portal', { replaceState: true, invalidateAll: true });
        return;
      }
      const status = await pds.editTrack(track.record.uri, {
        title, album, description, artwork, tags: tagsEdited ? tags.split('\n') : undefined,
        audio: audio ? { file: audio, duration } : undefined
      }, revision);
      if (!current()) return;
      saved = { status };
      if (status === 'indexed' || status === 'deleted' || status === 'absent') await goto(trackPath, { replaceState: true, invalidateAll: true });
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

{#if loading || !revision || saved}
  <EditorPanel title="edit track" {close} busy={busy || imageBusy}>
    {#if loading}
      <Loading label="loading track" inline />
    {:else if saved}
      <p role="status" class="state">{saved.status === 'rejected' ? 'your change was saved. the catalog could not apply it.' : 'your change was saved. the catalog is catching up.'}</p>
      <a class="text-button" href={trackPath}>view track</a>
    {:else}
      <p role="alert" class="editor-error">{failure}</p>
      <button class="text-button" onclick={load}>retry loading track</button>
    {/if}
  </EditorPanel>
{:else}
  <form class="editor" onsubmit={event => { event.preventDefault(); void save(false); }}>
    <input type="file" aria-label="cover image" hidden accept="image/*,.heic,.heif" bind:this={artworkInput} onchange={event => chooseArtwork(event.currentTarget.files?.[0])} />
    {#if canReplace}<input type="file" aria-label="replacement audio" hidden accept={audioAccept()} bind:this={audioInput} onchange={event => chooseAudio(event.currentTarget.files?.[0])} />{/if}
    {#if conflict}
      <div class="notice" bind:this={conflictNotice} tabindex="-1">
        <p role="alert">{failure}</p>
        <button type="button" class="text-button" onclick={load}>discard draft and reload</button>
      </div>
    {/if}
    <header class="hero">
      <div class="backdrop" aria-hidden="true">{#if cover}<img src={cover} alt="" />{/if}</div>
      <div class="cover-slot">
        <button type="button" class="cover" class:empty={!cover} disabled={locked} onclick={() => artworkInput?.click()} aria-label={cover ? 'change cover' : 'add a cover'}>
          {#if cover}
            <img src={cover} alt="" width="240" height="240" />
            <span class="cover-chip"><Icon name="image" size={15} />{imageBusy ? 'preparing…' : 'change cover'}</span>
          {:else}
            <span class="cover-empty">
              <Icon name="image" size={30} stroke={1.6} />
              <b>{imageBusy ? 'preparing your cover…' : 'add a cover'}</b>
              <small>optional · any photo or image</small>
            </span>
          {/if}
        </button>
        {#if cover}
          <button type="button" class="remove" disabled={locked} aria-label="remove cover" onclick={() => { artwork = track?.media.artwork ? null : undefined; if (artworkInput) artworkInput.value = ''; }}><Icon name="x" size={16} /></button>
        {:else if artwork === null}
          <button type="button" class="chip action keep" disabled={locked} onclick={() => { artwork = undefined; }}>keep current cover</button>
        {/if}
      </div>
      <div class="copy">
        <span class="kind">edit track</span>
        <label class="title">
          <input bind:value={title} aria-label="title" maxlength="256" required placeholder="name this track" disabled={busy || confirm} />
          <Icon name="edit" size={18} />
        </label>
        {#if !title.trim()}<p class="problem">a track needs a title.</p>{/if}
        <div class="meta">
          {#if track?.metadata.duration_seconds}<span class="chip strong">{clock(track.metadata.duration_seconds)}</span>{/if}
          {#if audio}
            <span class="chip file" title={audio.name}>new audio · {audio.name} · {fileSize(audio.size)}</span>
            <button type="button" class="chip action" disabled={locked} onclick={() => { audio = undefined; if (audioInput) audioInput.value = ''; }}>keep current audio</button>
          {:else if canReplace}
            <button type="button" class="chip action" disabled={locked || conflict} onclick={() => audioInput?.click()}><Icon name="wave" size={15} />replace audio</button>
          {/if}
        </div>
        {#if artwork === null}<p class="subtle note">the cover will be removed when you save.</p>{/if}
        {#if audio}<p class="subtle note">saving replaces the audio at this track’s link. title, likes and playlists stay. keep your original: this can't be undone here.</p>{/if}
      </div>
    </header>

    <div class="details">
      <div class="card">
        <label class="field"><span>album</span><input bind:value={album} maxlength="256" placeholder="optional" disabled={busy || confirm} /></label>
        <TagInput bind:value={tags} onedit={() => { tagsEdited = true; }} disabled={busy || confirm} />
      </div>
      <div class="card">
        <label class="field"><span>description</span><textarea bind:value={description} maxlength="5000" rows="5" placeholder="liner notes, credits, lyrics…" disabled={busy || confirm}></textarea></label>
        {#if description.length > 4500}<p class="subtle count">{description.length} / 5000</p>{/if}
      </div>
    </div>

    {#if failure && !conflict}<p role="alert" class="problem">{failure}</p>{/if}
    {#if confirm}
      <div class="notice danger-zone" role="alert" tabindex="-1" bind:this={deleteNotice}>
        <p>delete “{track?.metadata.title}”? it comes off your profile and plyr.fm, along with its likes and plays. keep your original file: this can't be undone.</p>
        <div class="actions">
          <button type="button" class="pill danger" disabled={busy} onclick={() => save(true)}>{busy ? 'deleting…' : 'delete track'}</button>
          <button type="button" class="pill" disabled={busy} onclick={() => { confirm = false; }}>keep it</button>
        </div>
      </div>
    {/if}
    <div class="bar">
      <button type="button" class="delete" disabled={busy || conflict || imageBusy || confirm} onclick={() => { confirm = true; }}><Icon name="trash" size={17} />delete</button>
      <span class="spacer"></span>
      {#if !busy}<a class="cancel" href={close}>cancel</a>{/if}
      <button class="pill primary submit" type="submit" disabled={busy || conflict || imageBusy || confirm || !title.trim()}>{busy && !confirm ? 'saving…' : 'save'}</button>
    </div>
  </form>
{/if}

<style>
  .editor { --danger: light-dark(#a3271f, #ff8f87); max-width: 69rem; margin: 0 auto; display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
  .problem { color: var(--danger); font-size: 0.9rem; }
  .subtle { color: var(--muted); }
  .note { font-size: 0.85rem; line-height: 1.4; }
  .danger-zone { scroll-margin-bottom: calc(var(--bar-offset, 0px) + 6.5rem); }
  .notice { display: grid; gap: 0.6rem; padding: 0.9rem 1rem; border: 1px solid var(--line); border-radius: 0.9rem; background: var(--surface); }
  .notice:focus { outline: none; }
  .danger-zone { border-color: color-mix(in srgb, var(--danger) 45%, var(--line)); }
  .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .pill { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; min-height: 2.75rem; padding: 0 1.35rem; border: 0; border-radius: 999px; background: var(--raised); color: var(--text); font-weight: 700; }
  .pill.primary { background: var(--accent); color: var(--on-accent); }
  .pill.primary:hover:not(:disabled) { filter: brightness(1.08); }
  .pill.danger { background: var(--danger); color: var(--bg); }

  .hero { position: relative; isolation: isolate; display: flex; align-items: flex-end; gap: 2rem; padding-block: 0.5rem 1.5rem; }
  .backdrop { position: absolute; z-index: -1; inset: -3rem calc(-1 * clamp(1rem, 3vw, 2.25rem)) -2rem; overflow: hidden; pointer-events: none; mask-image: linear-gradient(to bottom, transparent, black 25%, black 45%, transparent); }
  .backdrop img { width: 100%; height: 100%; object-fit: cover; filter: blur(48px) saturate(1.2); transform: scale(1.3); opacity: 0.55; }
  .cover-slot { position: relative; flex: none; width: min(15rem, 38vw); display: grid; gap: 0.5rem; justify-items: center; }
  .cover { position: relative; display: block; width: 100%; aspect-ratio: 1; padding: 0; overflow: hidden; border-radius: 0.75rem; border: 0; background: var(--raised); box-shadow: 0 1.1rem 2.5rem rgb(0 0 0 / 0.3); }
  .cover:disabled { opacity: 1; }
  .cover.empty { box-shadow: none; border: 2px dashed var(--line); background: var(--surface); }
  .cover.empty:hover:not(:disabled) { border-color: var(--accent); }
  .cover img { width: 100%; height: 100%; object-fit: cover; }
  .cover-chip { position: absolute; left: 0.6rem; bottom: 0.6rem; display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.35rem 0.7rem; border-radius: 999px; background: rgb(0 0 0 / 0.55); color: white; font-size: 0.8rem; font-weight: 700; backdrop-filter: blur(8px); }
  .cover-empty { height: 100%; display: grid; place-items: center; align-content: center; gap: 0.4rem; padding: 1rem; color: var(--faint); }
  .cover-empty b { color: var(--text); }
  .cover-empty small { font-size: 0.8rem; }
  .remove { position: absolute; top: 0.5rem; right: 0.5rem; width: 2rem; height: 2rem; display: grid; place-items: center; border: 0; border-radius: 50%; background: rgb(0 0 0 / 0.55); color: white; backdrop-filter: blur(8px); }
  .copy { flex: 1; min-width: 0; display: grid; gap: 0.6rem; }
  .copy > * { max-width: 100%; min-width: 0; }
  .kind { color: var(--faint); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
  .title { display: flex; align-items: center; gap: 0.5rem; border-bottom: 2px dashed color-mix(in srgb, var(--text) 25%, transparent); color: var(--faint); }
  .title:focus-within { border-bottom-color: var(--accent); border-bottom-style: solid; }
  .title input { flex: 1; min-width: 0; padding: 0.1rem 0; border: 0; outline: 0; background: none; color: var(--text); font-size: clamp(1.75rem, 4.5vw, 3.1rem); font-weight: 700; letter-spacing: -0.03em; line-height: 1.15; }
  .title input::placeholder { color: var(--faint); opacity: 0.7; }
  .meta { display: flex; flex-wrap: wrap; gap: 0.45rem; }
  .chip { display: inline-flex; align-items: center; gap: 0.35rem; min-height: 2rem; max-width: 100%; padding: 0.3rem 0.8rem; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--raised) 85%, transparent); color: var(--muted); font-size: 0.85rem; }
  .chip.strong { color: var(--text); font-weight: 700; font-variant-numeric: tabular-nums; }
  .chip.file { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; line-height: 1.4rem; }
  .chip.action { color: var(--text); font-weight: 700; }
  .chip.action:hover:not(:disabled) { background: var(--hover); }

  .details { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .card { display: grid; gap: 1rem; align-content: start; padding: 1.1rem; background: var(--surface); border: 1px solid var(--line); border-radius: 0.9rem; }
  .field { display: grid; gap: 0.4rem; }
  .field > span { font-size: 0.8rem; font-weight: 700; color: var(--faint); letter-spacing: 0.04em; }
  .field :is(input, textarea) { width: 100%; min-width: 0; padding: 0.65rem 0.8rem; border: 1px solid var(--line); border-radius: 0.65rem; background: var(--bg); color: inherit; line-height: 1.4; }
  .field textarea { resize: vertical; }
  .field :is(input, textarea):focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .count { font-size: 0.8rem; text-align: right; }

  .bar { position: sticky; bottom: calc(1rem + var(--bar-offset, 0px)); z-index: 3; display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem; border-radius: 999px; background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(18px); box-shadow: 0 0.6rem 2rem rgb(0 0 0 / 0.14); }
  .spacer { flex: 1; }
  .delete { display: inline-flex; align-items: center; gap: 0.4rem; min-height: 2.75rem; padding: 0 0.9rem; border: 0; border-radius: 999px; background: none; color: var(--danger); font-weight: 600; }
  .delete:hover:not(:disabled) { background: var(--hover); }
  .cancel { display: inline-flex; align-items: center; min-height: 2.75rem; padding: 0 0.9rem; border-radius: 999px; color: var(--muted); font-weight: 600; }
  .cancel:hover { background: var(--hover); text-decoration: none; }
  .submit { min-height: 3rem; padding: 0 1.75rem; font-size: 1.02rem; }

  @media (max-width: 720px) {
    .hero { flex-direction: column; align-items: center; text-align: center; gap: 1rem; padding-top: 0; }
    .backdrop { inset: -2rem -1rem -2rem; }
    .cover-slot { width: min(15rem, 56vw); }
    .copy { width: 100%; justify-items: center; }
    .title { width: 100%; }
    .title input { text-align: center; }
    .meta { justify-content: center; width: 100%; }
    .details { grid-template-columns: 1fr; }
    .bar { gap: 0.25rem; padding: 0.4rem; }
    .submit { padding: 0 1.4rem; }
  }
</style>
