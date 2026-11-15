<script lang="ts">
  import { TID } from '@atproto/common-web';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount, untrack } from 'svelte';
  import { albumIdFromUri } from '@plyr/next-core/api';
  import { albumName } from '@plyr/next-core/collections/album-membership';
  import type { AlbumUploadPlan, AlbumUploadSlot } from '@plyr/next-core/publishing/album-upload-plan';
  import { creditName } from '@plyr/next-core/publishing/credit-name';
  import { draftInRecovery, queuedUploadDraft, reattachQueuedUpload } from '@plyr/next-core/publishing/queued-upload-draft';
  import { RepoResponseError } from '@plyr/next-core/publishing/repo-rpc';
  import { PUBLIC_AUDIO_FORMATS } from '@plyr/next-core/publishing/upload-model';
  import { canonicalAudioType, jobLine, needsPlyrStorage, uploadInProgress } from '@plyr/next-core/publishing/upload-queue-model';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth';
  import { authConfig } from '$lib/auth-config';
  import AlbumCoverPicker from '$lib/collections/AlbumCoverPicker.svelte';
  import CollectionJournal from '$lib/collections/CollectionJournal.svelte';
  import { collectionJournal } from '$lib/collections/CollectionJournal.svelte.ts';
  import OrderRows from '$lib/collections/OrderRows.svelte';
  import { createPds } from '$lib/pds';
  import { albumUploads, queuedDrafts, uploadStorage } from '$lib/storage/upload-storage';
  import Loading from '$lib/ui/Loading.svelte';
  import { uploadQueue } from '$lib/upload';

  type Account = ReturnType<typeof auth.getAuth>;
  type Selected = { key: string; file: File; title: string };
  type Reference = { uri: string; cid: string };
  type Song = { slot: AlbumUploadSlot; state: 'ready'; reference: Reference }
    | { slot: AlbumUploadSlot; state: 'working' | 'recover' | 'choose'; detail: string };

  let { account, owner }: { account: Account; owner: NonNullable<Account['did']> } = $props();
  const pds = untrack(() => createPds(account));
  const organization = untrack(() => pds.albumOrganization());
  const current = () => mounted && auth.getAuth().rpc === account.rpc && auth.getAuth().did === owner;
  const journal = collectionJournal(pds, current);
  let mounted = false;
  let revision = 0;
  let name = $state('');
  let selections = $state<Selected[]>([]);
  let songInput = $state<HTMLInputElement>();
  let cover = $state<File>();
  let coverPending = $state(false);
  let omitCover = $state(false);
  let albums = $state<string[]>([]);
  let artistName = $state<string>();
  let artist = $derived(artistName || account.handle || owner);
  let usesStorage = $derived(selections.some(item => needsPlyrStorage(item.file)));
  const consentKey = $derived(`plyr-storage-consent:${owner}`);
  let consent = $state(false);
  let plan = $state.raw<AlbumUploadPlan>();
  let songs = $state.raw<Song[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let problem = $state('');
  let selectionProblem = $state('');
  let statusProblem = $state('');
  let savedUrl = $state('');
  let confirming = $state(false);
  let ready = $derived(songs.flatMap(song => song.state === 'ready' ? [song.reference] : []));
  let working = $derived(songs.some(song => song.state === 'working'));
  let blocked = $derived(journal.view.loading || !!journal.view.error || journal.view.operations.some(operation => !operation.archived));
  let coverMissing = $derived(!!plan?.coverName && !cover && !omitCover);
  const signInPath = resolve('/(app)/login') + '?return_to=%2Fupload%3Fmode%3Dalbum';

  const address = (slot: AlbumUploadSlot) => `at://${slot.owner}/${authConfig.NSID.track}/${slot.reservedRkey}`;
  const message = (error: unknown, fallback: string) => error instanceof Error && !(error instanceof RepoResponseError) ? error.message : fallback;

  onMount(() => {
    mounted = true;
    try { consent = localStorage.getItem(consentKey) === 'yes'; } catch {}
    void api.artist(owner).then(value => { if (current()) artistName = creditName(value.display_name); }, () => {});
    void api.albums(owner, { limit: 50 }).then(value => {
      if (current()) albums = value.data.map(album => album.metadata.name ?? '');
    }, () => {});
    let last = '';
    const unsubscribe = uploadQueue.subscribe(() => {
      const progress = uploadQueue.snapshot().filter(job => job.owner === owner)
        .map(job => `${job.id}:${job.phase}:${Math.floor((job.progress ?? 0) * 20)}`).join();
      if (progress === last) return;
      last = progress;
      if (plan && !saving) void refresh();
    });
    void refresh();
    return () => { mounted = false; unsubscribe(); };
  });

  async function refresh(refetch = false) {
    if (!current()) return;
    const attempt = ++revision;
    try {
      const [nextPlan, creates, transfers] = await Promise.all([
        albumUploads.load(owner), pds.pendingCreates('track'), uploadStorage.load(owner), journal.refresh()
      ]);
      if (!current() || attempt !== revision) return;
      const previous = !refetch && plan?.id === nextPlan?.id ? songs : [];
      plan = nextPlan;
      const updated: Song[] = [];
      for (const slot of nextPlan?.slots ?? []) {
        if (!current() || attempt !== revision) return;
        const job = uploadQueue.snapshot().findLast(item => item.owner === owner && item.draftId === slot.id);
        if (job && uploadInProgress(job.phase)) {
          updated.push({ slot, state: 'working', detail: jobLine(job) });
        } else if (transfers.some(item => item.draftId === slot.id)) {
          updated.push({ slot, state: 'recover', detail: 'finish this song in upload recovery.' });
        } else {
          const known = previous.find((song): song is Extract<Song, { state: 'ready' }> => song.slot.id === slot.id && song.state === 'ready');
          const reference = known?.reference ?? await organization.readUpload(address(slot));
          if (reference) updated.push({ slot, state: 'ready', reference });
          else if (draftInRecovery(slot, creates)) updated.push({ slot, state: 'recover', detail: 'finish this song in upload recovery.' });
          else updated.push({ slot, state: 'choose', detail: job?.phase === 'failed' ? `upload didn’t finish. choose ${slot.audio.name} to try again.` : `choose ${slot.audio.name} again.` });
        }
      }
      if (current() && attempt === revision) {
        songs = updated;
        statusProblem = '';
      }
    } catch {
      if (current() && attempt === revision) statusProblem = 'could not check the album upload. try again.';
    } finally {
      if (current() && attempt === revision) loading = false;
    }
  }

  function chooseFiles(input: HTMLInputElement) {
    const additions: Selected[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(input.files ?? [])) {
      try {
        canonicalAudioType(file);
        additions.push({ key: crypto.randomUUID(), file, title: file.name.replace(/\.[^.]+$/, '').trim().slice(0, 256) || file.name.slice(0, 256) });
      } catch (failure) { rejected.push(`${file.name} — ${message(failure, 'could not open the file.')}`); }
    }
    input.value = '';
    if (selections.length + additions.length > 500) {
      selectionProblem = 'an album can hold up to 500 songs.';
      return;
    }
    selections = [...selections, ...additions];
    selectionProblem = rejected.join(' ');
  }

  function move(from: number, to: number) {
    const entries = [...selections];
    [entries[from], entries[to]] = [entries[to], entries[from]];
    selections = entries;
  }

  async function start(event: SubmitEvent) {
    event.preventDefault();
    if (!current() || loading || saving || statusProblem || plan || blocked || coverPending || !selections.length
      || selections.some(item => !item.title.trim()) || (usesStorage && !consent)) return;
    saving = true;
    problem = '';
    try {
      const title = albumName(name);
      const signIn = usesStorage && !account.uploadStorage;
      const entries = selections.map(item => ({
        id: item.key, reservedRkey: TID.nextStr(),
        input: { file: item.file, title: item.title.trim(), artist, album: title }
      }));
      await albumUploads.withLock(owner, async () => {
        if (!current()) return;
        if (await albumUploads.load(owner)) throw new Error('finish the album upload already on this device first.');
        const slots = entries.map(({ input, id, reservedRkey }) => ({
          ...queuedUploadDraft(input, owner, id, reservedRkey), reservedRkey
        }));
        const saved: AlbumUploadPlan = { owner, id: crypto.randomUUID(), name: title, coverName: cover?.name, slots };
        if (!current()) return;
        await albumUploads.add(saved);
        if (usesStorage) { try { localStorage.setItem(consentKey, 'yes'); } catch {} }
        if (signIn) return;
        for (const { input, id, reservedRkey } of entries) {
          if (!current()) return;
          await uploadQueue.add(input, { owner, id, reservedRkey });
        }
      });
      if (signIn && current()) await goto(signInPath);
    } catch (failure) {
      if (current()) problem = message(failure, 'could not start the album upload.');
    } finally {
      if (current()) { saving = false; await refresh(); }
    }
  }

  async function reattach(slot: AlbumUploadSlot, file?: File) {
    if (!file || !plan || !current() || saving) return;
    const planId = plan.id;
    saving = true;
    problem = '';
    try {
      const input = reattachQueuedUpload(slot, file);
      if (needsPlyrStorage(file) && !account.uploadStorage) throw new Error('sign in again to allow plyr storage.');
      await albumUploads.withLock(owner, async () => {
        if ((await albumUploads.load(owner))?.id !== planId) throw new Error('this album upload has already changed. refresh and try again.');
        const [reference, drafts, creates, transfers] = await Promise.all([
          organization.readUpload(address(slot)), queuedDrafts.load(owner), pds.pendingCreates('track'), uploadStorage.load(owner)
        ]);
        if (!current() || reference || draftInRecovery(slot, creates, transfers)) return;
        const draft = drafts.find(item => item.id === slot.id);
        if (draft) uploadQueue.reattach(draft, file);
        else await uploadQueue.add(input, slot);
      });
    } catch (failure) {
      if (current()) problem = message(failure, 'could not resume the song.');
    } finally {
      if (current()) { saving = false; await refresh(); }
    }
  }

  async function keepUnfinished(saved: AlbumUploadPlan, tracks: Reference[]) {
    const included = new Set(tracks.map(reference => reference.uri));
    const [creates, transfers] = await Promise.all([pds.pendingCreates('track'), uploadStorage.load(owner)]);
    for (const slot of saved.slots) {
      if (!current()) return;
      if (included.has(address(slot)) || draftInRecovery(slot, creates, transfers) || await queuedDrafts.has(slot)) continue;
      await queuedDrafts.put(slot);
    }
  }

  async function setAside() {
    if (!plan || !current() || saving || loading || statusProblem || working) return;
    const selected = plan;
    const tracks = ready;
    saving = true;
    problem = '';
    try {
      await albumUploads.withLock(owner, async () => {
        const saved = await albumUploads.load(owner);
        if (saved?.id !== selected.id) throw new Error('this album upload has already changed. refresh and try again.');
        await keepUnfinished(saved, tracks);
        if (!current()) return;
        await albumUploads.finish(saved);
        selections = [];
        cover = undefined;
        name = '';
        omitCover = false;
        confirming = false;
      });
    } catch (failure) {
      if (current()) problem = message(failure, 'could not set this album aside.');
    } finally {
      if (current()) { saving = false; await refresh(); }
    }
  }

  async function finish() {
    if (!plan || !current() || saving || loading || statusProblem || blocked || working || !ready.length || coverPending || coverMissing) return;
    const selected = plan;
    const tracks = ready;
    saving = true;
    problem = '';
    try {
      await albumUploads.withLock(owner, async () => {
        const saved = await albumUploads.load(owner);
        if (saved?.id !== selected.id) throw new Error('this album upload has already changed. refresh and try again.');
        if (!current()) return;
        await keepUnfinished(saved, tracks);
        if (!current()) return;
        const result = await organization.createFromUploads(selected.name, tracks, cover, {
          id: selected.id, handedOff: () => albumUploads.finish(selected)
        });
        if (!current()) return;
        savedUrl = resolve('/(app)/album/[id]', { id: albumIdFromUri(result.uri) });
        await journal.refresh();
        if (result.status !== 'indexed' || !current()) return;
        const accepted = journal.view.operations.find(operation => operation.uri === result.uri && operation.cid);
        if (accepted) await pds.dismissCreate(accepted).catch(() => {});
        if (current()) await goto(savedUrl);
      });
    } catch (failure) {
      if (current()) {
        problem = message(failure, 'could not save the album.');
        songs = [];
      }
    } finally {
      if (current()) { saving = false; await refresh(); }
    }
  }
</script>

<CollectionJournal {...journal.view} {pds} refresh={refresh} />
{#if statusProblem}<p role="alert">{statusProblem}</p>{/if}
{#if problem}<p role="alert">{problem}</p>{/if}
{#if loading}
  <Loading label="checking saved album uploads" inline />
{:else if savedUrl}
  <p role="status">album saved. it may take a moment to appear.</p>
  <a class="text-button" href={savedUrl}>view album</a>
{:else if plan}
  <div class="panel">
    <h2>{plan.name}</h2>
    <p role="status">{ready.length} of {plan.slots.length} songs uploaded</p>
    <ol>
      {#each songs as song (song.slot.id)}
        <li>
          <strong>{song.slot.title}</strong>
          <div class="subtle">{song.state === 'ready' ? 'uploaded' : song.detail}</div>
          {#if song.state === 'choose'}
            <label>original file for {song.slot.title}
              <input type="file" disabled={saving} onchange={event => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                void reattach(song.slot, file);
              }} />
            </label>
            {#if needsPlyrStorage(song.slot.audio) && !account.uploadStorage}
              <a href={signInPath}>sign in again</a>
            {/if}
          {:else if song.state === 'recover'}
            <a href={resolve('/(app)/upload')}>open upload recovery</a>
          {/if}
        </li>
      {/each}
    </ol>
    {#if coverMissing}
      <p class="subtle">choose {plan.coverName} again to include a cover.</p>
      <button type="button" class="text-button" onclick={() => { omitCover = true; }} disabled={saving}>continue without a cover</button>
    {/if}
    <AlbumCoverPicker bind:file={cover} bind:pending={coverPending} disabled={saving} />
    {#if ready.length && ready.length < plan.slots.length && !working}
      <p class="subtle">unfinished songs stay available in upload recovery.</p>
    {/if}
    <div class="actions">
      <button type="button" class="text-button primary" onclick={finish}
        disabled={saving || !!statusProblem || blocked || working || !ready.length || coverPending || coverMissing}>
        {saving ? 'saving…' : ready.length && ready.length < plan.slots.length ? `create album with ${ready.length} ${ready.length === 1 ? 'song' : 'songs'}` : 'create album'}
      </button>
      <button type="button" class="text-button" onclick={() => refresh(true)} disabled={saving}>refresh status</button>
      {#if !working && !confirming}
        <button type="button" class="text-button" onclick={() => { confirming = true; }} disabled={saving || !!statusProblem}>set aside album</button>
      {/if}
    </div>
    {#if confirming && !working}
      <p>uploaded songs stay in your music. unfinished songs stay in upload recovery.</p>
      <div class="actions">
        <button type="button" class="text-button" onclick={setAside} disabled={saving || !!statusProblem}>set aside this album</button>
        <button type="button" class="text-button" onclick={() => { confirming = false; }} disabled={saving}>cancel</button>
      </div>
    {/if}
  </div>
{:else}
  <form class="panel" onsubmit={start} inert={saving}>
    <label>album name <input bind:value={name} required maxlength="64" /></label>
    {#if name.trim() && albums.some(existing => existing.toLowerCase() === name.trim().toLowerCase())}
      <p class="subtle">you already have an album with this name.</p>
    {/if}
    <AlbumCoverPicker bind:file={cover} bind:pending={coverPending} disabled={saving} />
    <div class="song-picker">
      <strong>songs</strong>
      <span class="subtle">{PUBLIC_AUDIO_FORMATS.toLowerCase()}</span>
      <button type="button" class="text-button" onclick={() => songInput?.click()}>{selections.length ? 'add more songs' : 'choose songs'}</button>
      <input type="file" aria-label="audio files" hidden multiple bind:this={songInput} accept="audio/*,.aif,.aiff,.m4a,.mp3,.aac,.ogg,.opus,.wav,.flac,.webm"
        onchange={event => chooseFiles(event.currentTarget)} />
    </div>
    {#if selectionProblem}<p role="alert">{selectionProblem}</p>{/if}
    {#if selections.length}
      <OrderRows rows={selections} {move} remove={index => { selections = selections.filter((_, position) => position !== index); }}>
        {#snippet titleField(index)}
          <input aria-label={`title for song ${index + 1}`} bind:value={selections[index].title} required maxlength="256" />
        {/snippet}
      </OrderRows>
    {/if}
    {#if usesStorage}
      <p class="subtle">plyr stores these files and makes an mp3 for playback when needed. playback and downloads are public.</p>
      <label class="consent"><input type="checkbox" bind:checked={consent} /> use plyr storage</label>
    {/if}
    <button class="text-button primary" type="submit"
      disabled={!!statusProblem || blocked || coverPending || !name.trim() || !selections.length || selections.some(item => !item.title.trim()) || (usesStorage && !consent)}>
      {saving ? 'starting…' : usesStorage && !account.uploadStorage ? 'save album draft and sign in' : 'upload songs'}
    </button>
    {#if statusProblem}<button type="button" class="text-button" onclick={() => refresh(true)}>retry</button>{/if}
  </form>
{/if}

<style>
  .panel { display: grid; gap: 0.9rem; padding: 1rem; background: var(--surface); border: 1px solid var(--line); border-radius: 0.8rem; }
  label, .song-picker { display: grid; gap: 0.4rem; overflow-wrap: anywhere; }
  input:not([type='checkbox']) { width: 100%; min-width: 0; font: inherit; color: inherit; }
  input:not([type='file'], [type='checkbox']) { padding: 0.55rem; border: 1px solid var(--line); border-radius: 0.5rem; background: var(--bg); }
  input[type='file']::file-selector-button { min-height: 44px; }
  h2, p, li { overflow-wrap: anywhere; }
  .panel > ol { margin: 0; padding-inline-start: 1.4rem; }
  ol > li { padding-block: 0.5rem; border-bottom: 1px solid var(--line); }
  .consent, .actions { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; }
  .song-picker button { justify-self: start; }
  .primary { justify-self: start; background: var(--accent); color: var(--on-accent); padding-inline: 1rem; }
  .primary:hover { background: var(--accent); filter: brightness(1.1); }
</style>
