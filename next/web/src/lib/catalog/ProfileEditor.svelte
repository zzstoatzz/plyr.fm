<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { beforeNavigate, goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { AwaitStatus } from '@plyr/next-core/api';
  import { BIO_GRAPHEMES, blueskyFace, graphemes, shownAvatar, type BlueskyFace } from '@plyr/next-core/profile-avatar';
  import { auth } from '$lib/auth';
  import { createPds } from '$lib/pds';
  import { avatarImage } from '$lib/media/avatar-image';
  import Artwork from '$lib/ui/Artwork.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import Loading from '$lib/ui/Loading.svelte';
  import { api } from '$lib/api';
  import { authConfig } from '$lib/auth-config';
  import { preferenceTransport } from '@plyr/next-core/preference-transport';
  import { normalizeLink } from '@plyr/next-core/selling';
  import { BACKDROP_COLORS, MAX_LINKS, backdropImage, linkName, readArtistPage, sameBackdrop, sameLinks, type ArtistPageSettings, type Backdrop, type ProfileLink } from '@plyr/next-core/artist-page';

  let { account }: { account: ReturnType<typeof auth.getAuth> } = $props();
  const pds = untrack(() => createPds(account));
  const profilePath = untrack(() => resolve('/(app)/u/[actor]', { actor: account.handle || account.did || '' }));
  type Profile = Awaited<ReturnType<typeof pds.myProfile>>;

  let profile = $state.raw<Profile>();
  let face = $state.raw<BlueskyFace>({});
  let bio = $state('');
  let file = $state<File | null>();
  let preview = $state<string>();
  let loading = $state(true);
  let readError = $state('');
  let writeError = $state('');
  let imageError = $state('');
  let pending = $state(false);
  let busy = $state(false);
  let saved = $state<AwaitStatus>();
  let latestRead = $state(false);
  let leaving = $state<string>();
  let menu = $state(false);
  let input = $state<HTMLInputElement>();
  let avatarField = $state<HTMLElement>();
  let avatarButton = $state<HTMLButtonElement>();
  let live = false;
  let generation = 0;
  // the page part (links, background) lives in plyr.fm settings, not the profile record
  type LinkDraft = { url: string; label: string; error?: string };
  let page = $state.raw<ArtistPageSettings>();
  let pageError = $state('');
  let linkDrafts = $state<LinkDraft[]>([]);
  let backdrop = $state.raw<Backdrop>({ kind: 'photo' });
  let covers = $state.raw<string[]>([]);
  let settingsRequest: AbortController | undefined;

  const current = () => live && auth.getAuth().rpc === account.rpc;
  const stored = $derived(typeof profile?.value?.avatar === 'string' && profile.value.avatar ? profile.value.avatar : undefined);
  const shown = $derived(shownAvatar({ picked: preview, cleared: file === null, stored, bluesky: face.avatar }));
  const name = $derived((typeof profile?.value?.displayName === 'string' && profile.value.displayName.trim()) || face.name || account.handle || '');
  const profileChanged = $derived(file !== undefined || bio.trim() !== (profile?.value?.bio ?? ''));
  const draftLinks = $derived(linkDrafts.filter(draft => draft.url.trim()).map(draft => ({ url: normalizeLink(draft.url) ?? draft.url.trim(), ...(draft.label.trim() ? { label: draft.label.trim() } : {}) })));
  const pageChanged = $derived(!!page && (!sameLinks(draftLinks, page.links) || !sameBackdrop(backdrop, page.backdrop)));
  const changed = $derived(profileChanged || pageChanged);
  const shownBackdrop = $derived(backdrop.kind === 'image' ? backdrop.image : backdrop.kind === 'photo' ? shown.url : undefined);
  const used = $derived(graphemes(bio));
  const tooLong = $derived(used > BIO_GRAPHEMES);
  const locked = $derived(busy || !!saved);
  // besides uploading: keep the saved photo after picking another, and go back to bluesky (or drop the photo when there is no bluesky one)
  const keepable = $derived(shown.source === 'new' && !!stored);
  const fallback = $derived(shown.source === 'new' || shown.source === 'plyr' ? (face.avatar ? 'use my bluesky photo' : 'remove photo') : undefined);
  const sourceNote = $derived(
    shown.source === 'new' ? 'new photo, not saved yet'
      : shown.source === 'plyr' ? 'your plyr.fm photo'
        : shown.source === 'bluesky' ? (file === null ? 'back to your bluesky photo, not saved yet' : 'showing your bluesky photo')
          : file === null ? 'photo removed, not saved yet' : 'no photo yet'
  );

  $effect(() => {
    const url = file ? URL.createObjectURL(file) : undefined;
    preview = url;
    if (url) return () => URL.revokeObjectURL(url);
  });

  onMount(() => {
    live = true;
    void load();
    const controller = new AbortController();
    if (account.did) blueskyFace(account.did, controller.signal).then(result => { if (current()) face = result; }, () => undefined);
    void loadPage();
    return () => { live = false; generation += 1; controller.abort(); settingsRequest?.abort(); };
  });

  beforeNavigate(navigation => {
    if (!changed || saved || busy || leaving || navigation.type === 'leave') return;
    navigation.cancel();
    leaving = navigation.to?.url.href;
  });

  async function load() {
    readError = '';
    loading = true;
    latestRead = false;
    try {
      const result = await pds.myProfile();
      if (!current()) return;
      profile = result;
      bio = typeof result.value?.bio === 'string' ? result.value.bio : '';
      file = undefined;
      latestRead = true;
    } catch (failure) {
      if (current()) readError = failure instanceof Error ? failure.message : 'could not load your profile.';
    } finally { if (current()) loading = false; }
  }

  function settings() {
    const current = auth.getAuth();
    if (!current.agent || !current.accountSync) throw new Error('sign in again to change your links and background.');
    settingsRequest ??= new AbortController();
    return preferenceTransport(current.agent, authConfig, settingsRequest.signal);
  }

  function showPage(value: ArtistPageSettings) {
    page = value;
    linkDrafts = value.links.map(link => ({ url: link.url, label: link.label ?? '' }));
    backdrop = value.backdrop;
  }

  async function loadPage() {
    pageError = '';
    if (!account.accountSync) return;
    try {
      const value = readArtistPage(await settings()());
      if (current()) showPage(value);
    } catch (failure) {
      if (current()) pageError = failure instanceof Error && failure.message.startsWith('sign in again') ? failure.message : 'could not load your links and background.';
    }
    if (!account.did) return;
    // covers the page can sit on: the artist's own artwork, already hosted by plyr.fm
    const [albums, tracks] = await Promise.all([
      api.albums(account.did, { limit: 50 }).catch(() => null),
      api.tracks({ artist_did: account.did, limit: 50 }).catch(() => null),
    ]);
    const urls = [...(albums?.data ?? []).map(list => list.media?.artwork?.url), ...(tracks?.data ?? []).map(track => track.media.artwork?.url)]
      .map(backdropImage).filter((url): url is string => !!url);
    if (current()) covers = [...new Set(urls)].slice(0, 24);
  }

  function addLink() {
    if (linkDrafts.length < MAX_LINKS) linkDrafts.push({ url: '', label: '' });
  }

  function checkLinks(): ProfileLink[] | undefined {
    let ok = true;
    for (const draft of linkDrafts) {
      draft.error = draft.url.trim() && !normalizeLink(draft.url) ? 'use a web address, like bandcamp.com/you' : undefined;
      if (draft.error) ok = false;
    }
    return ok ? draftLinks : undefined;
  }

  function pickPhoto() {
    closeMenu();
    input?.click();
  }

  function avatarPress() {
    if (fallback) menu = !menu;
    else pickPhoto();
  }

  async function choose(event: Event & { currentTarget: HTMLInputElement }) {
    const target = event.currentTarget;
    const picked = target.files?.[0];
    target.value = '';
    if (!picked) return;
    const attempt = ++generation;
    pending = true;
    imageError = '';
    try {
      const image = await avatarImage(picked);
      if (attempt === generation) file = image;
    } catch (failure) {
      if (attempt === generation) imageError = failure instanceof Error ? failure.message : 'could not open this image. choose a different photo.';
    } finally { if (attempt === generation) pending = false; }
  }

  function keepPhoto() {
    closeMenu();
    generation += 1;
    pending = false;
    imageError = '';
    file = undefined;
  }

  function closeMenu() {
    if (!menu) return;
    menu = false;
    avatarButton?.focus();
  }

  function dropPhoto() {
    closeMenu();
    generation += 1;
    pending = false;
    imageError = '';
    file = stored ? null : undefined;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!current() || busy || pending || saved || !profile || !changed || tooLong) return;
    const links = pageChanged ? checkLinks() : [];
    if (!links) return;
    busy = true;
    writeError = '';
    try {
      if (pageChanged) {
        const value = readArtistPage(await settings()({ profileLinks: links, backdrop }));
        if (!current()) return;
        showPage(value);
      }
      const status = profileChanged ? await pds.saveProfile({ bio, ...(file !== undefined ? { avatarFile: file } : {}) }, profile) : 'indexed';
      if (!current()) return;
      saved = status;
      if (profileChanged) await load();
    } catch (failure) {
      if (current()) writeError = failure instanceof Error ? failure.message : 'could not save profile.';
    } finally { if (current()) busy = false; }
  }

  function discard() {
    const to = leaving;
    leaving = undefined;
    file = undefined;
    bio = typeof profile?.value?.bio === 'string' ? profile.value.bio : '';
    if (page) showPage(page);
    if (to) void goto(to);
  }

  function outside(event: PointerEvent) {
    if (menu && avatarField && !avatarField.contains(event.target as Node)) menu = false;
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={event => { if (event.key === 'Escape') closeMenu(); }} />

<div class="editor">
  <header class="top">
    <h1>edit profile</h1>
    {#if !busy}<a class="icon-button" href={profilePath} aria-label="Close"><Icon name="x" /></a>{/if}
  </header>
  {#if saved}
    <p role="status" class="state">
      {saved === 'indexed' ? 'profile saved.' : saved === 'rejected' ? 'profile saved. the catalog could not show this change.' : 'profile saved. the catalog is catching up.'}
    </p>
  {/if}
  {#if loading && !profile}
    <Loading label="loading profile" inline />
  {:else if readError}
    <p role="alert" class="error">{saved ? 'your changes are saved, but the latest profile could not be loaded.' : 'could not load your profile.'}</p>
    <p class="subtle">{readError}</p>
    <button class="text-button" onclick={load}>retry loading profile</button>
  {:else if profile}
    <form onsubmit={save} novalidate>
      <div class="hero">
        {#if shownBackdrop}<div class="backdrop" class:cover={backdrop.kind === 'image'} aria-hidden="true"><img src={shownBackdrop} alt="" /></div>
        {:else if backdrop.kind === 'color'}<div class="backdrop tint" aria-hidden="true" style:--tint={backdrop.color}></div>{/if}
        <div class="avatar-field" bind:this={avatarField}>
          <button type="button" class="avatar" bind:this={avatarButton} class:empty={!shown.url} disabled={locked || pending}
            aria-label={shown.url ? 'change avatar' : 'add avatar'} aria-controls={fallback ? 'avatar-choices' : undefined} aria-expanded={fallback ? menu : undefined}
            onclick={avatarPress}>
            <Artwork src={shown.url} size={176} eager fallbackIcon="user" />
            {#if pending}<span class="overlay">preparing…</span>{/if}
            {#if !locked}<span class="badge" aria-hidden="true"><Icon name="camera" size={18} /></span>{/if}
          </button>
          {#if menu && fallback}
            <div class="menu" id="avatar-choices">
              <button type="button" onclick={pickPhoto}><Icon name="image" size={18} /> upload a photo</button>
              {#if keepable}<button type="button" onclick={keepPhoto}><Icon name="back" size={18} /> keep my current photo</button>{/if}
              <button type="button" class:danger={!face.avatar} onclick={dropPhoto}>
                <Icon name={face.avatar ? 'refresh' : 'trash'} size={18} /> {fallback}
              </button>
            </div>
          {/if}
          <input type="file" accept="image/*,.heic,.heif" aria-label="choose avatar image" bind:this={input} onchange={choose} hidden />
        </div>
        <div class="identity">
          <p class="name">{name}</p>
          {#if account.handle && name !== account.handle}<p class="handle">@{account.handle}</p>{/if}
          <label class="bio">
            <textarea rows="3" aria-label="bio" bind:value={bio} disabled={locked} placeholder="what you make, where you play"
              aria-invalid={tooLong} aria-describedby="bio-count"></textarea>
          </label>
          <p id="bio-count" class="count" class:over={tooLong}>{tooLong ? `${used - BIO_GRAPHEMES} over the ${BIO_GRAPHEMES} character limit` : `${used} / ${BIO_GRAPHEMES}`}</p>
        </div>
      </div>
      {#if imageError}<p role="alert" class="error">{imageError}</p>{/if}
      <section class="page-part" aria-labelledby="links-heading">
        <div class="part-head"><h2 id="links-heading">links</h2><p>shown under your bio, like links on a Bluesky profile</p></div>
        {#if !account.accountSync}
          <p class="subtle">sign in again to change your links and background.</p>
        {:else if pageError}
          <p role="alert" class="error">{pageError}</p>
          <button type="button" class="text-button" onclick={loadPage}>retry</button>
        {:else if !page}
          <Loading label="loading your links" inline />
        {:else}
          {#each linkDrafts as draft, index (index)}
            {@const named = normalizeLink(draft.url)}
            <div class="link-row">
              <Icon name="external" size={18} />
              <input class="url" type="text" inputmode="url" autocomplete="url" autocapitalize="off" spellcheck="false" placeholder="bandcamp.com/you"
                aria-label={`link ${index + 1} address`} aria-invalid={!!draft.error} bind:value={draft.url} disabled={locked} oninput={() => { draft.error = undefined; }} />
              <input class="label" type="text" maxlength="40" placeholder={named ? linkName({ url: named }) : 'name (optional)'}
                aria-label={`link ${index + 1} name`} bind:value={draft.label} disabled={locked} />
              <button type="button" class="icon-button" aria-label={`remove link ${index + 1}`} disabled={locked} onclick={() => linkDrafts.splice(index, 1)}><Icon name="x" size={18} /></button>
            </div>
            {#if draft.error}<p role="alert" class="error row-error">{draft.error}</p>{/if}
          {/each}
          {#if linkDrafts.length < MAX_LINKS}
            <button type="button" class="add" disabled={locked} onclick={addLink}><Icon name="plus" size={16} /> add a link</button>
          {/if}
        {/if}
      </section>
      {#if page}
        <section class="page-part" aria-labelledby="backdrop-heading">
          <div class="part-head"><h2 id="backdrop-heading">background</h2><p>what sits behind your page</p></div>
          <div class="choices" role="radiogroup" aria-labelledby="backdrop-heading">
            <button type="button" role="radio" aria-checked={backdrop.kind === 'photo'} disabled={locked} onclick={() => { backdrop = { kind: 'photo' }; }}>
              <span class="tile photo">{#if shown.url}<img src={shown.url} alt="" />{/if}</span>your photo
            </button>
            <button type="button" role="radio" aria-checked={backdrop.kind === 'image'} disabled={locked || !covers.length} onclick={() => { if (backdrop.kind !== 'image' && covers[0]) backdrop = { kind: 'image', image: covers[0] }; }}>
              <span class="tile">{#if backdrop.kind === 'image'}<img src={backdrop.image} alt="" />{:else if covers[0]}<img src={covers[0]} alt="" />{:else}<Icon name="image" size={20} />{/if}</span>a cover
            </button>
            <button type="button" role="radio" aria-checked={backdrop.kind === 'color'} disabled={locked} onclick={() => { if (backdrop.kind !== 'color') backdrop = { kind: 'color', color: BACKDROP_COLORS[0] }; }}>
              <span class="tile tint" style:--tint={backdrop.kind === 'color' ? backdrop.color : BACKDROP_COLORS[0]}></span>a color
            </button>
            <button type="button" role="radio" aria-checked={backdrop.kind === 'plain'} disabled={locked} onclick={() => { backdrop = { kind: 'plain' }; }}>
              <span class="tile plain"></span>plain
            </button>
          </div>
          {#if backdrop.kind === 'color'}
            {@const chosen = backdrop.color}
            <div class="swatches" role="radiogroup" aria-label="background color">
              {#each BACKDROP_COLORS as color (color)}
                <button type="button" role="radio" class="swatch" aria-checked={chosen === color} aria-label={color} style:--tint={color} disabled={locked} onclick={() => { backdrop = { kind: 'color', color }; }}></button>
              {/each}
              <label class="swatch custom" class:on={!BACKDROP_COLORS.includes(chosen as typeof BACKDROP_COLORS[number])} style:--tint={chosen}>
                <Icon name="palette" size={16} />
                <input type="color" aria-label="any color" value={chosen} disabled={locked} oninput={event => { backdrop = { kind: 'color', color: event.currentTarget.value.toLowerCase() }; }} />
              </label>
            </div>
          {:else if backdrop.kind === 'image'}
            {@const chosen = backdrop.image}
            <div class="covers" role="radiogroup" aria-label="cover">
              {#each covers as cover, index (cover)}
                <button type="button" role="radio" aria-checked={chosen === cover} aria-label={`cover ${index + 1}`} disabled={locked} onclick={() => { backdrop = { kind: 'image', image: cover }; }}><img src={cover} alt="" loading="lazy" /></button>
              {/each}
            </div>
          {/if}
        </section>
      {/if}
      {#if leaving}
        <div class="discard" role="alert">
          <p>discard your unsaved profile changes?</p>
          <button type="button" class="text-button" onclick={discard}>discard changes</button>
          <button type="button" class="text-button" onclick={() => { leaving = undefined; }}>keep editing</button>
        </div>
      {/if}
      {#if writeError}<p role="alert" class="error">{writeError}</p>{/if}
      <footer>
        <span class="source" class:fresh={file !== undefined}>{sourceNote}</span>
        <span class="buttons">
          {#if saved && latestRead && !busy}
            <button class="text-button" type="button" onclick={() => { saved = undefined; }}>edit again</button>
            <a class="text-button" href={profilePath}>view your profile</a>
          {:else if !saved}
            <a class="text-button" href={profilePath} aria-disabled={busy}>cancel</a>
            <button class="hero-pill primary" type="submit" disabled={busy || pending || !changed || tooLong}>{busy ? 'saving…' : 'save profile'}</button>
          {/if}
        </span>
      </footer>
    </form>
  {/if}
</div>

<style>
  .editor { --danger: light-dark(#c0392b, #ff8f8f); max-width: 69rem; margin: 0 auto; display: grid; gap: 1rem; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  h1 { font-size: var(--t-17-6); color: var(--muted); }
  form { display: grid; gap: 1rem; }
  .hero { position: relative; isolation: isolate; display: flex; align-items: flex-start; gap: 2.25rem; padding: clamp(1.25rem, 3vw, 2rem); border: 1px solid var(--line); border-radius: 1.1rem; background: var(--surface); }
  .backdrop { position: absolute; inset: 0; z-index: -1; overflow: hidden; border-radius: inherit; pointer-events: none; }
  .backdrop img { width: 100%; height: 100%; object-fit: cover; filter: blur(48px) saturate(1.2); transform: scale(1.3); opacity: 0.45; }
  .backdrop.cover img { filter: blur(18px) saturate(1.1); transform: scale(1.1); opacity: 0.55; }
  .backdrop.tint { background: radial-gradient(120% 90% at 20% 0%, color-mix(in srgb, var(--tint) 55%, transparent), transparent 80%); }
  .page-part { display: grid; gap: 0.6rem; padding: 1.1rem clamp(1.25rem, 3vw, 2rem); border: 1px solid var(--line); border-radius: 1.1rem; background: var(--surface); }
  .part-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.75rem; }
  .part-head h2 { font-size: var(--t-16); font-weight: 700; }
  .part-head p { color: var(--muted); font-size: var(--t-13-6); }
  .link-row { display: grid; grid-template-columns: auto minmax(0, 2fr) minmax(0, 1fr) auto; align-items: center; gap: 0.6rem; }
  .link-row > :global(svg) { color: var(--faint); }
  .link-row input { min-width: 0; height: 2.75rem; padding: 0 0.75rem; border: 1px solid var(--line); border-radius: 0.6rem; background: var(--raised); color: var(--text); font-size: var(--t-16); }
  .link-row input:focus { outline: none; border-color: var(--accent); }
  .link-row input[aria-invalid="true"] { border-color: var(--danger); }
  .row-error { margin: -0.2rem 0 0 2.15rem; }
  .add { display: inline-flex; align-items: center; gap: 0.4rem; justify-self: start; min-height: 2.5rem; padding: 0 0.9rem; border: 1px dashed var(--faint); border-radius: 999px; background: none; color: var(--text); font-weight: 600; }
  .choices { display: grid; grid-template-columns: repeat(4, minmax(0, 7rem)); gap: 0.75rem; }
  .choices button { display: grid; justify-items: center; gap: 0.4rem; padding: 0; border: 0; background: none; color: var(--muted); font-size: var(--t-13-6); }
  .choices button[aria-checked="true"] { color: var(--text); font-weight: 700; }
  .choices button:disabled:not([aria-checked="true"]) { opacity: 0.5; }
  .tile { display: grid; place-items: center; width: 100%; aspect-ratio: 1; overflow: hidden; border-radius: 0.7rem; border: 2px solid transparent; background: var(--raised); color: var(--muted); }
  .tile img { width: 100%; height: 100%; object-fit: cover; }
  .tile.photo img { filter: blur(10px) saturate(1.2); transform: scale(1.3); }
  [aria-checked="true"] > .tile { border-color: var(--accent); }
  .tile.tint { background: radial-gradient(circle at 30% 20%, var(--tint), color-mix(in srgb, var(--tint) 35%, var(--surface))); }
  .tile.plain { background: var(--bg); box-shadow: inset 0 0 0 1px var(--line); }
  .swatches { display: flex; flex-wrap: wrap; gap: 0.6rem; }
  .swatch { position: relative; width: 2.5rem; height: 2.5rem; padding: 0; border-radius: 50%; border: 2px solid transparent; background: var(--tint); box-shadow: inset 0 0 0 2px var(--surface); cursor: pointer; }
  .swatch[aria-checked="true"], .swatch.on { border-color: var(--text); }
  .swatch.custom { display: grid; place-items: center; background: var(--raised); color: var(--muted); box-shadow: none; }
  .swatch.custom.on { background: var(--tint); color: white; }
  .swatch.custom input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .covers { display: grid; grid-template-columns: repeat(auto-fill, minmax(3.5rem, 1fr)); gap: 0.5rem; max-width: 32rem; }
  .covers button { aspect-ratio: 1; padding: 0; overflow: hidden; border: 2px solid transparent; border-radius: 0.5rem; background: var(--raised); }
  .covers button[aria-checked="true"] { border-color: var(--accent); }
  .covers img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .avatar-field { position: relative; flex: none; }
  .avatar { position: relative; display: block; width: 11rem; aspect-ratio: 1; padding: 0; border: 0; border-radius: 50%; background: var(--raised); box-shadow: 0 0.7rem 2rem rgb(0 0 0 / 0.3); cursor: pointer; }
  .avatar :global(.artwork) { border-radius: 50%; }
  .avatar:disabled { opacity: 1; cursor: default; }
  .avatar:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .overlay { position: absolute; inset: 0; display: grid; place-items: center; border-radius: 50%; color: white; background: rgb(0 0 0 / 0.5); }
  .badge { position: absolute; right: 0.35rem; bottom: 0.35rem; width: 2.6rem; height: 2.6rem; display: grid; place-items: center; border-radius: 50%; background: var(--accent); color: var(--on-accent); border: 3px solid var(--surface); }
  .menu { position: absolute; z-index: 5; top: calc(100% + 0.5rem); left: 50%; transform: translateX(-50%); width: max-content; min-width: 14rem; display: grid; padding: 0.35rem; border: 1px solid var(--line); border-radius: 0.8rem; background: var(--surface); box-shadow: 0 0.9rem 2.2rem rgb(0 0 0 / 0.3); }
  .menu button { display: flex; align-items: center; gap: 0.6rem; min-height: 2.75rem; padding: 0 0.75rem; border: 0; border-radius: 0.55rem; background: none; color: var(--text); text-align: left; }
  .menu button:hover, .menu button:focus-visible { background: var(--raised); }
  .menu .danger { color: var(--danger); }
  .identity { flex: 1; min-width: 0; display: grid; gap: 0.35rem; padding-top: 0.5rem; }
  .name { font-size: clamp(1.75rem, 5vw, 3.25rem); font-weight: 800; line-height: 1.08; letter-spacing: -0.035em; overflow-wrap: anywhere; }
  .handle { color: var(--muted); }
  label.bio { display: block; margin-top: 0.6rem; max-width: 44rem; }
  textarea { width: 100%; min-height: 6rem; padding: 0.7rem 0.8rem; border: 1px dashed color-mix(in srgb, var(--text) 35%, transparent); border-radius: 0.75rem; background: color-mix(in srgb, var(--bg) 55%, transparent); color: var(--text); font-size: var(--t-16); line-height: 1.4; resize: vertical; }
  textarea:focus { outline: none; border-style: solid; border-color: var(--accent); }
  textarea[aria-invalid="true"] { border-color: var(--danger); border-style: solid; }
  .count { max-width: 44rem; text-align: right; color: var(--faint); font-size: var(--t-12-8); font-variant-numeric: tabular-nums; }
  .count.over { color: var(--danger); }
  .discard { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; padding: 0.75rem; border: 1px solid var(--line); border-radius: 0.7rem; background: var(--raised); }
  .discard p { flex: 1 1 100%; }
  footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; }
  .source { padding: 0.3rem 0.75rem; border-radius: 999px; background: var(--raised); color: var(--muted); font-size: var(--t-13-6); }
  .source.fresh { color: var(--text); background: color-mix(in srgb, var(--accent) 16%, var(--raised)); }
  .buttons { display: flex; align-items: center; gap: 0.75rem; margin-left: auto; }
  .error { margin: 0.25rem 0; color: var(--danger); }
  @media (max-width: 720px) {
    .hero { flex-direction: column; align-items: center; text-align: center; gap: 1rem; }
    .avatar { width: min(8.5rem, 40vw); }
    .badge { width: 2.25rem; height: 2.25rem; right: 0; bottom: 0; }
    .identity { width: 100%; justify-items: center; padding-top: 0; }
    .name { font-size: 1.85rem; }
    label.bio, .count { width: 100%; text-align: left; }
    .count { text-align: right; }
    footer { flex-direction: column; align-items: stretch; }
    .source { align-self: center; }
    .buttons { margin: 0; justify-content: space-between; }
    .buttons .hero-pill { flex: 1; }
    .link-row { grid-template-columns: minmax(0, 1fr) auto; }
    .link-row > :global(svg) { display: none; }
    .link-row .label { grid-row: 2; }
    .row-error { margin-left: 0; }
    .choices { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  }
</style>
