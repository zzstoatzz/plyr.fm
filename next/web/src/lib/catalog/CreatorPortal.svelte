<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { Artist, ListSummary, Track } from '@plyr/next-core/api';
  import { trackArtwork } from '@plyr/next-core/artwork';
  import { accessLabel } from '@plyr/next-core/access/label';
  import { subscribeCatalogChanges } from '@plyr/next-core/catalog/changes';
  import { accessGroup, catalogDuration, facets, filterAlbums, filterTracks, matchRange, type AccessGroup, type OwnedSort } from '@plyr/next-core/catalog/owned';
  import { isPrivateTrack } from '@plyr/next-core/track-access';
  import { artistOffers, storeName, supportLink } from '@plyr/next-core/selling';
  import { auth } from '$lib/auth';
  import { authConfig } from '$lib/auth-config';
  import CollectionArtwork from '$lib/collections/CollectionArtwork.svelte';
  import { player } from '$lib/player.svelte';
  import { trackHref } from '$lib/tracks';
  import Artwork from '$lib/ui/Artwork.svelte';
  import Icon, { type IconName } from '$lib/ui/Icon.svelte';
  import Loading from '$lib/ui/Loading.svelte';
  import DeleteTrackSheet from './DeleteTrackSheet.svelte';
  import { loadAlbums, loadPrivateTracks, loadProfile, loadTracks, portalFor } from './portal';

  type Account = ReturnType<typeof auth.getAuth> & { did: string };
  let { account }: { account: Account } = $props();

  const did = untrack(() => account.did);
  const cached = untrack(() => portalFor(account));
  let profile = $state.raw<Artist | null | undefined>(cached.profile);
  let tracks = $state.raw<Track[] | undefined>(cached.tracks);
  let privateTracks = $state.raw<Track[]>(cached.privateTracks);
  let albums = $state.raw<ListSummary[] | undefined>(cached.albums);
  let tab = $state(cached.tab);
  let query = $state(cached.filter.query);
  let sort = $state<OwnedSort>(cached.filter.sort);
  let access = $state<AccessGroup | undefined>(cached.filter.access);
  let album = $state(cached.filter.album ?? '');
  let tag = $state(cached.filter.tag ?? '');
  let profileError = $state(false);
  let catalogError = $state(false);
  let privateError = $state(false);
  let loading = $state(false);
  let copied = $state(false);
  let search: HTMLInputElement;
  let tracksTab: HTMLButtonElement;
  let albumsTab: HTMLButtonElement;
  let deleteSheet: DeleteTrackSheet;
  let live = false;

  const label = (track: Track) => accessLabel(track, authConfig.AUDIO_SPACE_TYPE);
  const name = $derived(profile?.display_name || account.handle || 'your uploads');
  const publicPath = $derived('/u/' + encodeURIComponent(account.handle || did));
  const everything = $derived(tracks ? [...tracks, ...privateTracks] : undefined);
  const found = $derived(everything ? filterTracks(everything, { query, sort, access, album: album || undefined, tag: tag || undefined }, label) : []);
  const foundAlbums = $derived(albums ? filterAlbums(albums, query) : []);
  const options = $derived(facets(everything ?? [], label));
  const filtered = $derived(!!(query.trim() || access || album || tag));
  const totals = $derived(everything && {
    plays: everything.reduce((sum, track) => sum + (isPrivateTrack(track) ? 0 : track.metrics.play_count), 0),
    seconds: everything.reduce((sum, track) => sum + (track.metadata.duration_seconds ?? 0), 0)
  });
  const top = $derived(tracks?.filter(track => track.metrics.play_count > 0).reduce<Track | undefined>((best, track) => !best || track.metrics.play_count > best.metrics.play_count ? track : best, undefined));
  const support = $derived(supportLink(profile ?? undefined));
  const offers = $derived(artistOffers(profile ?? undefined).length);
  const paidStatus = $derived([support && storeName(support), offers && `${offers} buy ${offers === 1 ? 'link' : 'links'}`].filter(Boolean).join(' · '));

  $effect(() => {
    cached.tab = tab;
    cached.filter = { query, sort, access, album: album || undefined, tag: tag || undefined };
  });

  const current = () => live && auth.getAuth().rpc === account.rpc;

  async function load() {
    loading = true;
    await Promise.all([
      loadProfile(did).then(value => { if (current()) { profile = cached.profile = value; profileError = false; } }, () => { if (current()) profileError = true; }),
      loadTracks(did).then(value => { if (current()) { tracks = cached.tracks = value; catalogError = false; } }, () => { if (current()) catalogError = true; }),
      loadAlbums(did).then(value => { if (current()) albums = cached.albums = value; }, () => { if (current()) catalogError = true; }),
      loadPrivateTracks(account).then(value => { if (current()) { privateTracks = cached.privateTracks = value; privateError = false; } }, () => { if (current()) privateError = true; })
    ]);
    if (current()) loading = false;
  }

  onMount(() => {
    live = true;
    void load();
    const stop = subscribeCatalogChanges(did, () => void load());
    return () => { live = false; stop(); };
  });

  async function selectTab(next: typeof tab, focus = false) {
    tab = next;
    await tick();
    if (focus) (next === 'tracks' ? tracksTab : albumsTab)?.focus();
  }

  function tabKey(event: KeyboardEvent) {
    const next = event.key === 'Home' ? 'tracks' : event.key === 'End' ? 'albums'
      : event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? (tab === 'tracks' ? 'albums' : 'tracks') : undefined;
    if (!next) return;
    event.preventDefault();
    void selectTab(next, true);
  }

  function shortcut(event: KeyboardEvent) {
    if (event.key !== '/' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable]:not([contenteditable=false])')) return;
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault();
    search?.focus();
  }

  function clearFilters() {
    query = ''; access = undefined; album = ''; tag = '';
    search?.focus();
  }

  async function share() {
    const url = location.origin + publicPath;
    try {
      if (navigator.share) await navigator.share({ title: name, url });
      else { await navigator.clipboard.writeText(url); copied = true; }
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
        await navigator.clipboard.writeText(url).then(() => { copied = true; }, () => {});
      }
    }
  }

  function parts(text: string) {
    const range = matchRange(text, query);
    return range ? [text.slice(0, range[0]), text.slice(range[0], range[1]), text.slice(range[1])] : [text, '', ''];
  }

  function accessIcon(track: Track): IconName {
    const group = accessGroup(label(track));
    return group === 'everyone' ? 'globe' : group === 'link' ? 'link' : 'lock';
  }

  const shortLabel = (track: Track) => label(track) === 'anyone with the link' ? 'with the link' : label(track);
  const added = (track: Track) => {
    const date = new Date(track.metadata.created_at);
    const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
    if (days < 1) return 'today';
    if (days < 7) return days === 1 ? 'yesterday' : `${days} days ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(days > 300 ? { year: 'numeric' } : {}) }).toLocaleLowerCase();
  };
  const count = (n: number, word: string) => `${n.toLocaleString()} ${n === 1 ? word : word + 's'}`;
</script>

<svelte:window onkeydown={shortcut} />

{#snippet marked(text: string)}{@const [before, hit, after] = parts(text)}{before}{#if hit}<mark>{hit}</mark>{/if}{after}{/snippet}

<div class="portal">
  <header class="head">
    <a class="avatar" href={publicPath} aria-label={`${name}, view your page`}><Artwork src={profile?.avatar_url ?? undefined} size={84} eager fallbackIcon="user" /></a>
    <div class="who">
      <h1>{name}</h1>
      <p class="subtle">{#if account.handle}<span>@{account.handle}</span>{' '}<span aria-hidden="true">·</span>{' '}{/if}<a href={publicPath}>view your page</a></p>
    </div>
    {#if totals && everything}
      <dl class="numbers">
        <div><dt>plays</dt><dd>{totals.plays.toLocaleString()}</dd></div>
        <div><dt>{everything.length === 1 ? 'track' : 'tracks'}</dt><dd>{everything.length.toLocaleString()}</dd></div>
        {#if albums}<div class="albums-number"><dt>{albums.length === 1 ? 'album' : 'albums'}</dt><dd>{albums.length.toLocaleString()}</dd></div>{/if}
        <div><dt>of audio</dt><dd>{catalogDuration(totals.seconds)}</dd></div>
      </dl>
    {/if}
  </header>

  <nav class="actions" aria-label="your tools">
    <a class="action primary" href="/upload"><Icon name="upload" size={20} /><span>upload</span></a>
    <a class="action" href="/create-album"><Icon name="disc" size={20} /><span><span class="long">new{' '}</span>album</span></a>
    <a class="action" href="/get-paid" aria-label={`get paid${paidStatus ? ', ' + paidStatus : ', not set up yet'}`}>
      <Icon name="coin" size={20} /><span>get paid</span>
      {#if paidStatus}<small class="status"><i class="dot" aria-hidden="true"></i><span class="long">{paidStatus}</span></small>{/if}
    </a>
    <a class="action" href="/edit-profile"><Icon name="edit" size={20} /><span><span class="long">edit{' '}</span>profile</span></a>
    <button class="action" type="button" onclick={share}><Icon name="share" size={20} /><span>{copied ? 'copied' : 'share'}</span></button>
    <a class="action settings" href="/settings" aria-label="settings"><Icon name="settings" size={20} /></a>
  </nav>
  {#if profileError}
    <p class="state" role="alert">couldn’t load your profile. <button class="text-button" type="button" onclick={load} disabled={loading}>retry</button></p>
  {/if}

  <div class="body">
    <section class="stuff" aria-label="your uploads">
      <div class="search-row">
        <label class="search" class:active={filtered}>
          <Icon name="search" size={18} />
          <input bind:this={search} type="search" placeholder="search your tracks and albums" aria-label="search your tracks and albums" bind:value={query} autocomplete="off" />
          {#if query}<button class="clear" type="button" aria-label="clear search" onclick={() => { query = ''; search.focus(); }}><Icon name="x" size={16} /></button>
          {:else}<kbd class="key" aria-hidden="true">/</kbd>{/if}
        </label>
      </div>

      <div class="filters">
        <div class="tabs" role="tablist" aria-label="your catalog">
          <button id="creator-tracks-tab" bind:this={tracksTab} role="tab" aria-selected={tab === 'tracks'} aria-controls="creator-tracks" tabindex={tab === 'tracks' ? 0 : -1} onclick={() => selectTab('tracks')} onkeydown={tabKey}>tracks{#if everything}<span class="n">{' · '}{everything.length}</span>{/if}</button>
          <button id="creator-albums-tab" bind:this={albumsTab} role="tab" aria-selected={tab === 'albums'} aria-controls="creator-albums" tabindex={tab === 'albums' ? 0 : -1} onclick={() => selectTab('albums')} onkeydown={tabKey}>albums{#if albums}<span class="n">{' · '}{albums.length}</span>{/if}</button>
        </div>
        {#if tab === 'tracks'}
          {#if options.access.length > 1}
            {#each options.access as group (group.value)}
              <button type="button" class="chip" aria-pressed={access === group.value} onclick={() => { access = access === group.value ? undefined : group.value; }}>
                <Icon name={group.value === 'everyone' ? 'globe' : group.value === 'link' ? 'link' : 'lock'} size={14} />{group.label}
              </button>
            {/each}
          {/if}
          {#if options.albums.length}
            <select class="chip" class:on={album} aria-label="filter by album" bind:value={album}>
              <option value="">album</option>
              {#each options.albums as option (option.name)}<option value={option.name}>{option.name}</option>{/each}
            </select>
          {/if}
          {#if options.tags.length}
            <select class="chip" class:on={tag} aria-label="filter by tag" bind:value={tag}>
              <option value="">tag</option>
              {#each options.tags as option (option.name)}<option value={option.name}>{option.name}</option>{/each}
            </select>
          {/if}
          <select class="chip sort" aria-label="sort tracks" bind:value={sort}>
            <option value="recent">recent</option>
            <option value="title">title</option>
            <option value="plays">most played</option>
          </select>
        {/if}
      </div>

      <div id="creator-tracks" role="tabpanel" aria-labelledby="creator-tracks-tab" hidden={tab !== 'tracks'}>
        {#if query.trim() && foundAlbums.length}
          <h2 class="group"><span>albums</span></h2>
          <ul class="hits" aria-label="matching albums">
            {#each foundAlbums.slice(0, 3) as list (list.record.uri)}
              <li><a href={`/album/${list.id}`}>
                <span class="thumb"><CollectionArtwork {list} size={44} /></span>
                <span class="names"><b>{@render marked(list.metadata.name || 'untitled album')}</b><small>album · {count(list.metrics.member_count, 'track')}</small></span>
                <Icon name="chevron" size={18} />
              </a></li>
            {/each}
          </ul>
          <h2 class="group"><span>tracks</span>{#if everything}<span>{found.length} of {everything.length}</span>{/if}</h2>
        {/if}
        <div class="table">
          {#if found.length}
            <div class="row heading" aria-hidden="true"><span>title</span><span>album</span><span>who can listen</span><span class="n">plays</span><span class="n">likes</span><span>added</span><span></span></div>
          {/if}
          <ul aria-label="your tracks">
            {#each found as track (track.record.uri)}
              {@const hidden = isPrivateTrack(track)}
              <li class="row">
                <span class="title">
                  <span class="thumb"><Artwork src={trackArtwork(track)} size={44} /></span>
                  <span class="names">
                    <a href={trackHref(track)}>{@render marked(track.metadata.title)}</a>
                    <small class="wide">{(track.metadata.tags ?? []).join(', ')}</small>
                    <small class="narrow">
                      <span><Icon name={accessIcon(track)} size={12} />{shortLabel(track)}</span>
                      {#if !hidden}<span><Icon name="play" size={11} />{track.metrics.play_count}</span><span><Icon name="heart" size={12} />{track.metrics.like_count}</span>{/if}
                      {#if track.metadata.album}<span>{@render marked(track.metadata.album)}</span>{/if}
                    </small>
                  </span>
                </span>
                <span class="wide album">{#if track.metadata.album}{@render marked(track.metadata.album)}{:else}<span class="faint">—</span>{/if}</span>
                <span class="wide access"><Icon name={accessIcon(track)} size={14} />{shortLabel(track)}</span>
                <span class="wide n">{hidden ? '—' : track.metrics.play_count.toLocaleString()}</span>
                <span class="wide n">{hidden ? '—' : track.metrics.like_count.toLocaleString()}</span>
                <span class="wide faint">{added(track)}</span>
                <span class="row-actions">{#if !hidden}
                  <a class="icon-button" href={`/edit-track/${track.id}?return_to=%2Fportal`} aria-label={`edit ${track.metadata.title}`}><Icon name="edit" size={17} /></a>
                  <button class="icon-button" type="button" aria-label={`delete ${track.metadata.title}`} onclick={() => deleteSheet.open(track)}><Icon name="trash" size={17} /></button>
                {/if}</span>
              </li>
            {/each}
          </ul>
        </div>
        {#if everything && everything.length && !found.length}
          <p class="state" role="status">nothing matches. <button class="text-button" type="button" onclick={clearFilters}>clear search and filters</button></p>
        {/if}
        {#if privateError}
          <p class="state" role="alert">couldn’t load your private tracks. <button class="text-button" type="button" onclick={load} disabled={loading}>try again</button></p>
        {/if}
      </div>

      <div id="creator-albums" role="tabpanel" aria-labelledby="creator-albums-tab" hidden={tab !== 'albums'}>
        <ul class="hits albums" aria-label="your albums">
          {#each foundAlbums as list (list.record.uri)}
            <li><a href={`/album/${list.id}`}>
              <span class="thumb"><CollectionArtwork {list} size={44} /></span>
              <span class="names"><b>{@render marked(list.metadata.name || 'untitled album')}</b><small>{count(list.metrics.member_count, 'track')}{#if list.metrics.total_plays} · {count(list.metrics.total_plays, 'play')}{/if}</small></span>
              <Icon name="chevron" size={18} />
            </a></li>
          {/each}
        </ul>
        {#if albums && !albums.length}<p class="state">no albums yet. <a href="/create-album">make one</a> from what you've uploaded.</p>
        {:else if albums && !foundAlbums.length}<p class="state" role="status">no albums match “{query.trim()}”.</p>{/if}
      </div>

      {#if catalogError}
        <p class="state" role="alert">couldn’t load your uploads. <button class="text-button" type="button" onclick={load} disabled={loading}>retry</button></p>
      {:else if !everything}
        <Loading label="loading your uploads" inline />
      {:else if !everything.length && tab === 'tracks'}
        <p class="state">nothing uploaded yet. <a href="/upload">upload your first track</a>.</p>
      {/if}
    </section>

    <aside class="rail" aria-label="at a glance">
      {#if top}
        <h2>your top track</h2>
        <div class="card top">
          <a class="thumb" href={trackHref(top)} tabindex="-1" aria-hidden="true"><Artwork src={trackArtwork(top)} size={56} /></a>
          <span class="names"><a href={trackHref(top)}>{top.metadata.title}</a><small>{count(top.metrics.play_count, 'play')} · {count(top.metrics.like_count, 'like')}</small></span>
          <button class="play" type="button" aria-label={`play ${top.metadata.title}`} onclick={() => player.play(top, [top], name)}><Icon name="play" size={16} /></button>
        </div>
      {/if}
      {#if albums?.length}
        <h2>albums <a href="/create-album">new album</a></h2>
        <ul class="card list">
          {#each albums.slice(0, 5) as list (list.record.uri)}
            <li><a href={`/album/${list.id}`}><span class="thumb"><CollectionArtwork {list} size={40} /></span><span class="names"><b>{list.metadata.name || 'untitled album'}</b><small>{count(list.metrics.member_count, 'track')}</small></span></a></li>
          {/each}
        </ul>
        {#if albums.length > 5}<button class="text-button more" type="button" onclick={() => selectTab('albums')}>all {albums.length} albums</button>{/if}
      {/if}
      {#if options.tags.length}
        <h2>your tags</h2>
        <div class="tags">
          {#each options.tags.slice(0, 12) as option (option.name)}
            <button type="button" class="chip" aria-pressed={tag === option.name} onclick={() => { tag = tag === option.name ? '' : option.name; tab = 'tracks'; }}>{option.name}</button>
          {/each}
        </div>
      {/if}
    </aside>
  </div>
  <DeleteTrackSheet bind:this={deleteSheet} ondeleted={track => {
    tracks = cached.tracks = tracks?.filter(item => item.record.uri !== track.record.uri);
    privateTracks = cached.privateTracks = privateTracks.filter(item => item.record.uri !== track.record.uri);
  }} />
</div>

<style>
  .portal { container: portal / inline-size; max-width: 76rem; }
  .head { display: flex; align-items: center; gap: 1.25rem; }
  .avatar { width: 5.25rem; flex: 0 0 5.25rem; border-radius: 50%; overflow: hidden; }
  .who { flex: 1; min-width: 0; }
  h1 { font-size: clamp(1.5rem, 4vw, 2.1rem); line-height: 1.15; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
  .who p { margin-top: 0.2rem; }
  .who a { color: var(--accent); }
  .numbers { display: flex; margin: 0; border: 1px solid var(--line); border-radius: 0.9rem; background: var(--surface); overflow: hidden; }
  .numbers div { display: flex; flex-direction: column-reverse; padding: 0.55rem 1.1rem; min-width: 5.75rem; border-inline-end: 1px solid var(--line); }
  .numbers div:last-child { border-inline-end: 0; }
  .numbers dd { margin: 0; font-size: 1.35rem; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.2; }
  .numbers dt { color: var(--muted); font-size: var(--t-12-8); }

  .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 1.25rem 0 1.5rem; align-items: center; }
  .action { display: inline-flex; align-items: center; gap: 0.55rem; min-height: 2.9rem; padding: 0 0.95rem; border: 1px solid var(--line); border-radius: 0.75rem; background: var(--surface); color: var(--text); font-weight: 700; white-space: nowrap; }
  .action:hover { background: var(--hover); text-decoration: none; }
  .action :global(svg) { color: var(--accent); flex: none; }
  .action.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .action.primary :global(svg) { color: var(--on-accent); }
  .action.primary:hover { background: var(--accent); filter: brightness(1.08); }
  .action.settings { margin-inline-start: auto; width: 2.9rem; padding: 0; justify-content: center; }
  .action.settings :global(svg) { color: var(--muted); }
  .status { display: inline-flex; align-items: center; gap: 0.35rem; color: var(--muted); font-weight: 400; font-size: var(--t-13-6); }
  .dot { width: 0.45rem; height: 0.45rem; border-radius: 50%; background: #4fc37a; flex: none; }

  .body { display: grid; grid-template-columns: minmax(0, 1fr) 15.5rem; gap: 1.75rem; align-items: start; }
  .search-row { display: flex; gap: 0.5rem; }
  .search { flex: 1; min-width: 0; display: flex; align-items: center; gap: 0.6rem; min-height: 2.9rem; padding: 0 0.6rem 0 0.85rem; border: 1px solid var(--line); border-radius: 0.75rem; background: var(--surface); color: var(--muted); }
  .search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
  .search input { flex: 1; min-width: 0; border: 0; background: none; color: var(--text); font-size: max(16px, 1rem); outline: none; padding: 0.5rem 0; }
  .search input::-webkit-search-cancel-button { display: none; }
  .key { font-family: inherit; font-size: var(--t-12); color: var(--muted); border: 1px solid var(--line); border-radius: 0.3rem; padding: 0 0.4rem; }
  .clear { display: grid; place-items: center; width: 2.25rem; height: 2.25rem; border: 0; border-radius: 50%; background: none; color: var(--muted); }
  .clear:hover { background: var(--hover); }
  .chip.sort { margin-inline-start: auto; color: var(--text); }

  .filters { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin: 0.65rem 0 0.4rem; }
  .tabs { display: flex; padding: 0.2rem; border-radius: 0.7rem; background: var(--raised); margin-inline-end: 0.35rem; }
  .tabs button { border: 0; border-radius: 0.55rem; padding: 0.4rem 0.8rem; background: none; color: var(--muted); font-size: var(--t-14); }
  .tabs button[aria-selected='true'] { background: var(--surface); color: var(--text); font-weight: 700; box-shadow: 0 1px 3px rgb(0 0 0 / 0.18); }
  .chip { display: inline-flex; align-items: center; gap: 0.35rem; min-height: 2.1rem; padding: 0 0.75rem; border: 1px solid var(--line); border-radius: 999px; background: none; color: var(--muted); font-size: var(--t-14); max-width: 12rem; }
  .chip:hover { background: var(--hover); }
  .chip[aria-pressed='true'], .chip.on { color: var(--text); background: color-mix(in srgb, var(--accent) 18%, transparent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
  select.chip { appearance: auto; }
  /* a select under 16px makes iOS zoom the page when it opens */
  @media (hover: none) { select.chip { font-size: max(16px, 1rem); } }

  .group { display: flex; justify-content: space-between; font-size: var(--t-13-6); font-weight: 400; color: var(--muted); margin: 0.9rem 0.15rem 0.4rem; }
  .hits { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
  .hits a { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0.65rem; border: 1px solid var(--line); border-radius: 0.75rem; background: var(--surface); color: var(--text); }
  .hits a:hover { background: var(--hover); text-decoration: none; }
  .hits.albums { margin-top: 0.4rem; }
  .names { display: grid; flex: 1; min-width: 0; }
  .names b, .names a { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
  .names small { color: var(--muted); font-size: var(--t-12-8); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .thumb { width: 2.75rem; flex: 0 0 2.75rem; border-radius: 0.4rem; overflow: hidden; }
  mark { background: color-mix(in srgb, var(--accent) 28%, transparent); color: inherit; border-radius: 0.2rem; }

  .table ul { list-style: none; margin: 0; padding: 0; }
  .row { display: grid; grid-template-columns: minmax(0, 1fr) 7rem 8.5rem 3.25rem 3rem 5.5rem 4.75rem; gap: 0.6rem; align-items: center; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--line); color: var(--muted); font-size: var(--t-14); }
  .row.heading { font-size: var(--t-12-8); padding-block: 0.6rem 0.45rem; }
  li.row:hover, li.row:focus-within { background: var(--hover); border-radius: 0.6rem; }
  .row .n { text-align: end; font-variant-numeric: tabular-nums; }
  .title { display: flex; align-items: center; gap: 0.7rem; min-width: 0; }
  .album, .access { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .access { display: inline-flex; align-items: center; gap: 0.35rem; }
  .faint { color: var(--muted); opacity: 0.8; }
  .narrow { display: none !important; }
  .row-actions { display: flex; justify-content: flex-end; opacity: 0; }
  li.row:hover .row-actions, li.row:focus-within .row-actions { opacity: 1; }
  @media (hover: none) { .row-actions { opacity: 1; } }

  .rail h2 { display: flex; justify-content: space-between; align-items: baseline; font-size: var(--t-15); margin: 0 0 0.5rem; }
  .rail h2 a { font-size: var(--t-13-6); font-weight: 400; color: var(--accent); }
  .card { border: 1px solid var(--line); border-radius: 0.9rem; background: var(--surface); padding: 0.65rem; margin: 0 0 1.25rem; }
  .top { display: flex; align-items: center; gap: 0.7rem; }
  .top .thumb { width: 3.5rem; flex-basis: 3.5rem; }
  .play { display: grid; place-items: center; width: 2.4rem; height: 2.4rem; flex: none; border: 0; border-radius: 50%; background: var(--accent); color: var(--on-accent); }
  .list { list-style: none; padding-block: 0.3rem; }
  .list a { display: flex; align-items: center; gap: 0.65rem; padding: 0.35rem 0; color: var(--text); }
  .list a:hover { text-decoration: none; }
  .list a:hover b { text-decoration: underline; }
  .list .thumb { width: 2.5rem; flex-basis: 2.5rem; }
  .more { margin: -0.75rem 0 1.25rem; color: var(--accent); }
  .tags { display: flex; flex-wrap: wrap; gap: 0.4rem; }

  @container portal (max-width: 64rem) {
    .row { grid-template-columns: minmax(0, 1fr) 6rem 3.25rem 3rem 4.75rem; }
    .row > :nth-child(3), .row > :nth-child(6) { display: none; }
  }
  @container portal (max-width: 52rem) {
    .body { grid-template-columns: minmax(0, 1fr); }
    .rail { display: none; }
    .row { grid-template-columns: minmax(0, 1fr) 6rem 3.25rem 3rem 4.75rem; }
  }
  @container portal (max-width: 40rem) {
    .head { gap: 0.9rem; flex-wrap: wrap; }
    .avatar { width: 3.75rem; flex-basis: 3.75rem; }
    .numbers { flex-basis: 100%; display: grid; grid-template-columns: repeat(3, 1fr); }
    .numbers div { min-width: 0; padding: 0.45rem 0.8rem; }
    .numbers .albums-number { display: none; }
    .numbers dd { font-size: 1.2rem; }
    .actions { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.4rem; margin: 0.75rem 0 1.1rem; }
    .action { flex-direction: column; justify-content: center; gap: 0.3rem; min-height: 4rem; padding: 0.4rem 0.2rem; font-size: var(--t-12-8); border-radius: 0.9rem; position: relative; }
    .action .long { display: none; }
    .status { position: absolute; top: 0.45rem; right: 0.5rem; }
    .action.settings { display: none; }
    .filters { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; margin-inline: -1rem; padding-inline: 1rem; }
    .filters > * { flex: none; }
    .chip.sort { margin-inline-start: 0; }
    .row { grid-template-columns: minmax(0, 1fr) auto; padding-inline: 0; }
    li.row:hover, li.row:focus-within { background: none; }
    .row.heading, .wide { display: none !important; }
    .narrow { display: flex !important; gap: 0.6rem; }
    .narrow span { display: inline-flex; align-items: center; gap: 0.2rem; }
    .row-actions { opacity: 1; }
  }
</style>
