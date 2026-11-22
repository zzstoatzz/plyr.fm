<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { preferenceTransport } from '@plyr/next-core/preference-transport';
  import { findReleases, linkedReleases, normalizeLink, offerLabel, readSelling, sellableReleases, storeName, withBuyLink, type Release, type SellingSettings } from '@plyr/next-core/selling';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth';
  import { authConfig } from '$lib/auth-config';
  import { toast } from '$lib/toast.svelte';
  import Artwork from '$lib/ui/Artwork.svelte';
  import Sheet from '$lib/ui/Sheet.svelte';
  import { resolve } from '$app/paths';

  let { did }: { did: string } = $props();
  const SHOWN = 50;
  const GROUPS = [{ label: 'all', value: undefined }, { label: 'albums', value: 'album' }, { label: 'tracks', value: 'track' }] as const;

  let account = $state.raw(auth.getAuth());
  let settings = $state.raw<SellingSettings>();
  let releases = $state.raw<Release[]>([]);
  let loadError = $state('');
  let supportText = $state('');
  let supportError = $state('');
  let sheet: Sheet;
  let search = $state<HTMLInputElement>();
  let picking = $state(false);
  let query = $state('');
  let group = $state<Release['group']>();
  let editing = $state.raw<Release>();
  let urlText = $state('');
  let editError = $state('');
  let busy = $state(false);
  let controller: AbortController | undefined;

  const linked = $derived(settings ? linkedReleases(releases, settings.buyLinks) : []);
  const found = $derived(settings ? findReleases(releases, settings.buyLinks, query, group) : []);
  const offer = $derived(editing && settings?.buyLinks.find(link => link.subject === editing?.uri));
  const unlinked = $derived(settings ? releases.length - linked.length : 0);

  const request = () => {
    const current = auth.getAuth();
    if (!current.agent || !current.accountSync) throw new Error('reconnect to change where listeners can pay you.');
    controller ??= new AbortController();
    return preferenceTransport(current.agent, authConfig, controller.signal);
  };

  async function load() {
    loadError = '';
    try {
      const [value, list] = await Promise.all([request()(), sellableReleases({
        albums: cursor => api.albums(did, { limit: 100, cursor }),
        tracks: cursor => api.tracks({ artist_did: did, limit: 100, cursor }),
      })]);
      settings = readSelling(value);
      releases = list;
      supportText = settings.supportUrl;
    } catch (failure) { loadError = failure instanceof Error ? failure.message : 'could not load your payment settings.'; }
  }

  onMount(() => {
    const stop = auth.subscribe(() => { account = auth.getAuth(); });
    if (account.accountSync) void load();
    return () => { stop(); controller?.abort(); };
  });

  async function save(patch: Partial<SellingSettings>, done: string) {
    busy = true;
    try {
      settings = readSelling(await request()(patch));
      toast.add(done, 'success');
      return true;
    } catch (failure) {
      toast.add(failure instanceof Error ? failure.message : 'could not save that. try again.', 'error');
      return false;
    } finally { busy = false; }
  }

  async function saveSupport(event: SubmitEvent) {
    event.preventDefault();
    supportError = '';
    const text = supportText.trim();
    const url = text ? normalizeLink(text) : '';
    if (url === undefined) { supportError = 'use a full https link, like https://ko-fi.com/you.'; return; }
    if (await save({ supportUrl: url }, url ? `support link saved: ${storeName(url)}` : 'support link removed')) supportText = url;
  }

  async function pick() {
    picking = true; editing = undefined; query = ''; group = undefined;
    sheet.show();
    await tick();
    search?.focus();
  }

  let urlInput = $state<HTMLInputElement>();

  async function edit(release: Release) {
    const existing = settings?.buyLinks.find(link => link.subject === release.uri);
    editing = release;
    editError = '';
    urlText = existing?.url ?? '';
    sheet.show();
    await tick();
    urlInput?.focus();
  }

  async function change() {
    editing = undefined;
    await tick();
    search?.focus();
  }

  async function saveBuy(event: SubmitEvent) {
    event.preventDefault();
    if (!settings || !editing) return;
    editError = '';
    const url = normalizeLink(urlText);
    if (!url) { editError = 'paste the full link to where you sell it.'; return; }
    const next = { subject: editing.uri, url };
    if (await save({ buyLinks: withBuyLink(settings.buyLinks, next) }, `${editing.title}: buy ${offerLabel(next)}`)) sheet.close();
  }

  async function removeBuy() {
    if (!settings || !editing) return;
    if (await save({ buyLinks: withBuyLink(settings.buyLinks, { subject: editing.uri }) }, `removed the buy link for ${editing.title}`)) sheet.close();
  }
