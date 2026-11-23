<script lang="ts">
  import { audioAccept } from '$lib/media/accept';
  import { TID } from '@atproto/common-web';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount, untrack } from 'svelte';
  import { albumIdFromUri } from '@plyr/next-core/api';
  import type { FeaturedArtist } from '@plyr/next-core/pds';
  import { ARTWORK_EDGE } from '@plyr/next-core/publishing/artwork-model';
  import { normalizeTrackTags } from '@plyr/next-core/publishing/track-tags';
  import { albumName } from '@plyr/next-core/collections/album-membership';
  import type { AlbumUploadPlan, AlbumUploadSlot } from '@plyr/next-core/publishing/album-upload-plan';
  import { albumTitles } from '@plyr/next-core/publishing/album-titles';
  import { creditName } from '@plyr/next-core/publishing/credit-name';
  import { draftInRecovery, queuedUploadDraft, reattachQueuedUpload } from '@plyr/next-core/publishing/queued-upload-draft';
  import { RepoResponseError } from '@plyr/next-core/publishing/repo-rpc';
  import { PUBLIC_AUDIO_FORMATS } from '@plyr/next-core/publishing/upload-model';
  import { jobLine, needsPlyrStorage, originalOnPds, uploadInProgress } from '@plyr/next-core/publishing/upload-queue-model';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth';
  import { authConfig } from '$lib/auth-config';
  import CollectionJournal from '$lib/collections/CollectionJournal.svelte';
  import { collectionJournal } from '$lib/collections/CollectionJournal.svelte.ts';
  import { canonicalAudioFile } from '$lib/media/audio-file';
  import { coverImage } from '$lib/media/cover-image';
  import { createPds } from '$lib/pds';
  import { albumUploads, queuedDrafts, uploadStorage } from '$lib/storage/upload-storage';
  import Artwork from '$lib/ui/Artwork.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import Loading from '$lib/ui/Loading.svelte';
  import FeatureInput from './FeatureInput.svelte';
  import TagInput from './TagInput.svelte';
  import { uploadQueue } from '$lib/upload';

  type Account = ReturnType<typeof auth.getAuth>;
  type Selected = { key: string; file: File; title: string; explicit: boolean; features: FeaturedArtist[]; open: boolean };
  type Reference = { uri: string; cid: string };
  type Song = { slot: AlbumUploadSlot; state: 'ready'; reference: Reference }
    | { slot: AlbumUploadSlot; state: 'working' | 'recover' | 'choose'; detail: string };

  // files and cover arrive from the upload page when several files were dropped at once
  let { account, owner, files, cover: dropped, startOver }: {
    account: Account; owner: NonNullable<Account['did']>; files?: File[]; cover?: File; startOver: () => void;
  } = $props();
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
  let coverInput = $state<HTMLInputElement>();
  let coverPreview = $state<string>();
  let coverProblem = $state('');
  let coverAttempt = 0;
  let tags = $state('');
  let autoTag = $state(false);
  let inFeeds = $state(true);
  let avatar = $state<string>();
  const tagProblem = $derived.by(() => {
    try { if (tags.trim()) normalizeTrackTags(tags.split('\n')); return ''; }
    catch (failure) { return message(failure, 'check the tags.'); }
  });
  let omitCover = $state(false);
  let albums = $state<string[]>([]);
  let artistName = $state<string>();
  let artist = $derived(artistName || account.handle || owner);
  let usesStorage = $derived(selections.some(item => needsPlyrStorage(item.file)));
  // agreeing is only asked when plyr.fm would hold a file's sole copy; smaller originals stay on the artist's PDS
  let soleCopies = $derived(selections.some(item => !originalOnPds(item.file)));
  const consentKey = $derived(`plyr-storage-consent:${owner}`);
  let consent = $state(false);
  let plan = $state.raw<AlbumUploadPlan>();
  let songs = $state.raw<Song[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let problem = $state('');
  let selectionProblem = $state('');
  let statusProblem = $state('');
  let savedUri = $state('');
  let confirming = $state(false);
  let journalReady = $state(false);
  const savedInJournal = $derived(journalReady && journal.view.operations.some(operation => !operation.archived && operation.uri === savedUri));
  let ready = $derived(songs.flatMap(song => song.state === 'ready' ? [song.reference] : []));
  let working = $derived(songs.some(song => song.state === 'working'));
  let blocked = $derived(journal.view.loading || !!journal.view.error || journal.view.operations.some(operation => !operation.archived));
  let coverMissing = $derived(!!plan?.coverName && !cover && !omitCover);
  const signInPath = resolve('/(app)/login') + '?return_to=%2Fupload%3Fmode%3Dalbum';

  const address = (slot: AlbumUploadSlot) => `at://${slot.owner}/${authConfig.NSID.track}/${slot.reservedRkey}`;
  const albumAddress = (saved: AlbumUploadPlan) => `at://${saved.owner}/${authConfig.NSID.list}/${saved.reservedRkey}`;
  const albumHref = (uri: string) => resolve('/(app)/album/[id]', { id: albumIdFromUri(uri) });
  const message = (error: unknown, fallback: string) => error instanceof Error && !(error instanceof RepoResponseError) ? error.message : fallback;

  onMount(() => {
    mounted = true;
    try { consent = localStorage.getItem(consentKey) === 'yes'; } catch {}
    void api.artist(owner).then(value => { if (current()) { artistName = creditName(value.display_name); avatar = value.avatar_url ?? undefined; } }, () => {});
    untrack(() => {
      if (files?.length) addFiles(files);
      if (dropped) void useCover(dropped);
    });
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

  async function readSavedAlbum(plan: AlbumUploadPlan) {
    return organization.read(albumAddress(plan)).catch((failure: unknown) => {
      if (failure instanceof RepoResponseError && failure.error === 'RecordNotFound') return null;
      throw failure;
    });
  }

  async function refresh(refetch = false) {
    if (!current()) return;
    const attempt = ++revision;
    journalReady = false;
    try {
      const [storedPlan, creates, transfers] = await Promise.all([
        albumUploads.load(owner), pds.pendingCreates('track'), uploadStorage.load(owner), journal.refresh()
      ]);
      if (!current() || attempt !== revision) return;
      if (journal.view.error) throw new Error(journal.view.error);
      let nextPlan = storedPlan;
      if (storedPlan) {
        const handedOff = journal.view.operations.some(operation => operation.draftId === storedPlan.id && operation.uri === albumAddress(storedPlan));
        const existing = !handedOff && (refetch || plan?.id !== storedPlan.id) ? await readSavedAlbum(storedPlan) : null;
        if (!current() || attempt !== revision) return;
        if (handedOff || existing) {
          await albumUploads.finish(storedPlan);
          nextPlan = undefined;
        }
        if (existing && current() && attempt === revision) savedUri = existing.uri;
      }
      if (!current() || attempt !== revision) return;
      journalReady = true;
      const previous = !refetch && plan?.id === nextPlan?.id ? songs : [];
      plan = nextPlan;
      const updated: Song[] = [];
      for (const slot of nextPlan?.slots ?? []) {
        if (!current() || attempt !== revision) return;
        const job = uploadQueue.snapshot().findLast(item => item.owner === owner && item.draftId === slot.id);
        if (job && uploadInProgress(job.phase)) {
          updated.push({ slot, state: 'working', detail: jobLine(job) });
        } else if (transfers.some(item => item.draftId === slot.id)) {
          updated.push({ slot, state: 'recover', detail: 'finish this track in upload recovery.' });
        } else {
          const known = previous.find((song): song is Extract<Song, { state: 'ready' }> => song.slot.id === slot.id && song.state === 'ready');
          const reference = known?.reference ?? await organization.readUpload(address(slot));
          if (reference) updated.push({ slot, state: 'ready', reference });
          else if (draftInRecovery(slot, creates)) updated.push({ slot, state: 'recover', detail: 'finish this track in upload recovery.' });
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

  $effect(() => {
    const url = cover && URL.createObjectURL(cover);
    coverPreview = url;
    if (url) return () => URL.revokeObjectURL(url);
  });

  async function useCover(picked: File) {
    const attempt = ++coverAttempt;
    coverPending = true;
    coverProblem = '';
    try {
      const image = await coverImage(picked, ARTWORK_EDGE);
      if (attempt === coverAttempt) { cover = image; omitCover = false; }
    } catch {
      if (attempt === coverAttempt) coverProblem = 'could not open this image. choose a different photo.';
    } finally {
      if (attempt === coverAttempt) coverPending = false;
    }
  }

  function clearCover() {
    coverAttempt += 1;
    coverPending = false;
    cover = undefined;
    coverProblem = '';
    if (coverInput) coverInput.value = '';
  }

  function chooseFiles(input: HTMLInputElement) {
    addFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  function addFiles(list: File[]) {
    const additions: Selected[] = [], rejected: string[] = [];
    const titles = albumTitles(list.map(file => file.name));
    for (const [index, file] of list.entries()) {
      try {
        additions.push({ key: crypto.randomUUID(), file: canonicalAudioFile(file), title: titles[index], explicit: false, features: [], open: false });
      } catch (failure) { rejected.push(`${file.name}: ${message(failure, 'could not open the file.')}`); }
    }
    if (selections.length + additions.length > 500) {
      selectionProblem = 'an album can hold up to 500 tracks.';
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
    if (!current() || loading || saving || statusProblem || plan || blocked || coverPending || tagProblem || !selections.length
      || selections.some(item => !item.title.trim()) || (soleCopies && !consent)) return;
    saving = true;
    problem = '';
    try {
      const title = albumName(name);
      const signIn = usesStorage && !account.uploadStorage;
      const entries = selections.map(item => ({
        id: item.key, reservedRkey: TID.nextStr(),
        input: {
          file: item.file, title: item.title.trim(), artist, album: title, tags: tags.trim() ? tags.split('\n') : undefined, autoTag,
          ...(item.features.length ? { features: item.features } : {}), ...(item.explicit ? { explicit: true } : {}), ...(inFeeds ? {} : { unlisted: true })
        }
      }));
      await albumUploads.withLock(owner, async () => {
        if (!current()) return;
        if (await albumUploads.load(owner)) throw new Error('finish the album upload already on this device first.');
        const slots = entries.map(({ input, id, reservedRkey }) => ({
          ...queuedUploadDraft(input, owner, id, reservedRkey), reservedRkey
        }));
        const saved: AlbumUploadPlan = { owner, id: crypto.randomUUID(), reservedRkey: TID.nextStr(), name: title, coverName: cover?.name, slots };
        if (!current()) return;
        await albumUploads.add(saved);
        if (soleCopies) { try { localStorage.setItem(consentKey, 'yes'); } catch {} }
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
      const audio = canonicalAudioFile(file);
      const input = reattachQueuedUpload(slot, audio);
      if (needsPlyrStorage(audio) && !account.uploadStorage) throw new Error('sign in again to allow plyr.fm storage.');
      await albumUploads.withLock(owner, async () => {
        if ((await albumUploads.load(owner))?.id !== planId) throw new Error('this album upload has already changed. refresh and try again.');
        const [reference, drafts, creates, transfers] = await Promise.all([
          organization.readUpload(address(slot)), queuedDrafts.load(owner), pds.pendingCreates('track'), uploadStorage.load(owner)
        ]);
        if (!current() || reference || draftInRecovery(slot, creates, transfers)) return;
        const draft = drafts.find(item => item.id === slot.id);
        if (draft) uploadQueue.reattach(draft, audio);
        else await uploadQueue.add(input, slot);
      });
    } catch (failure) {
      if (current()) problem = message(failure, 'could not resume the track.');
    } finally {
      if (current()) { saving = false; await refresh(); }
    }
  }

  async function keepUnfinished(saved: AlbumUploadPlan, tracks: Reference[]) {
    const included = new Set(tracks.map(reference => reference.uri));
    for (const slot of saved.slots) {
      if (!current()) return;
      if (included.has(address(slot))) continue;
      await queuedDrafts.withLock(slot, async () => {
        if (!current() || await queuedDrafts.has(slot)) return;
        const [creates, transfers, reference] = await Promise.all([
          pds.pendingCreates('track'), uploadStorage.load(owner), organization.readUpload(address(slot))
        ]);
        if (current() && !reference && !draftInRecovery(slot, creates, transfers)) await queuedDrafts.put(slot);
      });
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
        tags = '';
        autoTag = false;
        inFeeds = true;
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
        const uri = albumAddress(saved);
        const existing = await readSavedAlbum(saved);
        if (!current()) return;
        if (existing) {
          await albumUploads.finish(saved);
          savedUri = uri;
          return;
        }
        await keepUnfinished(saved, tracks);
        if (!current()) return;
        const result = await organization.createFromUploads(selected.name, tracks, cover, {
          id: selected.id, reservedRkey: selected.reservedRkey, handedOff: () => albumUploads.finish(selected)
        });
        if (!current()) return;
        savedUri = result.uri;
        await journal.refresh();
        if (result.status !== 'indexed' || !current()) return;
        const accepted = journal.view.operations.find(operation => operation.uri === result.uri && operation.cid);
        if (accepted) await pds.dismissCreate(accepted).catch(() => {});
        if (current()) await goto(albumHref(result.uri));
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

{#snippet coverSlot(disabled: boolean)}
  <div class="cover-slot">
    <button type="button" class="cover" class:empty={!coverPreview} {disabled} onclick={() => coverInput?.click()} aria-label={cover ? 'change album cover' : 'choose album cover'}>
      {#if coverPreview}
        <img src={coverPreview} alt="selected cover preview" width="320" height="320" />
        <span class="cover-chip"><Icon name="image" size={15} />change cover</span>
      {:else}
        <span class="cover-empty">
          <Icon name="image" size={30} stroke={1.6} />
          <b>{coverPending ? 'preparing your cover…' : 'add a cover'}</b>
          <small>optional · any photo or image</small>
        </span>
      {/if}
    </button>
    {#if cover}<button type="button" class="remove" {disabled} aria-label="remove cover" onclick={clearCover}><Icon name="x" size={16} /></button>{/if}
    <input type="file" hidden accept="image/*,.heic,.heif" bind:this={coverInput} {disabled}
      onchange={event => { const picked = event.currentTarget.files?.[0]; if (picked) void useCover(picked); }} />
    {#if coverProblem}<p class="problem" role="alert">{coverProblem}</p>{/if}
  </div>
{/snippet}

{#if journalReady}<CollectionJournal {...journal.view} {pds} refresh={refresh} />{/if}
{#if statusProblem}
  <p class="problem" role="alert">{statusProblem}</p>
  {#if !plan}<button type="button" class="text-button" onclick={() => refresh(true)}>retry</button>{/if}
{/if}
{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
{#if loading}
  <Loading label="checking saved album uploads" inline />
{:else if savedUri}
  {#if !savedInJournal}
    <p role="status">album saved. it may take a moment to appear.</p>
    <a class="text-button" href={albumHref(savedUri)}>view album</a>
  {/if}
{:else if plan}
  <div class="sheet">
    <div class="backdrop" aria-hidden="true">{#if coverPreview}<img src={coverPreview} alt="" />{/if}</div>
    <aside class="side">
      {@render coverSlot(saving)}
      {#if coverMissing}
        <p class="subtle small">choose {plan.coverName} again to include a cover.</p>
        <button type="button" class="chip action" onclick={() => { omitCover = true; }} disabled={saving}>continue without a cover</button>
      {/if}
    </aside>
    <div class="main">
      <div class="copy">
        <span class="kind">new album</span>
        <h2 class="name">{plan.name}</h2>
        <p class="subtle" role="status">{ready.length} of {plan.slots.length} tracks uploaded</p>
      </div>
      <ol class="tracks">
        {#each songs as song, index (song.slot.id)}
          <li class="track">
            <span class="number">{index + 1}</span>
            <div class="song">
              <b>{song.slot.title}</b>
              <small class:done={song.state === 'ready'}>{song.state === 'ready' ? 'uploaded' : song.detail}</small>
              {#if song.state === 'choose'}
                <label class="chip action file-pick">choose {song.slot.audio.name}
                  <input type="file" hidden aria-label={`original file for ${song.slot.title}`} accept={audioAccept()} disabled={saving} onchange={event => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    void reattach(song.slot, file);
                  }} />
                </label>
                {#if needsPlyrStorage(song.slot.audio) && !account.uploadStorage}<a href={signInPath}>sign in again</a>{/if}
              {:else if song.state === 'recover'}
                <a href={resolve('/(app)/upload')}>open upload recovery</a>
              {/if}
            </div>
            {#if song.state === 'ready'}<span class="tick"><Icon name="check" size={16} /></span>{/if}
          </li>
        {/each}
      </ol>
      {#if ready.length && ready.length < plan.slots.length && !working}
        <p class="subtle small">unfinished tracks stay available in upload recovery.</p>
      {/if}
      {#if confirming && !working}
        <div class="card">
          <p>uploaded tracks stay in your uploads. unfinished tracks stay in upload recovery.</p>
          <div class="actions">
            <button type="button" class="pill" onclick={setAside} disabled={saving || !!statusProblem}>set aside this album</button>
            <button type="button" class="pill quiet" onclick={() => { confirming = false; }} disabled={saving}>keep going</button>
          </div>
        </div>
      {/if}
    </div>
  </div>
  <div class="bar">
    <span class="hint">{working ? 'you can leave this page. the upload keeps going.' : ''}</span>
    {#if !working && !confirming}
      <button type="button" class="pill quiet" onclick={() => { confirming = true; }} disabled={saving || !!statusProblem}>set aside</button>
    {/if}
    <button type="button" class="pill quiet" onclick={() => refresh(true)} disabled={saving}>refresh</button>
    <button type="button" class="pill primary submit" onclick={finish}
      disabled={saving || !!statusProblem || blocked || working || !ready.length || coverPending || coverMissing}>
      {saving ? 'saving…' : ready.length && ready.length < plan.slots.length ? `make the album with ${ready.length} ${ready.length === 1 ? 'track' : 'tracks'}` : 'make the album'}
    </button>
  </div>
{:else}
  <form class="album-form" onsubmit={start} inert={saving}>
    <div class="sheet">
      <div class="backdrop" aria-hidden="true">{#if coverPreview}<img src={coverPreview} alt="" />{/if}</div>
      <aside class="side">
        {@render coverSlot(saving)}
        <div class="meta">
          <span class="chip strong">{selections.length} {selections.length === 1 ? 'track' : 'tracks'}</span>
          <button type="button" class="chip action" onclick={startOver}><Icon name="x" size={15} />start over</button>
        </div>
        {#if usesStorage}
          {#if soleCopies}
            <label class="consent"><input type="checkbox" bind:checked={consent} /><span><b>use plyr.fm storage</b> files over 100 MB are more than a track can keep on your PDS, so plyr.fm keeps those. playback and downloads are public.</span></label>
          {:else}
            <p class="consent note"><span><b>your PDS keeps the originals</b> plyr.fm adds an mp3 copy where needed so they play everywhere. playback and downloads are public.</span></p>
          {/if}
        {/if}
      </aside>
      <div class="main">
        <div class="copy">
          <span class="kind">new album</span>
          <label class="title">
            <input bind:value={name} aria-label="album name" required maxlength="64" placeholder="name this album" />
            <Icon name="edit" size={18} />
          </label>
          <p class="owner"><span class="avatar"><Artwork src={avatar} size={24} fallbackIcon="user" /></span>posts to your profile as {artist}</p>
          {#if name.trim() && albums.some(existing => existing.toLowerCase() === name.trim().toLowerCase())}
            <p class="subtle small">you already have an album with this name.</p>
          {/if}
        </div>

        <section class="card">
          <header class="head"><h3>tracks</h3><span class="subtle small">{PUBLIC_AUDIO_FORMATS.toLowerCase()}</span></header>
          {#if selections.length}
            <ol class="tracks">
              {#each selections as item, index (item.key)}
                <li class="track editable">
                  <span class="number">{index + 1}</span>
                  <input class="track-title" aria-label={`title for track ${index + 1}`} bind:value={selections[index].title} required maxlength="256" />
                  <div class="controls">
                    <button type="button" class="icon" aria-label={`move ${item.title} up`} disabled={index === 0} onclick={() => move(index, index - 1)}><span class="up"><Icon name="down" size={18} /></span></button>
                    <button type="button" class="icon" aria-label={`move ${item.title} down`} disabled={index + 1 === selections.length} onclick={() => move(index, index + 1)}><Icon name="down" size={18} /></button>
                    <button type="button" class="icon" aria-label={`remove ${item.title}`} onclick={() => { selections = selections.filter((_, position) => position !== index); }}><Icon name="x" size={18} /></button>
                  </div>
                  <div class="extra">
                    <div class="tags">
                      <button type="button" class="mini" aria-pressed={item.explicit} onclick={() => { selections[index].explicit = !item.explicit; }}>explicit</button>
                      <button type="button" class="mini" aria-expanded={item.open} onclick={() => { selections[index].open = !item.open; }}>
                        {item.features.length ? `featuring ${item.features.map(feature => feature.displayName || feature.handle || feature.did).join(', ')}` : 'add featuring'}
                      </button>
                    </div>
                    {#if item.open}<FeatureInput bind:value={selections[index].features} {owner} />{/if}
                  </div>
                </li>
              {/each}
            </ol>
          {/if}
          <button type="button" class="pill add" onclick={() => songInput?.click()}><Icon name="plus" size={17} />{selections.length ? 'add more tracks' : 'choose tracks'}</button>
          <input type="file" aria-label="audio files" hidden multiple bind:this={songInput} accept={audioAccept()} onchange={event => chooseFiles(event.currentTarget)} />
          {#if selectionProblem}<p class="problem" role="alert">{selectionProblem}</p>{/if}
        </section>

        <section class="card">
          <header class="head"><h3>every track</h3></header>
          <TagInput bind:value={tags} />
          {#if tagProblem}<p class="problem" role="alert">{tagProblem}</p>{/if}
          <label class="switch">
            <span><b>auto-tag with recommended genres</b><small>we listen once each track is up and add a few genre tags. you can remove them later.</small></span>
            <input type="checkbox" role="switch" bind:checked={autoTag} />
          </label>
          <label class="switch">
            <span><b>show in feeds</b><small>off keeps the tracks out of latest and top. they stay on your profile and in search.</small></span>
            <input type="checkbox" role="switch" bind:checked={inFeeds} />
          </label>
          <p class="subtle small">albums are open to everyone, and anyone can download the tracks.</p>
        </section>
      </div>
    </div>
    <div class="bar">
      <span class="hint rights">by uploading you confirm you have the rights to share these.</span>
      <button class="pill primary submit" type="submit"
        disabled={!!statusProblem || blocked || coverPending || !!tagProblem || !name.trim() || !selections.length || selections.some(item => !item.title.trim()) || (soleCopies && !consent)}>
        <Icon name="upload" size={18} />{saving ? 'starting…' : usesStorage && !account.uploadStorage ? 'save and sign in' : 'upload album'}
      </button>
    </div>
  </form>
{/if}

<style>
  .problem { color: light-dark(#a3271f, #ff8f87); font-size: var(--t-14-4); overflow-wrap: anywhere; }
  .subtle { color: var(--muted); margin: 0; }
  .small { font-size: var(--t-13-6); }
  .album-form { display: grid; gap: 1rem; }
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
  .meta { display: flex; flex-wrap: wrap; gap: 0.45rem; }
  .chip { display: inline-flex; align-items: center; gap: 0.35rem; min-height: 2rem; max-width: 100%; padding: 0.3rem 0.8rem; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--raised) 85%, transparent); color: var(--muted); font-size: var(--t-13-6); }
  .chip.strong { color: var(--text); font-weight: 700; }
  .chip.action { color: var(--text); font-weight: 700; cursor: pointer; }
  .chip.action:hover { background: var(--hover); }
  .consent { margin: 0; display: flex; align-items: flex-start; gap: 0.7rem; padding: 0.75rem 0.9rem; border-radius: 0.75rem; background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(16px); color: var(--muted); font-size: var(--t-14-4); line-height: 1.4; cursor: pointer; }
  .consent.note { cursor: default; }
  .consent b { color: var(--text); margin-right: 0.25rem; }
  .consent input { width: 1.2rem; height: 1.2rem; flex: none; margin: 0.1rem 0 0; accent-color: var(--accent); }
  .copy { min-width: 0; display: grid; gap: 0.6rem; }
  .copy > * { max-width: 100%; min-width: 0; }
  .kind { color: var(--faint); font-size: var(--t-12); font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
  .name { font-size: clamp(1.75rem, 4.5vw, 3.1rem); letter-spacing: -0.03em; line-height: 1.15; overflow-wrap: anywhere; }
  .title { display: flex; align-items: center; gap: 0.5rem; border-bottom: 2px dashed color-mix(in srgb, var(--text) 25%, transparent); color: var(--faint); }
  .title:focus-within { border-bottom-color: var(--accent); border-bottom-style: solid; }
  .title input { flex: 1; min-width: 0; padding: 0.1rem 0; border: 0; outline: 0; background: none; color: var(--text); font-size: clamp(1.75rem, 4.5vw, 3.1rem); font-weight: 700; letter-spacing: -0.03em; line-height: 1.15; }
  .title input::placeholder { color: var(--faint); opacity: 0.7; }
  .owner { display: flex; align-items: center; gap: 0.5rem; margin: 0; color: var(--muted); }
  .avatar { width: 1.5rem; flex: none; border-radius: 50%; overflow: hidden; }
  .card { display: grid; gap: 1rem; align-content: start; padding: 1.1rem; background: var(--surface); border: 1px solid var(--line); border-radius: 0.9rem; min-width: 0; }
  .card p { margin: 0; }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
  .head h3 { font-size: var(--t-16); font-weight: 700; }
  .tracks { margin: 0; padding: 0; list-style: none; display: grid; }
  .track { display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.65rem 0; border-bottom: 1px solid var(--line); min-width: 0; }
  .track:last-child { border-bottom: 0; }
  .number { flex: none; width: 1.5rem; padding-top: 0.55rem; color: var(--faint); font-variant-numeric: tabular-nums; text-align: right; }
  .song { flex: 1; min-width: 0; display: grid; gap: 0.4rem; }
  .song b { padding-top: 0.5rem; overflow-wrap: anywhere; }
  .song small { color: var(--muted); font-size: var(--t-13-6); }
  .song small.done { color: var(--accent); }
  .file-pick { justify-self: start; }
  .tick { flex: none; padding-top: 0.55rem; color: var(--accent); }
  .track.editable { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; column-gap: 0.75rem; row-gap: 0.35rem; }
  .track.editable .number { padding-top: 0; }
  .extra { grid-column: 2 / -1; display: grid; gap: 0.5rem; min-width: 0; }
  .track-title { width: 100%; min-width: 0; padding: 0.5rem 0.65rem; border: 1px solid transparent; border-radius: 0.55rem; background: none; color: var(--text); font-weight: 700; }
  .track-title:hover { border-color: var(--line); }
  .track-title:focus { border-color: var(--accent); outline: 0; background: var(--bg); }
  .tags { display: flex; flex-wrap: wrap; gap: 0.35rem; padding-inline: 0.65rem; }
  .mini { min-height: 1.9rem; max-width: 100%; padding: 0 0.7rem; border: 1px solid var(--line); border-radius: 999px; background: none; color: var(--muted); font-size: var(--t-13-6); font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mini:hover { color: var(--text); background: var(--hover); }
  .mini[aria-pressed='true'] { background: var(--text); color: var(--bg); border-color: transparent; }
  .controls { display: flex; flex: none; }
  .icon { width: 2.5rem; height: 2.5rem; display: grid; place-items: center; border: 0; border-radius: 50%; background: none; color: var(--muted); }
  .icon:hover:not(:disabled) { background: var(--hover); color: var(--text); }
  .icon:disabled { opacity: 0.35; }
  .up { display: inline-flex; transform: rotate(180deg); }
  .switch { display: flex; align-items: center; justify-content: space-between; gap: 1rem; cursor: pointer; }
  .switch span { display: grid; gap: 0.15rem; }
  .switch small { color: var(--muted); font-size: var(--t-13-6); line-height: 1.35; }
  .switch input { appearance: none; flex: none; position: relative; width: 2.6rem; height: 1.5rem; margin: 0; border-radius: 999px; background: var(--hover); cursor: pointer; transition: background 0.15s; }
  .switch input::after { content: ''; position: absolute; left: 0.2rem; top: 0.2rem; width: 1.1rem; height: 1.1rem; border-radius: 50%; background: var(--faint); transition: transform 0.15s; }
  .switch input:checked { background: var(--accent); }
  .switch input:checked::after { transform: translateX(1.1rem); background: var(--on-accent); }
  .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .pill { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; min-height: 2.75rem; padding: 0 1.35rem; border: 0; border-radius: 999px; background: var(--raised); color: var(--text); font-weight: 700; }
  .pill:hover:not(:disabled) { background: var(--hover); }
  .pill.quiet { background: none; color: var(--muted); }
  .pill.add { justify-self: start; }
  .pill.primary { background: var(--accent); color: var(--on-accent); }
  .pill.primary:hover:not(:disabled) { background: var(--accent); filter: brightness(1.08); }
  .bar { position: sticky; bottom: calc(1rem + var(--bar-offset, 0px)); z-index: 3; display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.5rem 0.5rem 1rem; border-radius: 999px; background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(18px); box-shadow: 0 0.6rem 2rem rgb(0 0 0 / 0.14); }
  .hint { flex: 1; color: var(--faint); font-size: var(--t-13-6); }
  .rights { line-height: 1.3; font-size: var(--t-12-8); }
  .submit { min-height: 3rem; padding: 0 1.75rem; font-size: var(--t-16); }

  @media (max-width: 720px) {
    .sheet { grid-template-columns: minmax(0, 1fr); gap: 1rem; }
    .side { position: static; justify-items: center; text-align: center; }
    .backdrop { inset: -2rem -1rem auto; height: 26rem; }
    .cover-slot { width: min(15rem, 56vw); }
    .meta { justify-content: center; }
    .consent { text-align: left; }
    .copy { justify-items: center; text-align: center; }
    .title { width: 100%; }
    .title input { text-align: center; }
    .owner { justify-content: center; }
    .head .small { display: none; }
    .track.editable { column-gap: 0.4rem; }
    .number { width: 1rem; }
    .tags { padding-inline: 0.4rem; }
    .icon { width: 2.1rem; height: 2.1rem; }
    .bar { padding: 0.4rem 0.4rem 0.4rem 0.9rem; border-radius: 1.5rem; }
    .submit { padding: 0 1.2rem; }
    .bar .pill.quiet { padding: 0 0.8rem; }
  }
</style>
