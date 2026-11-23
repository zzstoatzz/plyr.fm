<script lang="ts">
  import { radioStationPath, radioStations } from '@plyr/next-core/radio';
  import StationCard from '$lib/radio/StationCard.svelte';
  import { tuneRadio } from '$lib/radio/station';
  import { player } from '$lib/player.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let linked = $derived(data.station);
  let copied = $state(false);

  async function share() {
    if (!linked) return;
    const url = new URL(radioStationPath(linked), location.origin).href;
    try {
      if (navigator.share) await navigator.share({ title: `${linked.label} radio`, url });
      else {
        await navigator.clipboard.writeText(url);
        copied = true;
      }
    } catch {}
  }
</script>

<svelte:head><title>{linked ? `${linked.label} radio · plyr.fm` : 'radio · plyr.fm'}</title></svelte:head>
<section class="page-content radio">
  <h1>radio</h1>
  <p class="state">always on. pick a station and listen along with everyone else.</p>
  {#if linked}
    <div class="linked" data-testid="radio-linked">
      <strong>{linked.label} radio</strong>
      <div class="actions">
        {#if player.liveStation !== linked || !player.liveListening}
          <button type="button" class="hero-pill primary" onclick={event => tuneRadio(linked, () => player.openNowPlaying(event.detail === 0))}>
            <Icon name="play" size={18} />listen
          </button>
        {/if}
        <button type="button" class="hero-pill" onclick={share}><Icon name="share" size={18} />{copied ? 'link copied' : 'share'}</button>
      </div>
    </div>
  {/if}
  <div data-testid="radio-stations" class="stations">
    {#each radioStations as station (station.slug)}<StationCard {station} linked={station === linked} />{/each}
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
  .linked { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; margin-block: 0 1rem; padding: 0.75rem 0.9rem; border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--line)); border-radius: 0.75rem; background: var(--surface); }
  .linked strong { font-size: var(--t-16-8); }
  .actions { display: flex; gap: 0.5rem; }
  .stations { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.9rem; }
  details { margin-block: 1.3rem 0.8rem; border-block: 1px solid var(--line); }
  summary { cursor: pointer; padding-block: 0.85rem; }
  details a, .credits a { text-decoration: underline; text-underline-offset: 0.2em; }
  .credits { font-size: var(--t-13-6); }
  @media (max-width: 600px) { .stations { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
