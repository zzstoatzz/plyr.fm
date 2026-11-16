<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import type { Track, TrackComment } from '@plyr/next-core/api';
  import { pileFaces, passingComment } from '@plyr/next-core/comment-faces';
  import { clock } from '$lib/tracks';
  import { player } from '$lib/player.svelte';
  import Artwork from '$lib/ui/Artwork.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import { comments } from './comments';
  import { placePopover } from './popover';
  let { track, position, duration, seek }: { track: Track; position: number; duration: number; seek: (seconds: number) => void } = $props();
  let snapshot = $state.raw(comments.snapshot());
  let width = $state(0);
  let ratio = $state(26 / 18);
  let selected = $state.raw<TrackComment[]>([]);
  let panel: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let openCard = $state(false);
  const id = $props.id();
  const piles = $derived(pileFaces(snapshot.comments, item => item.timestamp_ms, duration * 1000, width / ratio, 8 / ratio));
  const passing = $derived(player.playing && !player.outputElsewhere ? passingComment(snapshot.comments, item => item.timestamp_ms, position * 1000) : undefined);
  onMount(() => {
    ratio = matchMedia('(pointer: coarse)').matches ? 44 / 18 : 26 / 18;
    const id = track.id;
    const stop = comments.subscribe(id, () => { snapshot = comments.snapshot(id); });
    snapshot = comments.snapshot(id);
    if (!comments.hasLoaded(id)) comments.loadComments(id);
    return stop;
  });
  function open(event: MouseEvent, items: TrackComment[]) {
    selected = items;
    trigger = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : trigger;
    panel.showPopover();
    requestAnimationFrame(() => placePopover(panel, trigger));
  }
</script>

{#if snapshot.comments.length}
<div class="markers" bind:clientWidth={width} aria-label="Timed comments">
  {#each piles as pile (pile.items[0].record.uri)}
    <button type="button" class="pile" style:left={`${pile.left * ratio}px`} style:width={`${pile.width * ratio}px`} aria-label={`${pile.items.length === 1 ? 'Comment' : pile.items.length + ' comments'} at ${clock(pile.items[0].timestamp_ms / 1000)}`} aria-controls={id} aria-expanded={openCard && selected === pile.items} onclick={event => open(event, pile.items)}>
      <span class="faces">{#each pile.items.slice(0, 3) as item (item.record.uri)}<span class="avatar"><Artwork src={item.author.avatar_url ?? undefined} size={20} fallbackIcon="user" /></span>{/each}{#if pile.items.length > 3}<span class="count">+{pile.items.length - 3}</span>{/if}</span>
      <span class="stem" style:left={`${pile.anchor * ratio - pile.left * ratio}px`}></span>
    </button>
  {/each}
  {#if passing}<span class="passing" data-testid="passing-comment">{passing.text}</span>{/if}
</div>
{/if}
{#if snapshot.error}<p class="error">could not load comments. <button type="button" class="text-button" onclick={() => comments.loadComments(track.id)}>try again</button></p>{/if}
<div bind:this={panel} {id} class="comment-card" popover="auto" data-player-no-pull role="group" aria-label="Timed comments" ontoggle={() => { openCard = panel.matches(':popover-open'); }}>
  <header><strong>comments</strong><button class="icon-button" type="button" aria-label="Close timed comments" onclick={() => panel.hidePopover()}><Icon name="x" size={16} /></button></header>
  {#each selected as item (item.record.uri)}
    <article><div class="by"><a href={resolve('/(app)/u/[actor]', { actor: item.author.did })}>{item.author.display_name || item.author.handle || 'listener'}</a><button class="text-button" type="button" disabled={!player.canSeek} aria-label={`Play from ${clock(item.timestamp_ms / 1000)}`} onclick={() => { seek(item.timestamp_ms / 1000); panel.hidePopover(); }}>{clock(item.timestamp_ms / 1000)}</button></div><p>{item.text}</p></article>
  {/each}
</div>

<style>
  .markers { position: relative; height: 2rem; }
  .pile { position: absolute; top: 0; height: 2rem; border: 0; background: none; padding: 0; display: flex; align-items: start; color: var(--muted); }
  .faces { display: flex; align-items: center; padding-top: 0.1rem; }
  .avatar { display: inline-block; width: 1.25rem; height: 1.25rem; border: 2px solid var(--bg); border-radius: 50%; overflow: hidden; }
  .avatar + .avatar { margin-left: -0.4rem; }
  .count { font-size: 0.65rem; padding-left: 0.15rem; }
  .stem { position: absolute; bottom: 0; height: 0.65rem; width: 1px; background: var(--muted); }
  .passing { position: absolute; left: 0; bottom: calc(100% + 0.25rem); max-width: 100%; padding: 0.4rem 0.65rem; border: 1px solid var(--line); border-radius: 0.6rem; background: var(--surface); color: var(--text); font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; pointer-events: none; }
  .comment-card { position: fixed; inset: auto; width: min(23rem, calc(100vw - 1rem)); margin: 0; padding: 0.7rem; max-height: min(26rem, calc(100dvh - 1rem)); overflow-y: auto; background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 0.8rem; box-shadow: 0 0.4rem 1.4rem rgb(0 0 0 / 0.13); }
  header, .by { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; font-size: 0.875rem; }
  .by a { min-width: 0; overflow-wrap: anywhere; }
  .by button { color: var(--accent); font-variant-numeric: tabular-nums; }
  article + article { border-top: 1px solid var(--line); margin-top: 0.5rem; }
  article p { padding-inline: 0.35rem; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.875rem; }
  .error { font-size: 0.8rem; color: var(--muted); }
</style>
