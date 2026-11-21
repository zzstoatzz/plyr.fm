<script lang="ts" module>
  import { addTag, removeTag, suggestTags, tagCatalog, tagList, type TagCount } from '@plyr/next-core/publishing/tag-suggestions';
  import { api } from '$lib/api';

  // One catalog load shared by every tag field.
  const loadCatalog = tagCatalog((limit, cursor) => api.tags(limit, undefined, cursor));
</script>

<script lang="ts">
  import { onMount } from 'svelte';

  let { value = $bindable(''), disabled = false, label = 'tags', onedit }: { value: string; disabled?: boolean; label?: string; onedit?: () => void } = $props();

  const id = $props.id();
  let draft = $state('');
  let field = $state<HTMLInputElement>();
  let open = $state(false);
  let active = $state(-1);
  let catalog = $state<TagCount[]>([]);
  const tags = $derived(tagList(value));
  const suggestions = $derived(open ? suggestTags(catalog, draft, tags) : []);
  const full = $derived(tags.length >= 20);

  // Load before the first keystroke so suggestions are ready when typing starts.
  onMount(load);

  function load() {
    if (catalog.length) return;
    loadCatalog().then(found => { catalog = found; }, () => {});
  }

  function set(next: string) {
    if (next === value) return;
    value = next;
    onedit?.();
  }

  function commit(tag: string) {
    if (tag.trim()) set(addTag(value, tag));
    draft = '';
    active = -1;
  }

  function input(event: Event & { currentTarget: HTMLInputElement }) {
    const parts = event.currentTarget.value.split(',');
    open = true;
    active = -1;
    if (parts.length === 1) { draft = parts[0]; return; }
    let next = value;
    for (const part of parts.slice(0, -1)) next = addTag(next, part);
    set(next);
    draft = parts.at(-1)!;
  }

  function keydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(active >= 0 && suggestions[active] ? suggestions[active].name : draft);
    } else if (event.key === 'Backspace' && !draft && tags.length) {
      set(removeTag(value, tags.at(-1)!));
    } else if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      active = Math.min(active + 1, suggestions.length - 1);
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault();
      active = Math.max(active - 1, -1);
    } else if (event.key === 'Escape' && open && suggestions.length) {
      event.preventDefault();
      open = false;
      active = -1;
    }
  }

  function focusout(event: FocusEvent & { currentTarget: HTMLElement }) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    // Keep what was typed: leaving the field adds it, as on production.
    commit(draft);
    open = false;
  }
</script>

<div class="tag-input" onfocusout={focusout}>
  <label class="label" for="{id}-input">{label}</label>
  <div class="anchor">
  <div class="box" class:disabled>
    {#each tags as tag (tag)}
      <span class="chip">{tag}<button type="button" aria-label="remove {tag}" {disabled} onclick={() => { set(removeTag(value, tag)); field?.focus(); }}>×</button></span>
    {/each}
    <input bind:this={field} id="{id}-input" value={draft} disabled={disabled} readonly={full} autocomplete="off" autocapitalize="none" spellcheck="false"
        placeholder={full ? '' : tags.length ? 'add another' : 'add a tag'} role="combobox" aria-autocomplete="list"
        aria-expanded={suggestions.length > 0} aria-controls="{id}-list"
        aria-activedescendant={active >= 0 ? `${id}-option-${active}` : undefined}
        oninput={input} onkeydown={keydown} onfocus={() => { open = true; load(); }} />
  </div>
  {#if suggestions.length}
    <ul id="{id}-list" role="listbox" aria-label="existing tags">
      {#each suggestions as tag, at (tag.name)}
        <li id="{id}-option-{at}" role="option" aria-selected={at === active}>
          <button type="button" tabindex="-1" class:active={at === active} onmousedown={event => event.preventDefault()} onclick={() => commit(tag.name)}>
            <span>{tag.name}</span><small>{tag.track_count} {tag.track_count === 1 ? 'track' : 'tracks'}</small>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  </div>
  <p class="hint">{full ? 'that’s 20 tags, the most a track can have.' : 'type to see tags already on plyr.fm. use ai for AI-generated music.'}</p>
</div>

<style>
  .tag-input { display: grid; gap: 0.4rem; min-width: 0; }
  .label { font-size: 0.8rem; font-weight: 700; color: var(--faint); letter-spacing: 0.04em; }
  .box { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; min-height: 2.75rem; padding: 0.35rem 0.45rem; border: 1px solid var(--line); border-radius: 0.65rem; background: var(--bg); }
  .box:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }
  .box.disabled { opacity: 0.6; }
  .chip { display: inline-flex; align-items: center; gap: 0.15rem; padding: 0.15rem 0.2rem 0.15rem 0.6rem; border-radius: 999px; background: color-mix(in srgb, var(--accent) 14%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); font-size: 0.9rem; line-height: 1.3; }
  .chip button { display: grid; place-items: center; width: 1.4rem; height: 1.4rem; padding: 0; border: 0; border-radius: 50%; background: none; color: var(--muted); font-size: 1rem; line-height: 1; cursor: pointer; }
  .chip button:hover { background: var(--hover); color: inherit; }
  input { flex: 1 1 8rem; min-width: 8rem; padding: 0.3rem 0.35rem; border: 0; background: none; color: inherit; font-size: max(16px, 1rem); outline: none; }
  .anchor { position: relative; }
  ul { position: absolute; z-index: 20; top: calc(100% + 0.3rem); left: 0; right: 0; margin: 0; padding: 0.25rem; list-style: none; background: var(--surface); border: 1px solid var(--line); border-radius: 0.65rem; box-shadow: 0 10px 28px #0000002e; max-height: 16rem; overflow-y: auto; }
  ul button { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 1rem; min-height: 2.5rem; padding: 0 0.7rem; border: 0; border-radius: 0.45rem; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  ul button:hover, ul button.active { background: var(--hover); }
  ul small { color: var(--muted); font-size: 0.8rem; white-space: nowrap; }
  .hint { margin: 0; color: var(--muted); font-size: 0.8rem; }
</style>
