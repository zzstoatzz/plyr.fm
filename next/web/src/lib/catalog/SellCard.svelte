<script lang="ts">
  import { onMount } from 'svelte';
  import { preferenceTransport } from '@plyr/next-core/preference-transport';
  import { parsePrice, priceText as priceInput } from '@plyr/next-core/access/policy';
  import { normalizeLink, offerLabel, readSelling, sellableReleases, storeName, withBuyLink, type Release, type SellingSettings } from '@plyr/next-core/selling';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth';
  import { authConfig } from '$lib/auth-config';
  import { toast } from '$lib/toast.svelte';
  import { resolve } from '$app/paths';

  let { did }: { did: string } = $props();
  const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];

  let account = $state.raw(auth.getAuth());
  let settings = $state.raw<SellingSettings>();
  let releases = $state.raw<Release[]>([]);
  let loadError = $state('');
  let supportText = $state('');
  let supportError = $state('');
  let editing = $state<string>();
  let urlText = $state('');
  let priceText = $state('');
  let currency = $state('USD');
  let editError = $state('');
  let busy = $state(false);
  let controller: AbortController | undefined;

  const request = () => {
    const current = auth.getAuth();
    if (!current.agent || !current.accountSync) throw new Error('reconnect to change how you sell your music.');
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
    } catch (failure) { loadError = failure instanceof Error ? failure.message : 'could not load your selling settings.'; }
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

  function edit(release: Release) {
    const existing = settings?.buyLinks.find(link => link.subject === release.uri);
    editing = release.uri;
    editError = '';
    urlText = existing?.url ?? '';
    currency = existing?.currency ?? 'USD';
    priceText = existing?.amount !== undefined && existing.currency ? priceInput(existing.amount, existing.currency) : '';
  }

  async function saveBuy(event: SubmitEvent, release: Release) {
    event.preventDefault();
    if (!settings) return;
    editError = '';
    const url = normalizeLink(urlText);
    if (!url) { editError = 'paste the full link to where you sell it.'; return; }
    let amount: number | undefined;
    if (priceText.trim()) {
      amount = parsePrice(priceText, currency);
      if (amount === undefined) { editError = 'enter a price like 8 or 7.50, or leave it empty.'; return; }
    }
    const offer = { subject: release.uri, url, ...(amount !== undefined ? { amount, currency } : {}) };
    if (await save({ buyLinks: withBuyLink(settings.buyLinks, offer) }, `${release.title}: buy ${offerLabel(offer)}`)) editing = undefined;
  }

  async function removeBuy(release: Release) {
    if (!settings) return;
    if (await save({ buyLinks: withBuyLink(settings.buyLinks, { subject: release.uri }) }, `removed the buy link for ${release.title}`)) editing = undefined;
  }
</script>

