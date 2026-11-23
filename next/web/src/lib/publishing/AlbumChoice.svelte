<script lang="ts" module>
  export type AlbumPick = { uri: string; name: string; cover?: string; count: number };
</script>

<script lang="ts">
  import Artwork from '$lib/ui/Artwork.svelte';
  import Icon from '$lib/ui/Icon.svelte';

  // album is the name written on the track; target is the album it joins. an old draft can carry a name with no album
  let { albums, target = $bindable(), album = $bindable(''), closed = false, disabled = false }: {
    albums: AlbumPick[]; target?: AlbumPick; album: string; closed?: boolean; disabled?: boolean;
  } = $props();
  const SHOWN = 6;
  let expanded = $state(false);
  const loose = $derived(!target && album.trim() && !albums.some(item => item.name === album.trim()) ? album.trim() : '');
  const shown = $derived(expanded ? albums : albums.slice(0, SHOWN));

  function choose(pick?: AlbumPick) {
    target = pick;
    album = pick?.name ?? '';
  }
</script>

<fieldset class="albums" disabled={disabled || closed}>
  <legend>album</legend>
  {#if closed}
    <p class="note">closed tracks can't join an album yet. make it open to add it to one.</p>
  {:else}
    <div class="chips">
      <button type="button" class="chip" aria-pressed={!target && !loose} onclick={() => choose()}>none</button>
      {#if loose}<button type="button" class="chip" aria-pressed="true">{loose}</button>{/if}
      {#each shown as pick (pick.uri)}
        <button type="button" class="chip" aria-pressed={target?.uri === pick.uri} onclick={() => choose(pick)}>
          <span class="art"><Artwork src={pick.cover} size={22} fallbackIcon="disc" /></span>{pick.name}
        </button>
      {/each}
      {#if albums.length > SHOWN}
        <button type="button" class="chip more" aria-expanded={expanded} onclick={() => { expanded = !expanded; }}>
          {expanded ? 'fewer' : `${albums.length - SHOWN} more`}<Icon name="down" size={14} />
        </button>
      {/if}
    </div>
    {#if !albums.length}<p class="note">upload several files at once to start an album.</p>{/if}
  {/if}
</fieldset>

<style>
  .albums { margin: 0; min-width: 0; display: grid; gap: 0.75rem; padding: 1.1rem; border: 1px solid var(--line); border-radius: 0.9rem; background: var(--surface); }
  legend { float: left; width: 100%; padding: 0; font-weight: 700; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.45rem; }
  .chip { display: inline-flex; align-items: center; gap: 0.45rem; min-height: 2.25rem; max-width: 100%; padding: 0 0.85rem; border: 1px solid var(--line); border-radius: 999px; background: var(--raised); color: var(--muted); font-weight: 700; font-size: var(--t-14-4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip:hover:not(:disabled) { color: var(--text); background: var(--hover); }
  .chip[aria-pressed='true'] { background: var(--text); color: var(--bg); border-color: transparent; }
  .chip .art { width: 1.4rem; height: 1.4rem; flex: none; margin-left: -0.4rem; border-radius: 0.3rem; overflow: hidden; }
  .chip.more { color: var(--faint); }
  .chip.more[aria-expanded='true'] :global(svg) { transform: rotate(180deg); }
  .note { margin: 0; color: var(--muted); font-size: var(--t-13-6); }
</style>
