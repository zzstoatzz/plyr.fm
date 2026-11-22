<script lang="ts">
  import { page } from '$app/state';
  import { onMount, untrack } from 'svelte';
  import { radioStations } from '@plyr/next-core/radio';
  import type { RadioFeedState } from '@plyr/next-core/radio-feed';
  import { feeds, tuneRadio } from '$lib/radio/station';
  import { player } from '$lib/player.svelte';
  import { showsPause, stationContext } from '@plyr/next-core/play-context';
  import { contextState, pressContext } from '$lib/play-control.svelte';
  import Artwork from '$lib/ui/Artwork.svelte';
  import Icon from '$lib/ui/Icon.svelte';

  const station = $derived(radioStations.find(item => item.slug === page.url.searchParams.get('station')) ?? radioStations[0]);
  let feedState = $state.raw<RadioFeedState>();
  let active = $state(false);
  let song = $derived(feedState?.snapshot?.currentSong);
  let playing = $derived(showsPause(contextState(stationContext(station.slug))));

  onMount(() => {
    active = true;
    return () => { active = false; player.stopRadio(); };
  });

  $effect(() => {
    if (!active) return;
    const feed = feeds.get(station.slug);
    if (!feed) return;
    const autoplay = page.url.searchParams.get('autoplay') === '1';
    let started = false;
    const update = () => {
      feedState = feed.getSnapshot();
      if (autoplay && !started && feedState.snapshot?.currentSong) {
        started = true;
        tuneRadio(station);
      }
    };
    const stop = feed.subscribe(update);
    untrack(update);
    return () => { stop(); if (player.liveStation?.slug === station.slug) player.stopRadio(); };
  });

  function toggle() {
    pressContext(stationContext(station.slug), () => tuneRadio(station));
  }
</script>

<svelte:head><title>{station.label} radio · plyr.fm</title></svelte:head>
<div class="radio-card" data-testid="radio-embed">
  <span class="cover"><Artwork src={song?.artwork ?? undefined} size={48} eager /></span>
  <div class="meta">
    <strong class="truncate">{song?.title || `${station.label} radio`}</strong>
    <span class="subtle truncate">{player.error || (song ? `${song.artist} · ${station.label} radio` : feedState?.error || 'tuning in…')}</span>
  </div>
  {#if song}
    <button class="icon-button" type="button" aria-label={playing ? 'Pause' : 'Listen live'} onclick={toggle}><Icon name={playing ? 'pause' : 'play'} size={20} /></button>
  {/if}
</div>

<style>
  .radio-card { width: min(calc(100% - 1rem), 21.5rem); display: flex; align-items: center; gap: 0.55rem; margin: 0.5rem; padding: 0.5rem; background: var(--bg); border-radius: 0.75rem; }
  .cover { flex: 0 0 3rem; border-radius: 0.35rem; }
  .meta { display: grid; gap: 0.1rem; flex: 1; min-width: 0; }
  .meta span { font-size: var(--t-12-8); }
</style>