<section class="sell" aria-labelledby="sell-title">
  <h2 id="sell-title">sell your music</h2>
  <p class="subtle">point listeners at wherever you already sell. buttons show up on your artist page and releases. plyr never sees the payment.</p>
  {#if !account.accountSync}
    <p>reconnect to choose where listeners can buy your music.</p>
    <a class="text-button strong" href={`${resolve('/(app)/login')}?${new URLSearchParams({ return_to: '/portal' })}`}>reconnect</a>
  {:else if loadError}
    <p role="alert">{loadError}</p>
    <button class="text-button" type="button" onclick={load}>try again</button>
  {:else if !settings}
    <p class="subtle" role="status">loading…</p>
  {:else}
    <form class="card" onsubmit={saveSupport}>
      <label for="support-link"><b>support link</b><small>shown on your artist page and when someone downloads.</small></label>
      <div class="line">
        <input id="support-link" type="url" inputmode="url" autocomplete="url" placeholder="https://ko-fi.com/you" bind:value={supportText} aria-invalid={!!supportError} aria-describedby={supportError ? 'support-error' : undefined} />
        <button class="text-button strong" type="submit" disabled={busy || supportText.trim() === settings.supportUrl}>save</button>
      </div>
      {#if supportError}<p id="support-error" class="error" role="alert">{supportError}</p>
      {:else if settings.supportUrl}<p class="hint">shows as "support on {storeName(settings.supportUrl)}"</p>{/if}
    </form>

    <div class="card">
      <b>buy links</b><small>optional, per release. leave the price empty to just say "buy on Bandcamp".</small>
      {#if !releases.length}<p class="hint">upload something first, then add where it's sold.</p>{/if}
      <ul>
        {#each releases as release (release.uri)}
          {@const offer = settings.buyLinks.find(link => link.subject === release.uri)}
          <li>
            <div class="row">
              <span class="names"><span class="title">{release.title}</span><small>{release.kind}</small></span>
              {#if editing !== release.uri}
                <button type="button" class="pill" class:set={!!offer} onclick={() => edit(release)} aria-label={offer ? `edit buy link for ${release.title}: ${offerLabel(offer)}` : `add a buy link for ${release.title}`}>{offer ? offerLabel(offer) : 'add a buy link'}</button>
              {/if}
            </div>
            {#if editing === release.uri}
              <form class="edit" onsubmit={event => saveBuy(event, release)}>
                <label class="url"><small>buy link for {release.title}</small><input type="url" inputmode="url" placeholder="https://you.bandcamp.com/album/…" bind:value={urlText} /></label>
                <label class="price"><small>price</small><input inputmode="decimal" placeholder="optional" bind:value={priceText} /></label>
                <label class="currency"><small>currency</small><select bind:value={currency}>{#each CURRENCIES as code (code)}<option value={code}>{code}</option>{/each}</select></label>
                {#if editError}<p class="error" role="alert">{editError}</p>{/if}
                <div class="buttons">
                  <button class="text-button strong" type="submit" disabled={busy}>save</button>
                  {#if offer}<button class="text-button" type="button" disabled={busy} onclick={() => removeBuy(release)}>remove</button>{/if}
                  <button class="text-button" type="button" onclick={() => { editing = undefined; }}>cancel</button>
                </div>
              </form>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>

<style>
  .sell { display: grid; gap: 0.75rem; margin: 0.5rem 0 1.5rem; }
  h2 { font-size: 1.2rem; }
  .card { display: grid; gap: 0.35rem; border: 1px solid var(--line); border-radius: 0.9rem; background: var(--surface); padding: 1rem; }
  label { display: grid; gap: 0.15rem; }
  small, .hint { color: var(--faint); font-size: 0.82rem; }
  .line { display: flex; gap: 0.5rem; margin-top: 0.4rem; }
  input, select { min-height: 2.75rem; min-width: 0; padding-inline: 0.7rem; border-radius: 0.6rem; border: 1px solid var(--line); background: var(--bg); color: var(--text); font-size: 1rem; }
  .line input { flex: 1; }
  .error { color: var(--danger, var(--text)); font-size: 0.85rem; }
  ul { list-style: none; padding: 0; margin: 0.4rem 0 0; }
  li { border-top: 1px solid var(--line); padding: 0.55rem 0; }
  .row { display: flex; align-items: center; gap: 0.75rem; }
  .names { flex: 1; min-width: 0; display: grid; }
  .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pill { min-height: 2.75rem; padding: 0 0.9rem; border-radius: 999px; border: 1px solid var(--line); background: none; color: var(--muted); font-size: 0.85rem; white-space: nowrap; }
  .pill.set { border-color: var(--accent); color: var(--accent); font-weight: 650; }
  .edit { display: grid; grid-template-columns: 1fr 7rem 6rem; gap: 0.5rem; align-items: end; margin-top: 0.5rem; }
  .edit .error, .buttons { grid-column: 1 / -1; }
  .buttons { display: flex; gap: 0.4rem; }
  @media (max-width: 560px) { .edit { grid-template-columns: 1fr 1fr; } .url { grid-column: 1 / -1; } }
</style>
