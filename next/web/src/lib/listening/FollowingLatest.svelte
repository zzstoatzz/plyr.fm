<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import type { Track } from '@plyr/next-core/api';
  import { trackArtwork } from '@plyr/next-core/artwork';
  import { showsPause, tracksContext } from '@plyr/next-core/play-context';
  import { shuffled } from '@plyr/next-core/queue-state';
  import { auth } from '$lib/auth';
  import { player } from '$lib/player.svelte';
  import { contextState, pressContext } from '$lib/play-control.svelte';
  import { artistName, clock, trackHref } from '$lib/tracks';
  import Icon from '$lib/ui/Icon.svelte';
  import Artwork from '$lib/ui/Artwork.svelte';
  import Loading from '$lib/ui/Loading.svelte';
  import PlayingWave from '$lib/ui/PlayingWave.svelte';
  import { postedAt } from './format';
  import { newFromFollows } from './following';
  import { savedShelf } from './saved-shelf';
  let account = $state.raw(auth.getAuth());
  let tracks = $state.raw<Track[]>([]);
  /** Whose shelf is showing: the signed-in account, or before sign-in restores, the account this browser last showed. */
  let owner = $state<string | null>(null);
  let pending = $state(false);
  let failed = $state(false);
  let attempt = $state(0);
  let strip: HTMLDivElement | undefined = $state();
  let edges = $state({ start: true, end: true });
  onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
  $effect(() => {
    const { did, ready } = account;
    const refresh = attempt;
    const saved = savedShelf();
    const who = did ?? (ready ? null : saved?.did ?? null);
    failed = false;
    if (!who) {
      owner = null;
      tracks = [];
      pending = false;
      return;
    }
    if (untrack(() => owner) !== who) {
      owner = who;
      tracks = saved?.did === who ? saved.tracks : [];
    }
    pending = !untrack(() => tracks.length);
    let live = true;
    void newFromFollows(who, refresh > 0).then(result => {
      if (live) { tracks = result.tracks; failed = result.failed > 0; }
    }, () => { if (live) failed = true; }).finally(() => { if (live) pending = false; });
    return () => { live = false; };
  });
  /** Fetch again in place, keeping what's shown until the new list arrives. */
  export async function reload() {
    const { did } = account;
    if (!did) return;
    try {
      const result = await newFromFollows(did, true);
      if (auth.getAuth().did === did) { tracks = result.tracks; failed = result.failed > 0; }
    } catch {}
  }
  const label = 'new from people you know';
  const current = (track: Track) => contextState(tracksContext([track])) !== 'idle';
  const playing = (track: Track) => showsPause(contextState(tracksContext([track])));
  function play(track: Track) {
    pressContext(tracksContext([track]), () => player.play(track, tracks, label));
  }
  function shuffle() {
    const order = shuffled(tracks, track => current(track));
    player.play(order[0], order, label);
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

{#if owner && (pending || failed || tracks.length)}
  <section class="following" aria-label="New from people you know" data-testid="following-latest">
    <header>
      <h2>{label}</h2>
      {#if tracks.length > 1}<button class="text-button each" type="button" aria-label="play one from each" title="play one from each" onclick={shuffle}><Icon name="shuffle" size={15} /><span>play one from each</span></button>{/if}
      {#if !(edges.start && edges.end)}<span class="pager"><button class="icon-button" type="button" aria-label="Scroll back" disabled={edges.start} onclick={() => page(-1)}><Icon name="back" size={18} /></button><button class="icon-button" type="button" aria-label="Scroll forward" disabled={edges.end} onclick={() => page(1)}><Icon name="chevron" size={18} /></button></span>{/if}
    </header>
    {#if pending}<Loading label="finding new uploads from people you know" inline />{/if}
    {#if tracks.length}
      <div class="releases" bind:this={strip} onscroll={measure}>
        {#each tracks as track (track.id)}
          {@const artist = resolve('/(app)/u/[actor]', { actor: track.artist.profile.handle || track.artist.did })}
          <article class:current={current(track)} data-track-id={track.id}>
            <button class="playback" type="button" aria-label={`${playing(track) ? 'Pause' : 'Play'} ${track.metadata.title} by ${artistName(track)}`} onclick={() => play(track)}>
              <span class="cover"><Artwork src={trackArtwork(track)} size={40} /><span class="play" class:on={playing(track)}>{#if playing(track)}<PlayingWave />{:else}<Icon name="play" size={18} />{/if}</span></span>
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
    {#if failed}<p class="state">{tracks.length ? 'some new uploads could not load.' : 'could not load new uploads from people you know.'} <button class="text-button" type="button" onclick={() => { attempt++; }}>try again</button></p>{/if}
  </section>
{/if}

<style>
  .following { grid-area: following; min-width: 0; }
  header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.65rem; min-height: 2.75rem; }
  h2 { font-size: var(--t-16-8); margin-right: auto; }
  .each { display: inline-flex; align-items: center; gap: 0.4rem; color: var(--muted); font-size: var(--t-12-8); padding-inline: 0; }
  .each:hover { color: var(--text); }
  .pager { display: flex; color: var(--muted); }
  .pager button:disabled { opacity: 0.35; }
  .releases { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(16rem, calc((100% - 2 * 0.75rem) / 3.15)); gap: 0.75rem; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory; scrollbar-width: none; margin-inline: -0.375rem; }
  .releases::-webkit-scrollbar { display: none; }
  article { --pad: 0.375rem; position: relative; min-width: 0; min-height: 3.6rem; display: flex; align-items: center; gap: 0.7rem; padding: var(--pad); border-radius: 0.6rem; scroll-snap-align: start; }
  article:has(:focus-visible) { background: var(--hover); }
  @media (hover: hover) { article:hover { background: var(--hover); } }
  .playback { position: static; flex: none; border: 0; padding: 0; background: transparent; border-radius: 0.375rem; }
  .playback::after { content: ''; position: absolute; inset: 0; z-index: 1; border-radius: 0.6rem; }
  .cover { position: relative; display: block; width: 2.5rem; border-radius: 0.42rem; overflow: hidden; }
  .play { position: absolute; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / 0.5); color: white; opacity: 0; }
  .play.on, .playback:focus-visible .play { opacity: 1; }
  @media (hover: hover) { article:hover .play { opacity: 1; } }
  .copy { flex: 1; min-width: 0; display: grid; }
  .copy a { position: relative; z-index: 2; max-width: 100%; }
  .title { font-weight: 650; justify-self: start; }
  .current .title { color: var(--accent); }
  .meta { font-size: var(--t-14); color: var(--faint); }
  .who { color: var(--muted); }
  .duration { color: var(--faint); font-size: var(--t-12-8); font-variant-numeric: tabular-nums; }
  @media (hover: none), (max-width: 720px) { .pager { display: none; } }
  @media (max-width: 900px) {
    /* exactly the top tracks shelf below it: same card width, height, padding, cover and type */
    .releases { grid-auto-columns: min(14rem, 78vw); gap: 0.65rem; min-height: 4.75rem; margin-inline: 0; }
    article { --pad: 0; gap: 0.75rem; padding: 0 0.7rem; border: 1px solid var(--line); background: var(--surface); }
    .duration { display: none; }
  }
  @media (max-width: 720px) {
    .each { width: 2.25rem; height: 2.25rem; justify-content: center; border-radius: 50%; background: var(--raised); color: var(--text); }
    .each span { display: none; }
  }
</style>
