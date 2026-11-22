<script lang="ts">
  import { waysIn } from '@plyr/next-core/access/ways-in';
  import { addWay, buyLinkFor, downloadChoices, downloadsFor, onlyYou, previewRules, sellProblem, WAY_KINDS, wayProblem, type AccessDraft, type UploadOptions, type WayDraft, type WayKind } from '@plyr/next-core/publishing/upload-access';
  import WaysInList from '$lib/access/WaysInList.svelte';
  import Icon, { type IconName } from '$lib/ui/Icon.svelte';

  // who can listen to a new track: open, or closed with any number of ways in.
  // closed with none is only you. the preview is the panel listeners get.
  let { access = $bindable(), options = $bindable(), artist, title, cover, disabled = false, checked = false, needsSignIn, plyrStorage = false, needsSettings }: {
    access: AccessDraft; options: UploadOptions; artist: string; title: string; cover?: string; disabled?: boolean;
    /** plyr.fm storage serves the file publicly, so downloads stay on */
    plyrStorage?: boolean;
    /** a sign-in link when this session can't save buy links */
    needsSettings?: string;
    /** show each way's problem, after a submit tried */
    checked?: boolean;
    /** a sign-in link when this session can't publish the chosen kind of track */
    needsSignIn?: string;
  } = $props();

  const id = $props.id();
  const WAYS: Record<WayKind, { icon: IconName; title: string; detail: string; add: string }> = {
    supporter: { icon: 'heart', title: 'your supporters', detail: 'anyone with a verified payment to you, any amount', add: 'your supporters' },
    purchase: { icon: 'tag', title: 'buy it for', detail: 'a one-time purchase, kept on the buyer’s account', add: 'a price to buy it' },
    signedIn: { icon: 'user', title: 'anyone signed in', detail: 'any account, on plyr.fm or another app', add: 'anyone signed in' },
    members: { icon: 'users', title: 'people you pick', detail: 'they sign in to listen. the list is public.', add: 'people you pick' },
  };
  const missing = $derived(WAY_KINDS.filter(kind => !access.ways.some(way => way.kind === kind)));
  const buy = $derived(buyLinkFor(options.sell));
  const preview = $derived(waysIn({ artist, rules: previewRules(access), offer: buy && { provider: 'link', subject: '', ...buy } }));
  const downloads = $derived(downloadsFor(access, options.downloads, plyrStorage));
  const sellIssue = $derived(checked ? sellProblem(options.sell) : undefined);

  function setClosed(closed: boolean) { access = { closed, ways: closed ? access.ways : [] }; }
  function update(index: number, way: WayDraft) { access = { ...access, ways: access.ways.map((item, at) => at === index ? way : item) }; }
  function remove(index: number) { access = { ...access, ways: access.ways.filter((_, at) => at !== index) }; }
  function add(kind: WayKind) {
    access = { ...access, ways: addWay(access.ways, kind) };
    if (kind === 'purchase' || kind === 'members') queueMicrotask(() => document.getElementById(`${id}-${kind}`)?.focus());
  }
</script>

