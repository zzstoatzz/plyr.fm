<script lang="ts">
  import { canToggleTrack } from '@plyr/next-core/track-revision';
  import { player } from '$lib/player.svelte';
  import { artistName, trackHref } from '$lib/tracks';
  import Artwork from '$lib/ui/Artwork.svelte';

  import { canEmbed, embedArtwork, type catalogEmbed } from './catalog';

  let { data }: { data: Awaited<ReturnType<typeof catalogEmbed>> } = $props();
  const playable = $derived(data.tracks.filter(canEmbed));
  const cover = $derived(!data.tracks[0] || canEmbed(data.tracks[0]) ? data.artwork ?? undefined : undefined);
</script>

<section class="catalog-embed">
  <header>
    <div class="cover"><Artwork src={cover} size={64} eager /></div>
    <div><h1>{data.title}</h1>{#if data.subtitle}<p class="subtle">{data.subtitle}</p>{/if}</div>
  </header>
  {#each data.tracks as track}
    {@const current = canToggleTrack(player.current, track)}
    <div class="row">
      <button class="icon-button cover" type="button" aria-label={`${current && player.playing ? 'Pause' : 'Play'} ${track.metadata.title}`} disabled={!canEmbed(track)}
        onclick={() => current ? player.toggle() : player.play(track, playable, data.title)}>
        <Artwork src={embedArtwork(track)} size={42} />
      </button>
      <div class="name">
        <a class="truncate" href={trackHref(track)} target="_blank" rel="noopener">{track.metadata.title}</a>
        <span class="subtle truncate">{canEmbed(track) ? artistName(track) : 'playback unavailable'}</span>
      </div>
    </div>
  {:else}<p class="state">no tracks available.</p>{/each}
  {#if player.error}<p role="status" class="state">{player.error}</p>{/if}
</section>

<style>
  .catalog-embed { padding: 0.8rem; background: var(--bg); }
  header, .row { display: flex; gap: 0.7rem; align-items: center; }
  header { margin-bottom: 0.75rem; }
  header .cover { width: 4rem; }
  h1 { font-size: var(--t-18-4); overflow-wrap: anywhere; }
  .row { padding-block: 0.3rem; border-top: 1px solid var(--line); }
  .row .cover { width: 2.75rem; padding: 0; }
  .cover { border-radius: 0.4rem; overflow: hidden; flex: none; }
  .name { display: grid; min-width: 0; }
  .name span { font-size: var(--t-12-8); }
</style>
