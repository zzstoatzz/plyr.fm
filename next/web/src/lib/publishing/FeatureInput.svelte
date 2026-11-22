<script lang="ts">
  import type { SearchHit } from '@plyr/next-core/api';
  import type { FeaturedArtist } from '@plyr/next-core/pds';
  import { memberDid } from '@plyr/next-core/access/policy-read';
  import { api } from '$lib/api';
  import Artwork from '$lib/ui/Artwork.svelte';

  // featured artists: pick from plyr.fm artists as you type, or enter any handle
  let { value = $bindable([]), disabled = false, owner }: { value: FeaturedArtist[]; disabled?: boolean; owner?: string } = $props();

  const id = $props.id();
  const MAX = 10;
  let draft = $state('');
  let field = $state<HTMLInputElement>();
  let hits = $state.raw<SearchHit[]>([]);
  let open = $state(false);
  let active = $state(-1);
  let problem = $state('');
  let resolving = $state(false);
  const full = $derived(value.length >= MAX);
  const options = $derived(open ? hits.filter(hit => hit.owner.did !== owner && !value.some(artist => artist.did === hit.owner.did)) : []);

  $effect(() => {
    const q = draft.trim().replace(/^@/, '');
    if (q.length < 2) { hits = []; return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.search(q, { types: 'artist', limit: 6, signal: controller.signal }).then(page => { hits = page.data; }, () => {});
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  });

  function add(artist: FeaturedArtist) {
    problem = '';
    if (artist.did === owner) { problem = 'that’s you. you’re already the artist.'; return; }
    if (!value.some(item => item.did === artist.did) && value.length < MAX) value = [...value, artist];
    draft = '';
    active = -1;
    hits = [];
  }

  async function commit() {
    const text = draft.trim();
    if (!text) return;
    if (active >= 0 && options[active]) { const { did, handle, display_name } = options[active].owner; add({ did, handle, displayName: display_name }); return; }
    resolving = true;
    problem = '';
    try {
      const did = await memberDid(text);
      const handle = text.replace(/^@/, '');
      add({ did, ...(handle.startsWith('did:') ? {} : { handle }) });
    } catch (failure) {
      // keep what they typed so they can fix it
      problem = failure instanceof Error ? failure.message : 'could not find that account.';
    } finally { resolving = false; }
  }

  function keydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'Enter' || (event.key === ',' && draft.trim())) {
      event.preventDefault();
      void commit();
    } else if (event.key === 'Backspace' && !draft && value.length) {
      value = value.slice(0, -1);
    } else if (event.key === 'ArrowDown' && options.length) {
      event.preventDefault();
      active = Math.min(active + 1, options.length - 1);
    } else if (event.key === 'ArrowUp' && options.length) {
      event.preventDefault();
      active = Math.max(active - 1, -1);
    } else if (event.key === 'Escape' && open && options.length) {
      event.preventDefault();
      open = false;
    }
  }

  function focusout(event: FocusEvent & { currentTarget: HTMLElement }) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    open = false;
  }
</script>

<div class="feature-input" onfocusout={focusout}>
  <label class="label" for="{id}-input">featuring</label>
  <div class="anchor">
    <div class="box" class:disabled>
      {#each value as artist (artist.did)}
        <span class="chip">{artist.displayName || artist.handle || artist.did}<button type="button" aria-label="remove {artist.displayName || artist.handle || 'artist'}{artist.displayName && artist.handle ? ` (@${artist.handle})` : ''}" {disabled} onclick={() => { value = value.filter(item => item.did !== artist.did); field?.focus(); }}>×</button></span>
      {/each}
      <input bind:this={field} id="{id}-input" bind:value={draft} {disabled} readonly={full || resolving} autocomplete="off" autocapitalize="none" spellcheck="false"
        placeholder={full ? '' : value.length ? 'add another' : 'add someone by name or handle'} role="combobox" aria-autocomplete="list"
        aria-expanded={options.length > 0} aria-controls="{id}-list" aria-invalid={!!problem} aria-describedby={problem ? `${id}-problem` : undefined}
        aria-activedescendant={active >= 0 ? `${id}-option-${active}` : undefined}
        oninput={() => { open = true; active = -1; problem = ''; }} onkeydown={keydown} onfocus={() => { open = true; }} />
    </div>
    {#if options.length}
      <ul id="{id}-list" role="listbox" aria-label="artists on plyr.fm">
        {#each options as hit, at (hit.owner.did)}
          <li id="{id}-option-{at}" role="option" aria-selected={at === active}>
            <button type="button" tabindex="-1" class:active={at === active} onmousedown={event => event.preventDefault()} onclick={() => add({ did: hit.owner.did, handle: hit.owner.handle, displayName: hit.owner.display_name })}>
              <Artwork src={hit.image_url ?? undefined} size={28} fallbackIcon="user" />
              <span>{hit.owner.display_name || hit.owner.handle}</span><small>@{hit.owner.handle}</small>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
  {#if problem}<p class="problem" id="{id}-problem" role="alert">{problem}</p>
  {:else if resolving}<p class="hint" role="status">looking them up…</p>{/if}
</div>

<style>
  .feature-input { display: grid; gap: 0.4rem; min-width: 0; }
  .label { font-size: var(--t-12-8); font-weight: 700; color: var(--faint); letter-spacing: 0.04em; }
  .box { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; min-height: 2.75rem; padding: 0.35rem 0.45rem; border: 1px solid var(--line); border-radius: 0.65rem; background: var(--bg); }
  .box:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }
  .box.disabled { opacity: 0.6; }
  .chip { display: inline-flex; align-items: center; gap: 0.15rem; padding: 0.15rem 0.2rem 0.15rem 0.6rem; border-radius: 999px; background: var(--raised); border: 1px solid var(--line); font-size: var(--t-14-4); font-weight: 650; line-height: 1.3; }
  .chip button { position: relative; display: grid; place-items: center; width: 1.4rem; height: 1.4rem; padding: 0; border: 0; border-radius: 50%; background: none; color: var(--muted); font-size: var(--t-16); line-height: 1; cursor: pointer; }
  /* a 44px target around the small glyph */
  .chip button::after { content: ''; position: absolute; inset: -0.6rem; }
  .chip button:hover { background: var(--hover); color: inherit; }
  input { flex: 1 1 8rem; min-width: 8rem; padding: 0.3rem 0.35rem; border: 0; background: none; color: inherit; font-size: max(16px, 1rem); outline: none; }
  .anchor { position: relative; }
  ul { position: absolute; z-index: 20; top: calc(100% + 0.3rem); left: 0; right: 0; margin: 0; padding: 0.25rem; list-style: none; background: var(--surface); border: 1px solid var(--line); border-radius: 0.65rem; box-shadow: 0 10px 28px #0000002e; max-height: 16rem; overflow-y: auto; }
  ul button { display: flex; width: 100%; align-items: center; gap: 0.6rem; min-height: 2.75rem; padding: 0 0.7rem; border: 0; border-radius: 0.45rem; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  ul button span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  ul button:hover, ul button.active { background: var(--hover); }
  ul small { color: var(--muted); font-size: var(--t-12-8); white-space: nowrap; }
  .hint { margin: 0; color: var(--muted); font-size: var(--t-12-8); }
  .problem { margin: 0; color: light-dark(#a3271f, #ff8f87); font-size: var(--t-13-6); }
</style>
