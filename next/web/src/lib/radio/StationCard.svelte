<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { RadioStation } from '@plyr/next-core/radio';
  import { player } from '$lib/player.svelte';
  import Artwork from '$lib/ui/Artwork.svelte';
  import { preloadLiveStream } from '$lib/media/live-stream';
  import { feeds, tuneRadio } from './station';

  let { station }: { station: RadioStation } = $props();
  let feedState = $state.raw(untrack(() => feeds.get(station.slug)?.getSnapshot()));
  let active = $derived(player.liveStation === station);
  let featured = $derived('about' in station);
  let song = $derived(feedState?.snapshot?.currentSong);

  $effect(() => { if (song?.live) preloadLiveStream().catch(() => {}); });

  onMount(() => {
    const feed = feeds.get(station.slug);
    return feed?.subscribe(() => { feedState = feed.getSnapshot(); });
  });
</script>

<button class="station" class:featured class:active type="button"
  aria-label={`${active ? 'Open' : 'Listen to'} ${station.label} radio`} onclick={event => {
    const keyboard = event.detail === 0;
    tuneRadio(station, () => player.openNowPlaying(keyboard));
  }}>
  <span class="cover"><Artwork src={song?.artwork ?? undefined} size={225} eager /></span>
  <span class="info">
    <strong><span class="dot" class:on={active && player.liveListening}></span>{station.label}</strong>
    {#if 'about' in station}<span class="subtle about">{station.about}</span>{/if}
    <span class="subtle truncate">{song?.live ? 'on air now' : song ? song.title + ' · ' + song.artist : feedState?.error ? 'off air for a moment' : 'tuning in…'}</span>
  </span>
</button>

<style>
  .station { display: grid; align-content: start; gap: 0.45rem; padding: 0; width: 100%; min-width: 0; color: var(--text); text-align: start; background: none; border: 0; border-radius: 0.65rem; }
  .cover { width: 100%; border-radius: 0.65rem; overflow: hidden; position: relative; background: var(--raised); }
  .cover::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text), transparent 72%); background: linear-gradient(135deg, rgb(255 255 255 / 0.17), transparent 55%); pointer-events: none; }
  .active .cover::after { box-shadow: inset 0 0 0 2px var(--accent); }
  .station:hover strong { text-decoration: underline; }
  .info { min-width: 0; display: grid; gap: 0.1rem; }
  strong { display: flex; align-items: center; gap: 0.35rem; }
  .dot { width: 0.4rem; height: 0.4rem; border-radius: 50%; background: var(--faint); }
  .dot.on { background: var(--accent); }
  .subtle { font-size: 0.82rem; }
  .featured { grid-column: 1 / -1; grid-template-columns: max(7rem, min(23%, 11rem)) minmax(0, 1fr); align-items: center; gap: 1rem; border: 1px solid var(--line); background: var(--surface); overflow: hidden; }
  .featured .cover { border-radius: 0; }
  .featured .info { padding-inline-end: 0.45rem; }
  .featured.active { outline: 2px solid var(--accent); }
</style>