<section class="access" aria-labelledby="{id}-heading" id="who-can-listen">
  <h2 id="{id}-heading">who can listen</h2>
  <p class="lead">open to everyone, or closed with any number of ways in. passing any one of them lets someone listen.</p>
  <div class="layout" class:solo={!access.closed}>
    <div class="card">
      <div class="choice" role="radiogroup" aria-label="who can listen">
        <label class="tile" class:on={!access.closed}>
          <span class="icon"><Icon name="globe" size={18} /></span>
          <span class="copy"><b>open</b><small>anyone, anywhere</small></span>
          <input type="radio" name="{id}-open" checked={!access.closed} {disabled} onchange={() => setClosed(false)} />
        </label>
        <label class="tile" class:on={access.closed}>
          <span class="icon"><Icon name="lock" size={18} /></span>
          <span class="copy"><b>closed</b><small>only through a way in</small></span>
          <input type="radio" name="{id}-open" checked={access.closed} {disabled} onchange={() => setClosed(true)} />
        </label>
      </div>

      {#if access.closed}
        <div class="label"><span>ways in</span>{#if access.ways.length}<span>{access.ways.length === 1 ? '1 of them' : `${access.ways.length} of them`}</span>{/if}</div>
        {#each access.ways as way, index (way.kind)}
          {@const info = WAYS[way.kind]}
          {@const problem = checked ? wayProblem(way) : undefined}
          <div class="way">
            <span class="icon on"><Icon name={info.icon} size={18} /></span>
            <div class="copy">
              {#if way.kind === 'purchase'}
                <label class="price-row" for="{id}-purchase"><b>{info.title}</b>
                  <span class="money" class:bad={!!problem}><span aria-hidden="true">$</span><input id="{id}-purchase" inputmode="decimal" autocomplete="off" placeholder="5" value={way.price} {disabled}
                    aria-invalid={!!problem} aria-describedby={problem ? `${id}-purchase-problem` : undefined}
                    oninput={event => update(index, { kind: 'purchase', price: event.currentTarget.value })} /><small>USD</small></span>
                </label>
                <small>{info.detail} <span class="soon">checkout coming soon</span></small>
              {:else if way.kind === 'members'}
                <label for="{id}-members"><b>{info.title}</b></label>
                <input class="people" id="{id}-members" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="handles, like name.bsky.social" value={way.people} {disabled}
                  aria-invalid={!!problem} aria-describedby={problem ? `${id}-members-problem` : undefined}
                  oninput={event => update(index, { kind: 'members', people: event.currentTarget.value })} />
                <small>{info.detail}</small>
              {:else}
                <b>{info.title}</b><small>{info.detail}</small>
              {/if}
              {#if problem}<p class="problem" id="{id}-{way.kind}-problem" role="alert">{problem}</p>{/if}
            </div>
            <button type="button" class="remove" aria-label="remove {info.add}" {disabled} onclick={() => remove(index)}><Icon name="x" size={18} /></button>
          </div>
        {/each}
        {#if missing.length}
          <div class="adds">
            {#each missing as kind (kind)}
              <button type="button" class="add" {disabled} onclick={() => add(kind)}><Icon name="plus" size={15} />{WAYS[kind].add}</button>
            {/each}
          </div>
        {/if}
        <p class="note">{access.ways.length ? 'people who can listen can still record what they hear.' : 'no ways in means only you can play it. it stays in your library and nobody else can find it.'}</p>
      {:else}
        <p class="note">on your profile, in feeds and search, free to play.</p>
      {/if}
      {#if !onlyYou(access)}
        <div class="more">
          {#if options.sell}
            <div class="way">
              <span class="icon on"><Icon name="link" size={18} /></span>
              <div class="copy">
                <label for="{id}-sell"><b>where else you sell it</b></label>
                <div class="sell-row">
                  <input class="people" id="{id}-sell" type="url" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="https://you.bandcamp.com/track/…" value={options.sell.url} {disabled}
                    aria-invalid={!!sellIssue} aria-describedby={sellIssue ? `${id}-sell-problem` : undefined}
                    oninput={event => { options = { ...options, sell: { ...options.sell!, url: event.currentTarget.value } }; }} />
                </div>
                <small>listeners get a buy button. a sale there doesn’t open it here.</small>
                {#if sellIssue}<p class="problem" id="{id}-sell-problem" role="alert">{sellIssue}</p>{/if}
                {#if needsSettings}<p class="problem">sign in again to save buy links. <a href={needsSettings}>sign in again</a></p>{/if}
              </div>
              <button type="button" class="remove" aria-label="remove where else you sell it" {disabled} onclick={() => { options = { ...options, sell: undefined }; }}><Icon name="x" size={18} /></button>
            </div>
          {:else}
            <div class="adds"><button type="button" class="add" {disabled} onclick={() => { options = { ...options, sell: { url: '' } }; queueMicrotask(() => document.getElementById(`${id}-sell`)?.focus()); }}><Icon name="plus" size={15} />where else you sell it</button></div>
          {/if}
          <label class="switch">
            <span><b>show in feeds</b><small>{options.listed ? 'in home, latest and top tracks.' : 'off: still on your profile and in search.'}</small></span>
            <input type="checkbox" role="switch" checked={options.listed} {disabled} onchange={event => { options = { ...options, listed: event.currentTarget.checked }; }} />
          </label>
          <fieldset class="downloads" disabled={disabled || plyrStorage}>
            <legend>downloads</legend>
            {#each downloadChoices(access) as choice (choice.value)}
              <label class="pick" class:on={downloads === choice.value}>
                <input type="radio" name="{id}-downloads" checked={downloads === choice.value} onchange={() => { options = { ...options, downloads: choice.value }; }} />
                <span class="copy"><b>{choice.title}</b><small>{choice.detail}</small></span>
              </label>
            {/each}
            {#if plyrStorage}<p class="note">plyr.fm storage serves the file openly, so downloads stay on.</p>{:else if access.closed}<p class="note">a closed track’s file stays in its space, so only supporters can download it, or no one.</p>{/if}
          </fieldset>
        </div>
      {/if}
      {#if needsSignIn}<p class="problem">sign in again to allow this. what you typed stays here. <a href={needsSignIn}>sign in again</a></p>{/if}
    </div>

    {#if access.closed}
      <div class="preview">
        <span class="cap"><Icon name="info" size={15} />what a listener without access sees</span>
        {#if access.ways.length}
          <div class="locked">
            <div class="head">
              <span class="art">{#if cover}<img src={cover} alt="" />{:else}<Icon name="music" size={20} />{/if}</span>
              <span><b>{title || 'your track'}</b><small>{artist}</small></span>
            </div>
            <WaysInList {artist} ways={preview.ways} empty preview />
          </div>
        {:else}
          <div class="locked hidden"><Icon name="lock" size={20} /><span>nobody else can find this track. it’s only in your library.</span></div>
        {/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .access { display: grid; gap: 0.25rem; scroll-margin-top: 1rem; }
  h2 { font-size: var(--t-17-6); }
  .lead { color: var(--muted); font-size: var(--t-14-4); line-height: 1.4; margin-bottom: 0.6rem; }
  .layout { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.75fr); gap: 1rem; align-items: start; }
  .layout.solo { grid-template-columns: minmax(0, 1fr); }
  .card { display: grid; gap: 0.9rem; min-width: 0; padding: 1.1rem; background: var(--surface); border: 1px solid var(--line); border-radius: 0.9rem; }
  .choice { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
  .layout.solo .choice { max-width: 36rem; }
  .tile { display: flex; align-items: center; gap: 0.7rem; min-height: 3.5rem; padding: 0.7rem 0.85rem; border: 1.5px solid var(--line); border-radius: 0.8rem; cursor: pointer; }
  .tile.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, transparent); }
  .tile:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
  .tile input { margin-left: auto; width: 1.2rem; height: 1.2rem; accent-color: var(--accent); flex: none; }
  .copy { display: grid; gap: 0.1rem; min-width: 0; flex: 1; }
  .copy small { color: var(--faint); font-size: var(--t-13-6); line-height: 1.35; }
  .icon { width: 2.4rem; height: 2.4rem; display: grid; place-items: center; border-radius: 0.7rem; background: var(--raised); color: var(--muted); flex: none; }
  .tile.on .icon, .icon.on { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
  .label { display: flex; justify-content: space-between; font-size: var(--t-12-8); font-weight: 700; color: var(--faint); letter-spacing: 0.04em; }
  .way { display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.7rem 0.5rem 0.7rem 0.8rem; border-radius: 0.8rem; background: var(--raised); }
  .way > .icon { background: color-mix(in srgb, var(--accent) 16%, transparent); }
  .remove { width: 2.75rem; height: 2.75rem; display: grid; place-items: center; flex: none; margin-top: -0.15rem; border: 0; border-radius: 50%; background: none; color: var(--faint); }
  .remove:hover { background: var(--hover); color: var(--text); }
  .price-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  .money { display: inline-flex; align-items: center; gap: 0.15rem; height: 2.5rem; padding: 0 0.7rem; border: 1.5px solid var(--line); border-radius: 0.6rem; background: var(--bg); font-weight: 800; }
  .money:focus-within { border-color: var(--accent); }
  .money.bad { border-color: light-dark(#a3271f, #ff8f87); }
  .money input { width: 4.5rem; border: 0; outline: 0; background: none; color: inherit; font: inherit; font-size: max(16px, 1rem); }
  .money small { color: var(--faint); font-weight: 600; font-size: var(--t-12-8); }
  .people { width: 100%; min-width: 0; margin: 0.3rem 0 0.15rem; padding: 0.55rem 0.75rem; border: 1px solid var(--line); border-radius: 0.6rem; background: var(--bg); color: inherit; font-size: max(16px, 1rem); }
  .people:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .soon { display: inline-flex; align-items: center; height: 1.25rem; padding: 0 0.45rem; margin-left: 0.2rem; border-radius: 999px; background: var(--hover); color: var(--faint); font-size: var(--t-11-2); font-weight: 800; white-space: nowrap; }
  .adds { display: flex; flex-wrap: wrap; gap: 0.45rem; }
  .add { display: inline-flex; align-items: center; gap: 0.35rem; min-height: 2.75rem; padding: 0 0.9rem; border-radius: 999px; border: 1.5px dashed var(--line); background: none; color: var(--muted); font-size: var(--t-14); font-weight: 700; }
  .add:hover { border-color: var(--accent); color: var(--text); }
  .note { color: var(--faint); font-size: var(--t-13-6); line-height: 1.4; }
  .problem { color: light-dark(#a3271f, #ff8f87); font-size: var(--t-13-6); margin-top: 0.2rem; }
  .problem a { color: inherit; text-decoration: underline; }
  .more { display: grid; gap: 0.9rem; min-width: 0; padding-top: 0.9rem; border-top: 1px solid var(--line); }
  .sell-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; min-width: 0; margin: 0.3rem 0 0.15rem; }
  .sell-row .people { flex: 1 1 10rem; width: auto; min-width: 0; margin: 0; }
  .switch { display: flex; align-items: center; justify-content: space-between; gap: 1rem; cursor: pointer; }
  .switch span { display: grid; gap: 0.15rem; }
  .switch small { color: var(--faint); font-size: var(--t-13-6); line-height: 1.35; }
  .switch input { appearance: none; flex: none; position: relative; width: 2.6rem; height: 1.5rem; margin: 0; border-radius: 999px; background: var(--hover); cursor: pointer; transition: background 0.15s; }
  .switch input::after { content: ''; position: absolute; left: 0.2rem; top: 0.2rem; width: 1.1rem; height: 1.1rem; border-radius: 50%; background: var(--faint); transition: transform 0.15s; }
  .switch input:checked { background: var(--accent); }
  .switch input:checked::after { transform: translateX(1.1rem); background: var(--on-accent); }
  .switch input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .downloads { display: grid; gap: 0.4rem; margin: 0; padding: 0; border: 0; min-width: 0; }
  .downloads legend { padding: 0; margin-bottom: 0.4rem; font-size: var(--t-12-8); font-weight: 700; color: var(--faint); letter-spacing: 0.04em; }
  .downloads:disabled .pick { opacity: 0.6; cursor: default; }
  .pick { display: flex; align-items: center; gap: 0.7rem; min-height: 2.75rem; padding: 0.55rem 0.75rem; border: 1.5px solid var(--line); border-radius: 0.7rem; cursor: pointer; }
  .pick.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, transparent); }
  .pick:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
  .pick input { width: 1.1rem; height: 1.1rem; margin: 0; accent-color: var(--accent); flex: none; }
  .preview { display: grid; gap: 0.55rem; }
  .cap { display: flex; align-items: center; gap: 0.4rem; font-size: var(--t-12); font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--faint); }
  .locked { display: grid; gap: 0.6rem; padding: 1rem; border-radius: 0.9rem; background: var(--surface); border: 1px solid var(--line); }
  .locked.hidden { display: flex; align-items: center; gap: 0.6rem; color: var(--muted); font-size: var(--t-14-4); line-height: 1.4; }
  .head { display: flex; align-items: center; gap: 0.7rem; }
  .head b { display: block; overflow-wrap: anywhere; }
  .head small { color: var(--faint); font-size: var(--t-12-8); }
  .art { width: 3rem; height: 3rem; flex: none; display: grid; place-items: center; overflow: hidden; border-radius: 0.45rem; background: var(--raised); color: var(--faint); }
  .art img { width: 100%; height: 100%; object-fit: cover; }
  @media (max-width: 720px) {
    .layout { grid-template-columns: minmax(0, 1fr); }
    .tile .icon { display: none; }
    .tile { padding: 0.65rem 0.7rem; }
  }
</style>
