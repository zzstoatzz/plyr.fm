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
  import { postedAt } from './format';
  import { newFromFollows } from './following';
  let account = $state.raw(auth.getAuth());
  let tracks = $state.raw<Track[]>([]);
  let pending = $state(false);
  let failed = $state(false);
  let attempt = $state(0);
  let all = $state(false);
  const shown = $derived(all ? tracks : tracks.slice(0, 3));
  onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
  $effect(() => {
    const { did, ready, rpc } = account;
    const refresh = attempt;
    tracks = [];
    failed = false;
    all = false;
    if (!did || !ready) { pending = false; return; }
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && auth.getAuth().rpc === rpc;
    pending = true;
    void newFromFollows(did, controller.signal, refresh > 0).then(result => {
      if (current()) { tracks = result.tracks; failed = result.failed > 0; }
    }, () => { if (current()) failed = true; }).finally(() => { if (current()) pending = false; });
    return () => controller.abort();
  });
  function play(track: Track) {
    if (!player.liveStation && canToggleTrack(player.current, track, !!player.jam)) player.toggle();
    else player.play(track, tracks, 'new from people you follow');
  }
</script>

{#if account.did && (pending || failed || tracks.length)}
  <section class="following" aria-label="New from people you follow" data-testid="following-latest">
    <header><h2>new from people you follow</h2>{#if tracks.length > 1}<button class="text-button each" type="button" onclick={() => player.play(tracks[0], tracks, 'new from people you follow')}><Icon name="shuffle" size={15} />play one from each</button>{/if}</header>
    {#if pending}<Loading label="finding new music from people you follow" inline />{/if}
    {#if tracks.length}
      <div class="releases">
        {#each shown as track (track.id)}
          <article>
            <a class="art" href={resolve('/(app)/u/[actor]', { actor: track.artist.profile.handle || track.artist.did })} aria-label={`Artist: ${artistName(track)}`}><Artwork src={trackArtwork(track)} size={60} /><span class="face"><Artwork src={track.artist.profile.avatar_url ?? undefined} size={22} fallbackIcon="user" /></span></a>
            <div class="copy"><a class="who truncate" href={resolve('/(app)/u/[actor]', { actor: track.artist.profile.handle || track.artist.did })}>{artistName(track)}</a><a class="title truncate" href={trackHref(track)}>{track.metadata.title}</a><small>{postedAt(track.metadata.created_at)} · {clock(track.metadata.duration_seconds)}</small></div>
            <button class="icon-button" type="button" aria-label={`${!player.liveStation && !player.outputElsewhere && player.playing && player.current?.id === track.id ? 'Pause' : 'Play'} ${track.metadata.title} by ${artistName(track)}`} onclick={() => play(track)}><Icon name={!player.liveStation && !player.outputElsewhere && player.playing && player.current?.id === track.id ? 'pause' : 'play'} size={17} /></button>
          </article>
        {/each}
      </div>
      {#if tracks.length > 3}<button class="text-button more" type="button" aria-expanded={all} onclick={() => { all = !all; }}>{all ? 'show less' : `show all ${tracks.length}`}</button>{/if}
    {/if}
    {#if failed}<p class="state">{tracks.length ? 'some new music could not load.' : 'could not load new music from people you follow.'} <button class="text-button" type="button" onclick={() => { attempt++; }}>try again</button></p>{/if}
  </section>
{/if}

<style>
  .following { grid-area: following; min-width: 0; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.65rem; }
  h2 { font-size: 1.07rem; }
  .each { color: var(--muted); font-size: 0.8rem; padding-inline: 0; }
  .releases { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); gap: 0.75rem; }
  article { min-width: 0; display: flex; align-items: center; gap: 0.65rem; border: 1px solid var(--line); border-radius: 0.8rem; padding: 0.6rem; background: var(--surface); }
  .art { position: relative; width: 3.25rem; flex: none; border-radius: 0.45rem; }
  .face { position: absolute; bottom: -0.2rem; right: -0.2rem; width: 1.4rem; border: 2px solid var(--surface); border-radius: 50%; overflow: hidden; }
  .copy { min-width: 0; display: grid; }
  .who, small { font-size: 0.75rem; color: var(--muted); }
  .title { font-size: 0.875rem; font-weight: 650; }
  .more { padding-inline: 0; font-size: 0.8rem; color: var(--muted); }
  @media (max-width: 720px) { .releases { grid-template-columns: 1fr; } header { align-items: start; flex-wrap: wrap; gap: 0; } }
</style>
