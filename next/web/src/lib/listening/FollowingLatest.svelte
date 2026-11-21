<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import type { Track } from '@plyr/next-core/api';
  import { trackArtwork } from '@plyr/next-core/artwork';
  import { canToggleTrack } from '@plyr/next-core/track-revision';
  import { auth } from '$lib/auth';
  import { player } from '$lib/player.svelte';
  import { artistName, clock, trackHref } from '$lib/tracks';
  import Icon from '$lib/ui/Icon.svelte';
  import Artwork from '$lib/ui/Artwork.svelte';
  import Loading from '$lib/ui/Loading.svelte';
  import PlayingWave from '$lib/ui/PlayingWave.svelte';
  import { postedAt } from './format';
  import { newFromFollows } from './following';
  let account = $state.raw(auth.getAuth());
  let tracks = $state.raw<Track[]>([]);
  let pending = $state(false);
  let failed = $state(false);
  let attempt = $state(0);
  let strip: HTMLDivElement | undefined = $state();
  let edges = $state({ start: true, end: true });
  onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
  $effect(() => {
    const { did, ready, rpc } = account;
    const refresh = attempt;
    tracks = [];
    failed = false;
    if (!did || !ready) { pending = false; return; }
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && auth.getAuth().rpc === rpc;
    pending = true;
    void newFromFollows(did, controller.signal, refresh > 0).then(result => {
      if (current()) { tracks = result.tracks; failed = result.failed > 0; }
    }, () => { if (current()) failed = true; }).finally(() => { if (current()) pending = false; });
    return () => controller.abort();
  });
  const label = 'new from people you know';
  const current = (track: Track) => !player.liveStation && canToggleTrack(player.current, track, !!player.jam);
  const playing = (track: Track) => current(track) && player.playing && !player.outputElsewhere;
  function play(track: Track) {
    if (current(track)) player.toggle();
    else player.play(track, tracks, label);
  }
  function measure() {
    if (!strip) return;
    edges = { start: strip.scrollLeft <= 1, end: strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1 };
  }
  function page(direction: 1 | -1) {
    strip?.scrollBy({ left: direction * strip.clientWidth * 0.8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  $effect(() => {
    if (!strip || !tracks.length) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  });
</script>

{#if account.did && (pending || failed || tracks.length)}
  <section class="following" aria-label="New from people you know" data-testid="following-latest">
    <header>
      <h2>{label}</h2>
      {#if tracks.length > 1}<button class="text-button each" type="button" aria-label="play one from each" title="play one from each" onclick={() => player.play(tracks[0], tracks, label)}><Icon name="shuffle" size={15} /><span>play one from each</span></button>{/if}
      {#if !(edges.start && edges.end)}<span class="pager"><button class="icon-button" type="button" aria-label="Scroll back" disabled={edges.start} onclick={() => page(-1)}><Icon name="back" size={18} /></button><button class="icon-button" type="button" aria-label="Scroll forward" disabled={edges.end} onclick={() => page(1)}><Icon name="chevron" size={18} /></button></span>{/if}
    </header>
    {#if pending}<Loading label="finding new music from people you know" inline />{/if}
    {#if tracks.length}
      <div class="releases" bind:this={strip} onscroll={measure}>
        {#each tracks as track (track.id)}
          {@const artist = resolve('/(app)/u/[actor]', { actor: track.artist.profile.handle || track.artist.did })}
          <article class:current={current(track)} data-track-id={track.id}>
            <button class="playback" type="button" aria-label={`${playing(track) ? 'Pause' : 'Play'} ${track.metadata.title} by ${artistName(track)}`} onclick={() => play(track)}>
              <span class="cover"><Artwork src={trackArtwork(track)} size={44} /><span class="play" class:on={playing(track)}>{#if playing(track)}<PlayingWave />{:else}<Icon name="play" size={18} />{/if}</span></span>
              <span class="face"><Artwork src={track.artist.profile.avatar_url ?? undefined} size={20} fallbackIcon="user" /></span>
            </button>
            <div class="copy">
              <a class="title truncate" href={trackHref(track)}>{track.metadata.title}</a>
              <span class="meta truncate"><a class="who" href={artist}>{artistName(track)}</a> · <time datetime={track.metadata.created_at}>{postedAt(track.metadata.created_at)}</time></span>
            </div>
            <span class="duration">{clock(track.metadata.duration_seconds)}</span>
          </article>
        {/each}
      </div>
    {/if}
    {#if failed}<p class="state">{tracks.length ? 'some new music could not load.' : 'could not load new music from people you know.'} <button class="text-button" type="button" onclick={() => { attempt++; }}>try again</button></p>{/if}
  </section>
{/if}

<style>
  .following { grid-area: following; min-width: 0; }
  header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.4rem; min-height: 2.75rem; }
  h2 { font-size: 1.07rem; margin-right: auto; }
  .each { display: inline-flex; align-items: center; gap: 0.4rem; color: var(--muted); font-size: 0.8rem; padding-inline: 0; }
  .each:hover { color: var(--text); }
  .pager { display: flex; color: var(--muted); }
  .pager button:disabled { opacity: 0.35; }
  .releases { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(16rem, calc((100% - 2 * 0.75rem) / 3.15)); gap: 0.75rem; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory; scrollbar-width: none; margin-inline: -0.375rem; }
  .releases::-webkit-scrollbar { display: none; }
  article { --pad: 0.375rem; --ring: var(--bg); position: relative; min-width: 0; display: flex; align-items: center; gap: 0.7rem; padding: var(--pad); border-radius: 0.6rem; scroll-snap-align: start; }
  article:has(:focus-visible) { background: var(--hover); }
  @media (hover: hover) { article:hover { background: var(--hover); } }
  .playback { position: static; flex: none; border: 0; padding: 0; background: transparent; border-radius: 0.375rem; }
  .playback::after { content: ''; position: absolute; inset: 0; z-index: 1; border-radius: 0.6rem; }
  .cover { position: relative; display: block; width: 2.75rem; border-radius: 0.375rem; overflow: hidden; }
  .play { position: absolute; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / 0.5); color: white; opacity: 0; }
  .play.on, .playback:focus-visible .play { opacity: 1; }
  @media (hover: hover) { article:hover .play { opacity: 1; } }
  .face { position: absolute; left: calc(var(--pad) + 2.75rem - 1rem); top: calc(var(--pad) + 2.75rem - 1rem); width: 1.25rem; border: 2px solid var(--ring); border-radius: 50%; overflow: hidden; box-sizing: content-box; }
  article:has(:focus-visible) .face { border-color: var(--hover); }
  @media (hover: hover) { article:hover .face { border-color: var(--hover); } }
  .copy { flex: 1; min-width: 0; display: grid; }
  .copy a { position: relative; z-index: 2; max-width: 100%; }
  .title { font-size: 0.9rem; font-weight: 650; justify-self: start; }
  .current .title { color: var(--accent); }
  .meta { font-size: 0.78rem; color: var(--faint); }
  .who { color: var(--muted); font-weight: 650; }
  .duration { color: var(--faint); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
  @media (hover: none), (max-width: 720px) { .pager { display: none; } }
  @media (max-width: 900px) {
    /* the same boxed cards as the top tracks shelf below it */
    .releases { grid-auto-columns: min(19rem, 84%); gap: 0.65rem; margin-inline: 0; }
    article { --pad: 0.5rem; --ring: var(--surface); border: 1px solid var(--line); background: var(--surface); }
  }
  @media (max-width: 720px) {
    .each { width: 2.25rem; height: 2.25rem; justify-content: center; border-radius: 50%; background: var(--raised); color: var(--text); }
    .each span { display: none; }
  }
</style>
