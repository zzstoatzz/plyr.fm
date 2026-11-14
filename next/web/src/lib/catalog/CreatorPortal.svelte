<script lang="ts">
  import { beforeNavigate } from '$app/navigation';
  import { onMount, tick, untrack } from 'svelte';
  import { ApiError, type Artist, type Track } from '$core/api';
  import { collectionArtwork, trackArtwork } from '$core/artwork';
  import { accessLabel } from '$core/access/label';
  import { isPrivateTrack } from '$core/track-access';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth';
  import { authConfig } from '$lib/auth-config';
  import { player } from '$lib/player.svelte';
  import { privateMusic } from '$lib/private-library';
  import Artwork from '$lib/ui/Artwork.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import Loading from '$lib/ui/Loading.svelte';
  import { portalFor } from './portal';

  type Tab = 'tracks' | 'albums';
  let { account }: { account: ReturnType<typeof auth.getAuth> & { did: NonNullable<ReturnType<typeof auth.getAuth>['did']>; rpc: NonNullable<ReturnType<typeof auth.getAuth>['rpc']> } } = $props();

  const did = untrack(() => account.did);
  const owned = untrack(() => portalFor(did, account.rpc));
  let tab = $state<Tab>(untrack(() => owned.active));
  let tracks = $state.raw(owned.tracks.snapshot());
  let albums = $state.raw(owned.albums.snapshot());
  let profile = $state.raw<Artist | null>(null);
  let privateTracks = $state.raw<Track[]>([]);
  let privateLoading = $state(true);
  let profileError = $state(false);
  let profileLoading = $state(true);
  let privateError = $state(false);
  let copied = $state(false);
  let tracksTab: HTMLButtonElement;
  let albumsTab: HTMLButtonElement;

  const name = $derived(profile?.display_name || account.handle || 'your music');
  const publicPath = $derived('/u/' + encodeURIComponent(account.handle || did));
  const music = $derived([...tracks.data, ...privateTracks].sort((a, b) => b.metadata.created_at.localeCompare(a.metadata.created_at)));
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
    void loadPrivate();
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

  async function loadPrivate() {
    privateError = false;
    privateLoading = true;
    try {
      if (!account.privatePublishing) return;
      const result = await privateMusic(account).list();
      if (current()) privateTracks = result.tracks;
    } catch {
      if (current()) privateError = true;
    } finally { if (current()) privateLoading = false; }
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
    <button class="icon-button" type="button" aria-label="Share profile" onclick={share}><Icon name="share" size={19} /></button>
    <a class="icon-button settings" href="/settings" aria-label="Settings"><Icon name="settings" size={20} /></a>
    {#if copied}<span class="subtle" role="status">link copied</span>{/if}
  </div>
  {#if profileError}
    <p class="state" role="alert">couldn’t load your profile.</p>
    <button class="text-button" onclick={loadProfile} disabled={profileLoading}>retry profile</button>
  {/if}

  <div class="tabs" role="tablist" aria-label="Your catalog">
    <button id="creator-tracks-tab" bind:this={tracksTab} role="tab" aria-selected={tab === 'tracks'} aria-controls="creator-tracks" tabindex={tab === 'tracks' ? 0 : -1} onclick={() => selectTab('tracks')} onkeydown={tabKey}>tracks</button>
    <button id="creator-albums-tab" bind:this={albumsTab} role="tab" aria-selected={tab === 'albums'} aria-controls="creator-albums" tabindex={tab === 'albums' ? 0 : -1} onclick={() => selectTab('albums')} onkeydown={tabKey}>albums</button>
  </div>

  <div id="creator-tracks" role="tabpanel" aria-labelledby="creator-tracks-tab" hidden={tab !== 'tracks'}>
    <ul aria-label="Your tracks">
      {#each music as track (track.record.uri)}
        <li>
          <div class="thumb"><Artwork src={trackArtwork(track)} size={52} /></div>
          <div class="names">
            {#if isPrivateTrack(track)}
              <button class="private-play" onclick={() => player.play(track, privateTracks)} aria-label={`Play ${track.metadata.title}`}>{track.metadata.title}</button>
            {:else}
              <a href={`/track/${track.id}`}>{track.metadata.title}</a>
            {/if}
            <p class="subtle">{subtitle(track)}</p>
          </div>
          <a class="icon-button" href={isPrivateTrack(track) ? '/private' : `/edit-track/${track.id}?return_to=%2Fportal`} aria-label={`${isPrivateTrack(track) ? 'manage' : 'edit'} ${track.metadata.title}`}><Icon name="edit" size={18} /></a>
        </li>
      {/each}
    </ul>
    {#if privateError}
      <p class="state" role="alert">couldn’t load your private tracks.</p>
      <button class="text-button" onclick={loadPrivate}>retry private tracks</button>
    {/if}
  </div>

  <div id="creator-albums" role="tabpanel" aria-labelledby="creator-albums-tab" hidden={tab !== 'albums'}>
    <ul aria-label="Your albums">
      {#each albums.data as album (album.record.uri)}
        <li>
          <div class="thumb"><Artwork src={collectionArtwork(album)} size={52} /></div>
          <div class="names">
            <a href={`/album/${album.id}`}>{album.metadata.name || 'untitled album'}</a>
            <p class="subtle">{album.metrics.member_count} {album.metrics.member_count === 1 ? 'track' : 'tracks'}</p>
          </div>
        </li>
      {/each}
    </ul>
  </div>

  {#if catalog.loading || (tab === 'tracks' && privateLoading && !music.length)}
    <Loading label="loading your music" inline />
  {:else if catalog.error}
    <p class="state" role="alert">{catalog.error}</p>
    <button class="text-button" onclick={() => owned[tab].retry()}>retry</button>
  {:else if !(tab === 'tracks' ? music.length : albums.data.length)}
    <p class="state">{tab === 'tracks' ? 'nothing here yet. upload something and it shows up here, open to everyone or just for you.' : 'no albums yet.'}</p>
  {/if}
  {#if catalog.cursor && !catalog.loading && !catalog.error}
    <button class="text-button" onclick={() => owned[tab].more()}>more {tab}</button>
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
  .tabs { display: flex; gap: 0.2rem; border-bottom: 1px solid var(--line); }
  .tabs button { border: 0; border-radius: 0.5rem 0.5rem 0 0; padding: 0.7rem 1rem; background: none; color: var(--muted); }
  .tabs button[aria-selected='true'] { color: var(--text); box-shadow: inset 0 -2px var(--accent); }
  ul { list-style: none; padding: 0; margin: 0 0 0.65rem; }
  li { display: flex; align-items: center; gap: 0.7rem; padding: 0.45rem 0; border-bottom: 1px solid var(--line); }
  .thumb { width: 3.25rem; flex: 0 0 3.25rem; border-radius: 0.35rem; }
  h1 { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; font-size: clamp(1.35rem, 4.8vw, 1.85rem); line-height: 1.25; }
  .names { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .names a, .private-play { font-weight: 600; }
  .private-play { text-align: left; padding: 0; border: 0; background: none; overflow-wrap: anywhere; }
  @media (max-width: 480px) { .person { gap: 0.75rem; } }
</style>
