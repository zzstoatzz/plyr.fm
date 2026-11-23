<script lang="ts">
  import { untrack } from 'svelte';
  import { radioStations } from '@plyr/next-core/radio';
  import StationCard from '$lib/radio/StationCard.svelte';
  import { tuneRadio } from '$lib/radio/station';
  import { player } from '$lib/player.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let linked = $derived(data.station);

  // A station link goes straight to that station in now playing, tuned in paused: browsers only start audio on a tap,
  // and whatever the visitor already has playing keeps playing until they choose the station.
  $effect(() => {
    const station = linked;
    if (!station) return;
    // once per link: closing the sheet, or playing and pausing later, must not open it again
    untrack(() => {
      if (player.liveStation === station) player.openNowPlaying();
      else if (!player.playing) tuneRadio(station, () => player.openNowPlaying(), false);
    });
  });
</script>

<svelte:head><title>{linked ? `${linked.label} radio · plyr.fm` : 'radio · plyr.fm'}</title></svelte:head>
<section class="page-content radio">
  <h1>radio</h1>
  <p class="state">always on. pick a station and listen along with everyone else.</p>
  <div data-testid="radio-stations" class="stations">
    {#each radioStations as station (station.slug)}<StationCard {station} />{/each}
  </div>
  {#if player.liveStation}
    {#if player.error}<p role="status" class="state">{player.error}</p>{/if}
    <button type="button" class="text-button" onclick={() => player.stopRadio()}>leave radio</button>
  {/if}
  <details>
    <summary>embed radio in your stream</summary>
    <ul>
      {#each radioStations as station (station.slug)}
        <li><a data-sveltekit-reload href={`/embed/radio?station=${station.slug}&autoplay=1`}>{station.label}</a></li>
      {/each}
    </ul>
  </details>
  <p class="subtle credits"><a href="https://tangled.org/zzstoatzz.io/plyr-radio">source</a> · forked from <a href="https://tangled.org/okami.mom/sister-radio">Ana’s radio</a></p>
</section>

<style>
  .radio { max-width: 64rem; }
  .stations { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.9rem; }
  details { margin-block: 1.3rem 0.8rem; border-block: 1px solid var(--line); }
  summary { cursor: pointer; padding-block: 0.85rem; }
  details a, .credits a { text-decoration: underline; text-underline-offset: 0.2em; }
  .credits { font-size: var(--t-13-6); }
  @media (max-width: 600px) { .stations { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
