<script lang="ts">
  import { trackHref } from '$lib/tracks';
  import CollectionArtwork from '$lib/collections/CollectionArtwork.svelte';
  import { beforeNavigate } from '$app/navigation';
  import { onMount, tick, untrack } from 'svelte';
  import { ApiError, type Artist, type Track } from '@plyr/next-core/api';
  import { trackArtwork } from '@plyr/next-core/artwork';
  import { accessLabel } from '@plyr/next-core/access/label';
  import { isPrivateTrack } from '@plyr/next-core/track-access';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth';
  import { authConfig } from '$lib/auth-config';
  import { privateMusic } from '$lib/private-library';
  import Artwork from '$lib/ui/Artwork.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import Loading from '$lib/ui/Loading.svelte';
  import { portalFor } from './portal';
  import SellCard from './SellCard.svelte';
  import DeleteTrackSheet from './DeleteTrackSheet.svelte';

  type Tab = 'tracks' | 'albums';
  let { account }: { account: ReturnType<typeof auth.getAuth> & { did: NonNullable<ReturnType<typeof auth.getAuth>['did']>; rpc: NonNullable<ReturnType<typeof auth.getAuth>['rpc']> } } = $props();

  const did = untrack(() => account.did);
  const owned = untrack(() => portalFor(did, account.rpc));
  let tab = $state<Tab>(untrack(() => owned.active));
  let tracks = $state.raw(owned.tracks.snapshot());
  let albums = $state.raw(owned.albums.snapshot());
  let profile = $state.raw<Artist | null>(null);
  let ownerTracks = $state.raw<Track[]>([]);
  let ownerCursor = $state<string>();
  let ownerLoading = $state(true);
  let profileError = $state(false);
  let profileLoading = $state(true);
  let ownerError = $state(false);
  let copied = $state(false);
  let tracksTab: HTMLButtonElement;
  let albumsTab: HTMLButtonElement;

  const name = $derived(profile?.display_name || account.handle || 'your uploads');
  let filter = $state('');
  let loadingAll = $state(false);
  let sort = $state<'recent' | 'title' | 'plays'>('recent');
  const matchingMusic = $derived.by(() => {
    const query = filter.trim().toLocaleLowerCase();
    return music.filter(track => !query || [track.metadata.title, track.metadata.album].some(value => value?.toLocaleLowerCase().includes(query)))
      .sort((a, b) => sort === 'title' ? a.metadata.title.localeCompare(b.metadata.title)
        : sort === 'plays' ? b.metrics.play_count - a.metrics.play_count : 0);
  });
  const publicPath = $derived('/u/' + encodeURIComponent(account.handle || did));
  let removed = $state<ReadonlySet<string>>(new Set());
  let deleteSheet: DeleteTrackSheet;
  const music = $derived([...tracks.data, ...ownerTracks].filter(track => !removed.has(track.record.uri)).sort((a, b) => b.metadata.created_at.localeCompare(a.metadata.created_at)));
  const catalog = $derived(tab === 'tracks' ? tracks : albums);
  let live = false;
  const current = () => live && auth.getAuth().rpc === account.rpc;

  onMount(() => {
    live = true;
    const stopTracks = owned.tracks.subscribe(() => { tracks = owned.tracks.snapshot(); });
    const stopAlbums = owned.albums.subscribe(() => { albums = owned.albums.snapshot(); });
    owned.tracks.connect();
    owned.albums.connect();
    owned[tab].activate(true);
    void loadProfile();
    void loadOwnerTracks();
    const restore = requestAnimationFrame(() => {
      if (owned.scroll[tab]) window.scrollTo({ top: owned.scroll[tab], behavior: 'instant' });
    });
    return () => {
      cancelAnimationFrame(restore);
      live = false;
      stopTracks();
      stopAlbums();
      owned.tracks.disconnect();
      owned.albums.disconnect();
    };
  });

  beforeNavigate(({ to }) => {
    if (to?.url.pathname !== '/portal') owned.scroll[tab] = window.scrollY;
  });

  async function loadProfile() {
    profileError = false;
    profileLoading = true;
    try {
      const result = await api.artist(did);
      if (current()) profile = result;
    } catch (failure) {
      if (current() && !(failure instanceof ApiError && failure.status === 404)) profileError = true;
    } finally { if (current()) profileLoading = false; }
  }

  async function loadOwnerTracks(cursor?: string) {
    ownerError = false;
    ownerLoading = true;
    try {
      if (!account.privatePublishing && !account.privateDeleting) return;
      const result = await privateMusic(account).list(cursor);
      if (current()) {
        const previous = cursor ? ownerTracks : [];
        const known = new Set(previous.map(track => track.record.uri));
        ownerTracks = [...previous, ...result.tracks.filter(track => !known.has(track.record.uri))];
        ownerCursor = result.cursor;
      }
    } catch {
      if (current()) ownerError = true;
    } finally { if (current()) ownerLoading = false; }
  }

  async function loadAllTracks() {
    if (loadingAll) return;
    loadingAll = true;
    try {
      while (current() && tab === 'tracks') {
        const cursor = tracks.cursor;
        const privateCursor = ownerCursor;
        if ((!cursor && !privateCursor) || tracks.error || ownerError || tracks.loading || ownerLoading) return;
        await Promise.all([cursor ? owned.tracks.more() : undefined, privateCursor ? loadOwnerTracks(privateCursor) : undefined]);
        if (cursor === tracks.cursor && privateCursor === ownerCursor) return;
      }
    } finally { loadingAll = false; }
  }

  async function selectTab(next: Tab, focus = false) {
    if (tab === next) return;
    owned.scroll[tab] = window.scrollY;
    owned[tab].activate(false);
    tab = owned.active = next;
    owned[next].activate(true);
    await tick();
    if (!current() || tab !== next) return;
    if (focus) (next === 'tracks' ? tracksTab : albumsTab)?.focus({ preventScroll: true });
    window.scrollTo({ top: owned.scroll[next], behavior: 'instant' });
  }

  function tabKey(event: KeyboardEvent) {
    const next = event.key === 'Home' ? 'tracks' : event.key === 'End' ? 'albums'
      : event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? (tab === 'tracks' ? 'albums' : 'tracks') : undefined;
    if (!next) return;
    event.preventDefault();
    void selectTab(next, true);
  }

  async function share() {
    const url = location.origin + publicPath;
    try {
      if (navigator.share) await navigator.share({ title: name, url });
      else { await navigator.clipboard.writeText(url); if (current()) copied = true; }
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
        await navigator.clipboard.writeText(url).then(() => { if (current()) copied = true; }, () => {});
      }
    }
  }

  function subtitle(track: Track) {
    const plays = track.metrics.play_count;
    return [accessLabel(track, authConfig.AUDIO_SPACE_TYPE), !isPrivateTrack(track) && `${plays} ${plays === 1 ? 'play' : 'plays'}`, track.metadata.album].filter(Boolean).join(' · ');
  }
