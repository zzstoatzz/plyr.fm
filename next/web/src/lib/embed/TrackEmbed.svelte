<script lang="ts">
  import { onMount } from 'svelte';
  import type { Track } from '@plyr/next-core/api';
  import { canToggleTrack } from '@plyr/next-core/track-revision';
  import { player } from '$lib/player.svelte';
  import Scrub from '$lib/Scrub.svelte';
  import { artistName, trackHref } from '$lib/tracks';
  import Artwork from '$lib/ui/Artwork.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import { canEmbed, embedArtwork } from './catalog';

  let { track, autoplay }: { track: Track; autoplay: boolean } = $props();
  let active = $derived(canToggleTrack(player.current, track));
  let allowed = $derived(canEmbed(track));
  let playing = $derived(active && player.playing);
  let problem = $derived(active && player.error);

  onMount(() => {
    if (!autoplay || !allowed) return;
    const task = requestAnimationFrame(() => player.play(track));
    return () => cancelAnimationFrame(task);
  });

  function toggle() {
    if (!allowed) return;
    if (active && !problem) player.toggle();
    else player.play(track);
  }
</script>

<div class="track-embed" data-testid="track-embed">
  <div class="picture"><Artwork src={embedArtwork(track)} size={320} eager /></div>
  <div class="body">
    <button type="button" class="primary-button play" aria-label={!allowed ? 'Playback unavailable' : problem ? 'Retry playback' : playing ? 'Pause' : 'Play'}
      disabled={!allowed || (active && player.loading)} onclick={toggle}>
      <Icon name={playing ? 'pause' : 'play'} />
    </button>
    <div class="meta">
      <a class="title truncate" href={trackHref(track)} target="_blank" rel="noopener">{track.metadata.title}</a>
      <span class="subtle truncate">{!allowed ? 'playback unavailable in this embed' : problem || artistName(track)}</span>
      {#if active && allowed}<Scrub />{/if}
    </div>
    <a class="brand" href="/" target="_blank" rel="noopener">plyr.fm</a>
  </div>
</div>

<style>
  .track-embed { display: grid; grid-template-columns: min(40vw, 100vh) minmax(0, 1fr); min-height: 88px; height: 100dvh; background: var(--bg); }
  .picture { position: relative; min-width: 0; overflow: hidden; background: var(--raised); }
  .picture :global(.artwork) { position: absolute; inset: 0; height: 100%; }
  .body { display: flex; gap: 0.6rem; align-items: center; padding: 0.65rem; min-width: 0; }
  .meta { display: grid; gap: 0.25rem; flex: 1; min-width: 0; }
  .title { font-weight: 700; }
  .meta > span, .brand { font-size: 0.78rem; }
  .brand { align-self: end; white-space: nowrap; }
  .play { flex: none; }
  @media (orientation: portrait) and (min-height: 200px) {
    .track-embed { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) auto; }
  }
  @media (max-width: 340px) { .brand { display: none; } }
</style>