</script>

<section class="sell" aria-label="get paid">
  <p class="subtle">point listeners to wherever you already sell or take tips. buttons show up on your artist page and on what you've uploaded. plyr.fm never sees the payment.</p>
  {#if !account.accountSync}
    <p>reconnect to choose where listeners can pay you.</p>
    <a class="text-button strong" href={`${resolve('/(app)/login')}?${new URLSearchParams({ return_to: '/get-paid' })}`}>reconnect</a>
  {:else if loadError}
    <p role="alert">{loadError}</p>
    <button class="text-button" type="button" onclick={load}>try again</button>
  {:else if !settings}
    <p class="subtle" role="status">loading…</p>
  {:else}
    <form class="card" novalidate onsubmit={saveSupport}>
      <label for="support-link"><b>support link</b><small>shown on your artist page and when someone downloads.</small></label>
      <div class="line">
        <input id="support-link" type="url" inputmode="url" autocomplete="url" placeholder="https://ko-fi.com/you" bind:value={supportText} aria-invalid={!!supportError} aria-describedby={supportError ? 'support-error' : undefined} />
        <button class="text-button strong" type="submit" disabled={busy || supportText.trim() === settings.supportUrl}>save</button>
      </div>
      {#if supportError}<p id="support-error" class="error" role="alert">{supportError}</p>
      {:else if settings.supportUrl}<p class="hint">shows as "support on {storeName(settings.supportUrl)}"</p>{/if}
    </form>

    <div class="card">
      <b>buy links</b><small>a buy button on one track or album, pointing wherever it's sold.</small>
      {#if linked.length}
        <ul>
          {#each linked as { release, offer: set } (release.uri)}
            <li>
              <button type="button" class="release" onclick={() => { picking = false; edit(release); }} aria-label={`edit buy link for ${release.title}: ${offerLabel(set)}`}>
                <span class="art"><Artwork src={release.art} size={44} /></span>
                <span class="names"><span class="title">{release.title}</span><small>{release.group}</small></span>
                <span class="tag">{offerLabel(set)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if !releases.length}<p class="hint">upload something first, then add where it's sold.</p>
      {:else if unlinked}<button type="button" class="pill add" onclick={pick}>+ add a buy link</button>{/if}
    </div>
  {/if}
</section>

<Sheet bind:this={sheet} title={editing && offer ? 'edit buy link' : 'add a buy link'} {busy}>
  {#if editing}
    <form class="edit" novalidate onsubmit={saveBuy}>
      <div class="picked">
        <span class="art"><Artwork src={editing.art} size={44} /></span>
        <span class="names"><span class="title">{editing.title}</span><small>{editing.kind}</small></span>
        {#if picking && !offer}<button type="button" class="text-button" disabled={busy} onclick={change}>change</button>{/if}
      </div>
      <label class="url"><small>where it's sold</small><input bind:this={urlInput} type="url" inputmode="url" placeholder="https://you.bandcamp.com/album/…" bind:value={urlText} aria-invalid={!!editError} /></label>
      {#if editError}<p class="error" role="alert">{editError}</p>{:else}<p class="hint wide">listeners get a buy button that opens this link.</p>{/if}
      <div class="buttons">
        <button class="text-button strong" type="submit" disabled={busy}>save buy link</button>
        {#if offer}<button class="text-button" type="button" disabled={busy} onclick={removeBuy}>remove</button>{/if}
      </div>
    </form>
  {:else}
    <div class="picker">
      <input bind:this={search} type="search" placeholder="find a track or album" aria-label="find a track or album" bind:value={query} autocomplete="off" />
      <div class="groups" role="group" aria-label="show">
        {#each GROUPS as option (option.label)}
          <button type="button" class="chip" aria-pressed={group === option.value} onclick={() => { group = option.value; }}>{option.label}</button>
        {/each}
      </div>
      <ul class="found">
        {#each found.slice(0, SHOWN) as release (release.uri)}
          <li>
            <button type="button" class="release" onclick={() => edit(release)}>
              <span class="art"><Artwork src={release.art} size={44} /></span>
              <span class="names"><span class="title">{release.title}</span><small>{release.kind}</small></span>
            </button>
          </li>
        {:else}
          <li class="hint">{query.trim() ? `nothing without a buy link matches "${query.trim()}".` : group ? `every ${group} already has a buy link.` : 'everything here already has a buy link.'}</li>
        {/each}
      </ul>
      {#if found.length > SHOWN}<p class="hint">showing {SHOWN} of {found.length}. keep typing to narrow it down.</p>{/if}
    </div>
  {/if}
</Sheet>

<style>
  .sell { display: grid; gap: 0.75rem; margin: 0.5rem 0 1.5rem; }
  .card { display: grid; gap: 0.35rem; border: 1px solid var(--line); border-radius: 0.9rem; background: var(--surface); padding: 1rem; justify-items: start; }
  .card > * { justify-self: stretch; }
  label { display: grid; gap: 0.15rem; }
  small, .hint { color: var(--faint); font-size: var(--t-12-8); }
  .line { display: flex; gap: 0.5rem; margin-top: 0.4rem; }
  input { min-height: 2.75rem; min-width: 0; padding-inline: 0.7rem; border-radius: 0.6rem; border: 1px solid var(--line); background: var(--bg); color: var(--text); font-size: var(--t-16); }
  .line input { flex: 1; }
  .error { color: var(--danger, var(--text)); font-size: var(--t-13-6); }
  ul { list-style: none; padding: 0; margin: 0.4rem 0 0; }
  li { border-top: 1px solid var(--line); }
  .release { display: flex; align-items: center; gap: 0.7rem; width: 100%; min-height: 3.5rem; padding: 0.45rem 0; border: 0; background: none; color: inherit; text-align: start; font: inherit; }
  .art { width: 2.75rem; flex: none; border-radius: 0.4rem; overflow: hidden; }
  .names { flex: 1; min-width: 0; display: grid; }
  .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { flex: none; max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0.4rem 0.8rem; border: 1px solid var(--accent); border-radius: 999px; color: var(--accent); font-size: var(--t-13-6); font-weight: 650; }
  .pill { min-height: 2.75rem; padding: 0 1rem; border-radius: 999px; border: 1px solid var(--line); background: none; color: var(--muted); font-size: var(--t-14-4); white-space: nowrap; }
  .pill.add { justify-self: start; margin-top: 0.5rem; border-color: var(--accent); color: var(--accent); font-weight: 650; }
  .picker { display: grid; gap: 0.6rem; padding: 0 1rem 0.5rem; min-height: 0; }
  .picker input { width: 100%; }
  .groups { display: flex; gap: 0.4rem; }
  .chip { min-height: 2.25rem; padding: 0 0.85rem; border-radius: 999px; border: 1px solid var(--line); background: none; color: var(--muted); font-size: var(--t-13-6); }
  .chip[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); font-weight: 650; }
  .found { margin: 0; overflow-y: auto; max-height: min(24rem, 50dvh); }
  .found .hint { padding: 0.75rem 0; }
  .edit { display: grid; grid-template-columns: 1fr; gap: 0.6rem; align-items: end; padding: 0 1rem 0.5rem; }
  .picked { grid-column: 1 / -1; display: flex; align-items: center; gap: 0.7rem; padding: 0.5rem; border-radius: 0.75rem; background: var(--raised); }
  .edit .error, .edit .wide, .buttons { grid-column: 1 / -1; }
  .buttons { display: flex; gap: 0.4rem; }
</style>
