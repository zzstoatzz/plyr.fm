<script lang="ts">
  import type { Track } from '@plyr/next-core/api';
  import { trackArtwork } from '@plyr/next-core/artwork';
  import { catalogDuration } from '@plyr/next-core/catalog/owned';
  import { tracksContext } from '@plyr/next-core/play-context';
  import { contextState } from '$lib/play-control.svelte';
  import { shuffled } from '@plyr/next-core/queue-state';
  import { player } from '$lib/player.svelte';
  import Artwork from '$lib/ui/Artwork.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import PlayButton from '$lib/ui/PlayButton.svelte';

  /** liked tracks or your uploads, collapsed to one tile: open it for the list, or play and shuffle from here. */
  let { title, href, tracks, failed = false, liked = false }: {
    title: string; href: string;
    /** undefined while the first read is in flight */
    tracks: Track[] | undefined;
    failed?: boolean; liked?: boolean;
  } = $props();

  const list = $derived(tracks ?? []);
  const covers = $derived([...new Set(list.flatMap(track => trackArtwork(track) ?? []))].slice(0, 4));
  const seconds = $derived(list.reduce((total, track) => total + (track.metadata.duration_seconds ?? 0), 0));
  const summary = $derived(failed ? 'could not load' : !tracks ? 'loading…'
    : !list.length ? 'nothing yet'
    : `${list.length} ${list.length === 1 ? 'track' : 'tracks'}${seconds ? ' · ' + catalogDuration(seconds) : ''}`);

  function shuffle() {
    // never open on the track already on air
    const order = shuffled(list, track => contextState(tracksContext([track])) !== 'idle');
    if (order[0]) player.play(order[0], order, title);
  }
</script>

<div class="collection">
  <a class="open" {href} aria-label={`open ${title}`}></a>
  <span class="cover" class:liked class:mosaic={covers.length === 4}>
    {#if covers.length === 4}
      {#each covers as cover (cover)}<Artwork src={cover} size={56} />{/each}
    {:else if covers[0]}
      <Artwork src={covers[0]} size={112} />
    {/if}
    {#if liked}<span class="glyph"><Icon name="heart_f" size={28} /></span>{:else if !covers.length}<span class="glyph"><Icon name="upload" size={26} /></span>{/if}
  </span>
  <span class="text"><strong>{title}</strong><span class="subtle">{summary}</span></span>
  <span class="actions">
    <PlayButton class="hero-round play" name={title} context={tracksContext(list)} disabled={!list.length} start={() => player.play(list[0], list, title)} />
    <button type="button" class="hero-round" aria-label={`Shuffle ${title}`} title="shuffle" disabled={list.length < 2} onclick={shuffle}><Icon name="shuffle" /></button>
  </span>
  <span class="chevron" aria-hidden="true"><Icon name="chevron" /></span>
</div>

<style>
  .collection { position: relative; display: grid; grid-template-columns: 6.5rem minmax(0, 1fr) auto auto; align-items: center; gap: 1.1rem; padding: 0.9rem 1.1rem 0.9rem 0.9rem; background: var(--surface); border: 1px solid var(--line); border-radius: 1rem; }
  .collection:has(.open:hover) { background: var(--hover); }
  .open { position: absolute; inset: 0; border-radius: inherit; }
  .open:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .cover { position: relative; display: grid; width: 100%; aspect-ratio: 1; border-radius: 0.6rem; overflow: hidden; background: var(--raised); pointer-events: none; }
  .cover.mosaic { grid-template-columns: 1fr 1fr; }
  .cover :global(.artwork) { border-radius: 0; }
  .cover.liked { background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 30%, var(--raised)), var(--raised)); }
  .cover.liked :global(.artwork) { filter: saturate(0.7) brightness(0.55); }
  .glyph { position: absolute; inset: 0; display: grid; place-items: center; color: var(--faint); }
  .liked .glyph { color: var(--accent); filter: drop-shadow(0 2px 6px rgb(0 0 0 / 0.45)); }
  .text { display: grid; gap: 0.15rem; min-width: 0; pointer-events: none; }
  strong { font-size: 1.35rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .subtle { color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .actions { position: relative; display: inline-flex; gap: 0.5rem; }
  .actions :global(.play:not(:disabled)) { background: var(--accent); color: var(--on-accent); }
  .actions :global(button:disabled) { opacity: 0.45; }
  .chevron { display: inline-flex; color: var(--faint); pointer-events: none; }
  @media (max-width: 720px) {
    .collection { grid-template-columns: 4.5rem minmax(0, 1fr) auto; gap: 0.8rem; padding: 0.7rem; }
    strong { font-size: var(--t-17-6); }
    .subtle { white-space: normal; }
    .chevron { display: none; }
    .actions :global(.hero-round) { width: 2.75rem; height: 2.75rem; }
  }
</style>