</script>

<div class="portal">
  <a class="person" href={publicPath} aria-label={`${name}, view your public profile`}>
    <div class="avatar"><Artwork src={profile?.avatar_url ?? undefined} size={72} eager /></div>
    <div class="names"><h1>{name}</h1>{#if account.handle}<p class="subtle">@{account.handle}</p>{/if}</div>
    <Icon name="chevron" size={20} />
  </a>
  <div class="actions">
    <a class="text-button upload" href="/upload"><Icon name="upload" size={18} /> upload</a>
    <a class="text-button" href="/edit-profile">edit profile</a>
    <a class="text-button" href="/create-album">new album</a>
    <button class="icon-button" type="button" aria-label="Share profile" onclick={share}><Icon name="share" size={19} /></button>
    <a class="icon-button settings" href="/settings" aria-label="Settings"><Icon name="settings" size={20} /></a>
    {#if copied}<span class="subtle" role="status">link copied</span>{/if}
  </div>
  {#if profileError}
    <p class="state" role="alert">couldn’t load your profile.</p>
    <button class="text-button" onclick={loadProfile} disabled={profileLoading}>retry profile</button>
  {/if}

  <SellCard {did} />

  <div class="tabs" role="tablist" aria-label="Your catalog">
    <button id="creator-tracks-tab" bind:this={tracksTab} role="tab" aria-selected={tab === 'tracks'} aria-controls="creator-tracks" tabindex={tab === 'tracks' ? 0 : -1} onclick={() => selectTab('tracks')} onkeydown={tabKey}>tracks</button>
    <button id="creator-albums-tab" bind:this={albumsTab} role="tab" aria-selected={tab === 'albums'} aria-controls="creator-albums" tabindex={tab === 'albums' ? 0 : -1} onclick={() => selectTab('albums')} onkeydown={tabKey}>albums</button>
  </div>

  <div id="creator-tracks" role="tabpanel" aria-labelledby="creator-tracks-tab" hidden={tab !== 'tracks'}>
    <div class="catalog-filter">
      <input type="search" placeholder="filter your tracks" aria-label="Filter your tracks" bind:value={filter} />
      <select aria-label="Sort tracks" bind:value={sort}>
        <option value="recent">recent</option>
        <option value="title">title</option>
        <option value="plays">most played</option>
      </select>
    </div>
    {#if (filter.trim() || sort !== 'recent') && (tracks.cursor || ownerCursor)}
      <button class="text-button full-catalog" type="button" disabled={loadingAll || tracks.loading || ownerLoading} onclick={loadAllTracks}>
        {loadingAll ? 'loading the rest of your tracks…' : 'include the rest of your tracks'}
      </button>
    {/if}
    <ul aria-label="Your tracks">
      {#each matchingMusic as track (track.record.uri)}
        <li>
          <div class="thumb"><Artwork src={trackArtwork(track)} size={52} /></div>
          <div class="names">
            <a href={trackHref(track)}>{track.metadata.title}</a>
            <p class="subtle">{subtitle(track)}</p>
          </div>
          {#if !isPrivateTrack(track)}<div class="row-actions">
            <a class="icon-button" href={`/edit-track/${track.id}?return_to=%2Fportal`} aria-label={`edit ${track.metadata.title}`}><Icon name="edit" size={18} /></a>
            <button class="icon-button" type="button" aria-label={`delete ${track.metadata.title}`} onclick={() => deleteSheet.open(track)}><Icon name="trash" size={18} /></button>
          </div>{/if}
        </li>
      {/each}
    </ul>
    <DeleteTrackSheet bind:this={deleteSheet} ondeleted={track => { removed = new Set(removed).add(track.record.uri); }} />
    {#if music.length && !matchingMusic.length && !catalog.loading && !ownerLoading}
      <p class="state" role="status">{tracks.cursor || ownerCursor ? 'no matches in loaded tracks' : 'no matching tracks'}</p>
    {/if}
    {#if ownerError}
      <p class="state" role="alert">couldn’t load all your tracks.</p>
      <button class="text-button" onclick={() => loadOwnerTracks(ownerCursor)}>try again</button>
    {/if}
  </div>

  <div id="creator-albums" role="tabpanel" aria-labelledby="creator-albums-tab" hidden={tab !== 'albums'}>
    <ul aria-label="Your albums">
      {#each albums.data as album (album.record.uri)}
        <li>
          <div class="thumb"><CollectionArtwork list={album} size={52} /></div>
          <div class="names">
            <a href={`/album/${album.id}`}>{album.metadata.name || 'untitled album'}</a>
            <p class="subtle">{album.metrics.member_count} {album.metrics.member_count === 1 ? 'track' : 'tracks'}</p>
          </div>
        </li>
      {/each}
    </ul>
  </div>

  {#if catalog.loading || (tab === 'tracks' && ownerLoading && !music.length)}
    <Loading label="loading your uploads" inline />
  {:else if catalog.error}
    <p class="state" role="alert">{catalog.error}</p>
    <button class="text-button" onclick={() => owned[tab].retry()}>retry</button>
  {:else if tab === 'tracks' ? !music.length && !ownerError : !albums.data.length}
    <p class="state">{tab === 'tracks' ? 'no tracks yet.' : 'no albums yet.'}</p>
  {/if}
  {#if !catalog.loading && !catalog.error && (catalog.cursor || tab === 'tracks' && ownerCursor && !ownerError)}
    <button class="text-button" disabled={tab === 'tracks' && ownerLoading} onclick={() => {
      if (catalog.cursor) owned[tab].more();
      if (tab === 'tracks' && ownerCursor && !ownerError) void loadOwnerTracks(ownerCursor);
    }}>more {tab}</button>
  {/if}
</div>

<style>
  .portal { max-width: 52rem; }
  .person { display: flex; align-items: center; gap: 0.9rem; min-height: 5.25rem; }
  .person:hover { text-decoration: none; }
  .person:hover h1 { text-decoration: underline; }
  .avatar { width: 4.5rem; flex: 0 0 4.5rem; border-radius: 50%; }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin: 1rem 0; }
  .settings { margin-left: auto; }
  .upload { color: var(--on-accent); background: var(--accent); padding-inline: 0.85rem; }
  .upload:hover { background: var(--accent); filter: brightness(1.12); }
  .catalog-filter { display: flex; flex-wrap: wrap; gap: 0.5rem; padding-block: 0.75rem; }
  .full-catalog { margin-block-end: 0.5rem; color: var(--accent); }
  .catalog-filter input { flex: 1 1 11rem; min-width: 0; }
  .catalog-filter :is(input, select) { min-height: 2.75rem; padding-inline: 0.7rem; border-radius: 0.6rem; border: 1px solid var(--line); background: var(--surface); }
  .tabs { display: flex; gap: 0.2rem; border-bottom: 1px solid var(--line); }
  .tabs button { border: 0; border-radius: 0.5rem 0.5rem 0 0; padding: 0.7rem 1rem; background: none; color: var(--muted); }
  .tabs button[aria-selected='true'] { color: var(--text); box-shadow: inset 0 -2px var(--accent); }
  ul { list-style: none; padding: 0; margin: 0 0 0.65rem; }
  .row-actions { display: flex; flex: none; }
  li { display: flex; align-items: center; gap: 0.7rem; padding: 0.45rem 0; border-bottom: 1px solid var(--line); }
  .thumb { width: 3.25rem; flex: 0 0 3.25rem; border-radius: 0.35rem; }
  h1 { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; font-size: clamp(1.35rem, 4.8vw, 1.85rem); line-height: 1.25; }
  .names { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .names a { font-weight: 600; }
  @media (max-width: 480px) { .person { gap: 0.75rem; } }
</style>
