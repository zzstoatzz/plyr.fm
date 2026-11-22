<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { radioStations } from '@plyr/next-core/radio';
  import { player } from '$lib/player.svelte';
  import Artwork from '$lib/ui/Artwork.svelte';
  import { feeds, tuneRadio } from '$lib/radio/station';

  /** What each station is airing, read only while the rail shows it (phones have no rail). */
  let airing = $state.raw(radioStations.map(station => feeds.get(station.slug)?.getSnapshot()));
  onMount(() => {
    const wide = matchMedia('(min-width: 901px)');
    let stop: (() => void)[] = [];
    const watch = () => {
      stop.forEach(off => off());
      stop = wide.matches ? radioStations.map((station, index) => {
        const feed = feeds.get(station.slug);
        return feed?.subscribe(() => { airing = airing.map((state, at) => at === index ? feed.getSnapshot() : state); }) ?? (() => {});
      }) : [];
    };
    watch();
    wide.addEventListener('change', watch);
    return () => { wide.removeEventListener('change', watch); stop.forEach(off => off()); };
  });
</script>

<section class="radio" data-testid="home-radio" aria-labelledby="home-radio">
  <header><h2 id="home-radio">on the radio</h2><a href={resolve('/(app)/radio')}>all stations</a></header>
  <ul>
    {#each radioStations as station, index (station.slug)}
      {@const song = airing[index]?.snapshot?.currentSong}
      {@const tuned = player.liveStation === station}
      <li>
        <button type="button" class:tuned aria-label={`${tuned ? 'Open' : 'Listen to'} ${station.label} radio`} onclick={event => tuneRadio(station, () => player.openNowPlaying(event.detail === 0))}>
          <span class="cover"><Artwork src={song?.artwork ?? undefined} size={80} /></span>
          <span class="copy">
            <strong><i class:on={tuned && player.liveListening} aria-hidden="true"></i>{station.label}</strong>
            <small class="truncate">{song?.live ? 'on air now' : song ? `${song.title} · ${song.artist}` : airing[index]?.error ? 'off air for a moment' : 'tuning in…'}</small>
          </span>
        </button>
      </li>
    {/each}
  </ul>
</section>

<style>
  header { display: flex; justify-content: space-between; align-items: center; gap: 0.65rem; min-height: 2.75rem; padding-bottom: 0.35rem; }
  h2 { font-size: var(--t-16-8); }
  header a { color: var(--muted); font-size: var(--t-12-8); }
  ul { margin: 0; padding: 0; list-style: none; }
  /* the same row as top tracks above it: 1.75rem gutter where the rank sits, 2.5rem cover, 3.6rem tall */
  button { display: grid; grid-template-columns: 2.5rem minmax(0, 1fr); align-items: center; gap: 0.7rem; width: 100%; min-height: 3.6rem; padding: 0 0.375rem 0 2.125rem; border: 0; border-radius: 0.6rem; background: none; color: var(--text); text-align: start; }
  button:hover, button:focus-visible { background: var(--hover); }
  .cover { border-radius: 0.42rem; overflow: hidden; background: var(--raised); }
  .copy { display: grid; min-width: 0; }
  strong { display: flex; align-items: center; gap: 0.4rem; font-weight: 650; }
  i { flex: none; width: 0.4rem; height: 0.4rem; border-radius: 50%; background: var(--faint); }
  i.on { background: var(--accent); }
  .tuned strong { color: var(--accent); }
  small { color: var(--muted); font-size: var(--t-14); }
</style>
