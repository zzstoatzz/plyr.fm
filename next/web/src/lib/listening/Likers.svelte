<script lang="ts">
  import { onMount, onDestroy, untrack, tick } from 'svelte';
  import { resolve } from '$app/paths';
  import type { Track } from '@plyr/next-core/api';
  import Icon from '$lib/ui/Icon.svelte';
  import Artwork from '$lib/ui/Artwork.svelte';
  import { likes } from './likes';
  import { compactCount } from './format';
  import { placePopover } from './popover';

  let { track, icon = true }: { track: Track; icon?: boolean } = $props();
  let snapshot = $state.raw(untrack(() => likes.snapshot(track)));
  let list = $state.raw(untrack(() => likes.likers(track)));
  let panel: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let open = $state(false);
  let pinned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    track.id;
    untrack(() => {
      snapshot = likes.snapshot(track);
      list = likes.likers(track);
      pinned = false;
      if (panel?.matches(':popover-open')) panel.hidePopover();
    });
  });
  const id = $props.id();
  onMount(() => {
    const stop = likes.subscribe(async () => {
      snapshot = likes.snapshot(track);
      list = likes.likers(track);
      await tick();
      if (open) placePopover(panel, trigger);
    });
    const position = () => { if (open) placePopover(panel, trigger); };
    document.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    return () => { stop(); document.removeEventListener('scroll', position, true); window.removeEventListener('resize', position); };
  });
  onDestroy(() => clearTimeout(timer));
  function show(pin = false) {
    clearTimeout(timer);
    if (pin && open && pinned) { panel.hidePopover(); return; }
    pinned ||= pin;
    if (!open) panel.showPopover();
    placePopover(panel, trigger);
    void likes.loadLikers(track);
  }
  /** Pointing opens it only over the count itself, after a beat, so passing by or resting beside it does nothing. */
  let pointing = false;
  function point(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || open) return;
    const over = event.target instanceof Element && !!event.target.closest('.glyph');
    if (over === pointing) return;
    pointing = over;
    clearTimeout(timer);
    if (over) timer = setTimeout(() => show(), 200);
  }
  function leave() {
    pointing = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!pinned && open && !panel.matches(':hover, :focus-within') && !trigger.matches(':focus-visible')) panel.hidePopover();
    }, 150);
  }
</script>

<button bind:this={trigger} class="likers" type="button" aria-label={`${snapshot.count} ${snapshot.count === 1 ? 'like' : 'likes'} on ${track.metadata.title}`} aria-expanded={open} aria-controls={id}
  onpointermove={point} onpointerleave={leave} onfocus={event => { if (event.currentTarget.matches(':focus-visible')) show(); }} onblur={leave} onclick={() => show(true)}><span class="glyph">{#if icon}<Icon name="heart" size={11} />{/if}<span>{compactCount(snapshot.count)}</span></span></button>
<div bind:this={panel} {id} popover="auto" data-player-no-pull role="group" aria-label="People who liked this track" class="people" ontoggle={(event: ToggleEvent) => { open = event.newState === 'open'; if (!open) pinned = false; }} onpointerenter={() => clearTimeout(timer)} onpointerleave={leave} onfocusout={leave}>
  <header><strong>liked by</strong><button class="icon-button" type="button" aria-label="Close likes" onclick={() => panel.hidePopover()}><Icon name="x" size={16} /></button></header>
  {#each list.people as person (person.did)}
    <a href={resolve('/(app)/u/[actor]', { actor: person.profile?.handle || person.did })}><span class="avatar"><Artwork src={person.profile?.avatar_url ?? undefined} size={32} fallbackIcon="user" /></span><span>{person.profile?.display_name || person.profile?.handle || 'listener'}</span></a>
  {/each}
  {#if !list.people.length}
    {#if list.error}<p>could not load likes. <button class="text-button" type="button" onclick={() => likes.loadLikers(track)}>try again</button></p>{:else if list.loaded}<p>no likes yet.</p>{:else}<p role="status">loading likes…</p>{/if}
  {/if}
  {#if list.more && !list.loading}<button class="text-button" type="button" onclick={() => likes.loadLikers(track, { more: true })}>more people</button>{/if}
</div>

<style>
  .likers { display: inline-flex; align-items: center; background: none; border: 0; color: inherit; padding: 0; min-height: 1.4rem; font: inherit; font-variant-numeric: tabular-nums; }
  .glyph { display: inline-flex; align-items: center; gap: 0.3rem; }
  .likers:hover, .likers[aria-expanded=true] { color: var(--text); }
  .people { position: fixed; inset: auto; margin: 0; width: min(17rem, calc(100vw - 1rem)); max-height: min(25rem, calc(100dvh - 1rem)); overflow-y: auto; background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 0.8rem; padding: 0.6rem; box-shadow: 0 0.4rem 1.4rem rgb(0 0 0 / 0.13); }
  header, a { display: flex; align-items: center; justify-content: space-between; }
  header { padding-left: 0.4rem; font-size: var(--t-14); }
  a { justify-content: start; gap: 0.6rem; min-height: 2.75rem; border-radius: 0.5rem; padding: 0.35rem; }
  a:hover { background: var(--raised); text-decoration: none; }
  .avatar { width: 2rem; border-radius: 50%; flex: none; }
  p { padding: 0.4rem; color: var(--muted); font-size: var(--t-14); }
  @media (pointer: coarse) { .likers { min-height: 2.75rem; padding-inline: 0.25rem; } }
</style>
