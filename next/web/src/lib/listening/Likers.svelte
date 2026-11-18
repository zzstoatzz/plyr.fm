<script lang="ts">
  import { onMount, onDestroy, untrack, tick } from 'svelte';
  import { resolve } from '$app/paths';
  import type { Track } from '@plyr/next-core/api';
  import { api } from '$lib/api';
  import Icon from '$lib/ui/Icon.svelte';
  import Artwork from '$lib/ui/Artwork.svelte';
  import { likes } from './likes';
  import { compactCount } from './format';
  import { placePopover } from './popover';

  let { track }: { track: Track } = $props();
  let snapshot = $state.raw(untrack(() => likes.snapshot(track)));
  let panel: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let people = $state.raw<Awaited<ReturnType<typeof api.trackLikes>>['data']>([]);
  let cursor = $state<string>();
  let loading = $state(false);
  let error = $state(false);
  let open = $state(false);
  let pinned = false;
  let loaded = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let live = true;
  let generation = 0;
  $effect(() => {
    track.id;
    generation++;
    untrack(() => {
      snapshot = likes.snapshot(track);
      people = []; cursor = undefined; loading = error = loaded = pinned = false;
      if (panel?.matches(':popover-open')) panel.hidePopover();
    });
  });
  const id = $props.id();
  onMount(() => {
    const stop = likes.subscribe(() => { snapshot = likes.snapshot(track); });
    const position = () => { if (open) placePopover(panel, trigger); };
    document.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    return () => { stop(); document.removeEventListener('scroll', position, true); window.removeEventListener('resize', position); };
  });
  onDestroy(() => { live = false; clearTimeout(timer); });
  async function load(more = false) {
    if (loading) return;
    const request = generation;
    const id = track.id;
    loading = true;
    error = false;
    try {
      const page = await api.trackLikes(id, more ? cursor : undefined);
      if (!live || request !== generation) return;
      const merged = more ? [...people, ...page.data] : page.data;
      people = [...new Map(merged.map(person => [person.actor.did, person])).values()];
      cursor = page.has_more && page.next_cursor && page.next_cursor !== cursor ? page.next_cursor : undefined;
      loaded = true;
    } catch { if (live && request === generation) error = true; }
    finally { if (live && request === generation) { loading = false; await tick(); if (open && live && request === generation) placePopover(panel, trigger); } }
  }
  function show(pin = false) {
    clearTimeout(timer);
    if (pin && open && pinned) { panel.hidePopover(); return; }
    pinned ||= pin;
    if (!open) panel.showPopover();
    placePopover(panel, trigger);
    if (!loaded) void load();
  }
  function leave() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!pinned && !panel.matches(':hover, :focus-within') && !trigger.matches(':focus-visible')) panel.hidePopover();
    }, 150);
  }
</script>

<button bind:this={trigger} class="likers" type="button" aria-label={`${snapshot.count} ${snapshot.count === 1 ? 'like' : 'likes'} on ${track.metadata.title}`} aria-expanded={open} aria-controls={id}
  onpointerenter={event => { if (event.pointerType === 'mouse') show(); }} onpointerleave={leave} onfocus={() => show()} onblur={leave} onclick={() => show(true)}><Icon name="heart" size={11} /><span>{compactCount(snapshot.count)}</span></button>
<div bind:this={panel} {id} popover="auto" data-player-no-pull role="group" aria-label="People who liked this track" class="people" ontoggle={() => { open = panel.matches(':popover-open'); if (!open) pinned = false; }} onpointerenter={() => clearTimeout(timer)} onpointerleave={leave} onfocusout={leave}>
  <header><strong>liked by</strong><button class="icon-button" type="button" aria-label="Close likes" onclick={() => panel.hidePopover()}><Icon name="x" size={16} /></button></header>
  {#each people as person (person.actor.did)}
    <a href={resolve('/(app)/u/[actor]', { actor: person.actor.profile?.handle || person.actor.did })}><span class="avatar"><Artwork src={person.actor.profile?.avatar_url ?? undefined} size={32} fallbackIcon="user" /></span><span>{person.actor.profile?.display_name || person.actor.profile?.handle || 'listener'}</span></a>
  {/each}
  {#if loading}<p role="status">loading likes…</p>{:else if error}<p>could not load likes. <button class="text-button" type="button" onclick={() => load()}>try again</button></p>{:else if !people.length}<p>no likes yet.</p>{/if}
  {#if cursor && !loading}<button class="text-button" type="button" onclick={() => load(true)}>more people</button>{/if}
</div>

<style>
  .likers { display: inline-flex; align-items: center; gap: 0.3rem; background: none; border: 0; color: inherit; padding: 0; min-height: 1.4rem; font: inherit; font-variant-numeric: tabular-nums; }
  .likers:hover, .likers[aria-expanded=true] { color: var(--text); }
  .people { position: fixed; inset: auto; margin: 0; width: min(17rem, calc(100vw - 1rem)); max-height: min(25rem, calc(100dvh - 1rem)); overflow-y: auto; background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 0.8rem; padding: 0.6rem; box-shadow: 0 0.4rem 1.4rem rgb(0 0 0 / 0.13); }
  header, a { display: flex; align-items: center; justify-content: space-between; }
  header { padding-left: 0.4rem; font-size: 0.875rem; }
  a { justify-content: start; gap: 0.6rem; min-height: 2.75rem; border-radius: 0.5rem; padding: 0.35rem; }
  a:hover { background: var(--raised); text-decoration: none; }
  .avatar { width: 2rem; border-radius: 50%; flex: none; }
  p { padding: 0.4rem; color: var(--muted); font-size: 0.875rem; }
  @media (pointer: coarse) { .likers { min-height: 2.75rem; padding-inline: 0.25rem; } }
</style>
