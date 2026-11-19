<script lang="ts">
  import { resolve } from '$app/paths';
  import { downloadAllowed } from '@plyr/next-core/downloads/model';
  import { invalidateAll } from '$app/navigation';
  import { isPrivateTrack } from '@plyr/next-core/track-access';
  import { onDestroy, onMount, tick } from 'svelte';
  import type { Track } from '@plyr/next-core/api';
  import { auth } from '$lib/auth';
  import { player } from '$lib/player.svelte';
  import { artistName, trackHref } from '$lib/tracks';
  import Icon from '$lib/ui/Icon.svelte';
  import { placePopover, placePopoverAt } from './popover';
  import PlaylistSheet from '$lib/collections/PlaylistSheet.svelte';
  import TrackDownload from '$lib/downloads/TrackDownload.svelte';
  import ReportSheet from '$lib/moderation/ReportSheet.svelte';
  let { track }: { track: Track } = $props();
  let panel: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let open = $state(false);
  // Mounted on first use so a long list of rows does not carry a sheet each.
  let picking = $state(false);
  let picker = $state<PlaylistSheet>();
  let downloading = $state(false);
  let downloader = $state<TrackDownload>();
  let reporting = $state(false);
  let reporter = $state<ReportSheet>();
  let accessDialog: HTMLDialogElement;
  let access = $state(false);
  let accessChanged = false;
  let copied = $state(false);
  let error = $state(false);
  let account = $state.raw(auth.getAuth());
  const id = $props.id();
  onMount(() => auth.subscribe(() => { const next = auth.getAuth(); if (next.rpc !== account.rpc) { picking = false; accessDialog?.close(); } account = next; }));
  const owner = $derived(!!account.did && account.did === track.artist.did && !isPrivateTrack(track));
  const queueable = $derived(player.canEditPublicQueue && !player.liveStation);
  function show(place: () => void) {
    copied = error = false;
    if (!panel.matches(':popover-open')) panel.showPopover();
    place();
    panel.querySelector<HTMLElement>('button:not(:disabled), a')?.focus();
  }
  // Opened mid-gesture, so light dismiss would close it on the same pointerup; dismiss by hand instead.
  let release: AbortController | undefined;
  function letGo() {
    release?.abort();
    release = undefined;
    panel.popover = 'auto';
  }
  onDestroy(() => release?.abort());
  /** Opens the menu at a point, for right-click and long press on the row. */
  export function openAt(x: number, y: number) {
    letGo();
    if (panel.matches(':popover-open')) panel.hidePopover();
    panel.popover = 'manual';
    show(() => placePopoverAt(panel, x, y));
    const controller = release = new AbortController();
    const outside = (event: PointerEvent) => { if (!panel.contains(event.target as Node)) panel.hidePopover(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && panel.matches(':popover-open')) { event.preventDefault(); panel.hidePopover(); } };
    document.addEventListener('keydown', escape, { capture: true, signal: controller.signal });
    setTimeout(() => { if (!controller.signal.aborted) document.addEventListener('pointerdown', outside, { capture: true, signal: controller.signal }); });
  }
  function pick(action: () => void) {
    action();
    panel.hidePopover();
  }
  function step(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), a')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    event.preventDefault();
    items[to]?.focus();
  }
  async function share() {
    const current = track;
    try {
      const url = new URL(trackHref(current), location.origin).href;
      if (navigator.share) await navigator.share({ title: current.metadata.title, url });
      else { await navigator.clipboard.writeText(url); if (track === current) copied = true; }
    } catch (failure) { if (!(failure instanceof DOMException && failure.name === 'AbortError')) error = true; }
  }
</script>

<button bind:this={trigger} class="icon-button" aria-label={`More actions for ${track.metadata.title}`} aria-controls={id} aria-expanded={open} onclick={() => { if (open) panel.hidePopover(); else { letGo(); show(() => placePopover(panel, trigger)); } }}><Icon name="more" size={20} /></button>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div bind:this={panel} {id} popover="auto" data-player-no-pull role="group" aria-label={`Actions for ${track.metadata.title}`} ontoggle={() => { open = panel.matches(':popover-open'); if (!open) letGo(); }} onkeydown={step} onclick={event => { if ((event.target as Element).closest('a')) panel.hidePopover(); }} class="menu">
  <button class="text-button" type="button" disabled={!queueable} onclick={() => pick(() => player.playNext(track))}><Icon name="next" size={18} />play next</button>
  <button class="text-button" type="button" disabled={!queueable} onclick={() => pick(() => player.enqueue(track))}><Icon name="queue" size={18} />add to queue</button>
  <hr>
  {#if account.rpc}
    <button class="text-button" type="button" onclick={async () => { picking = true; panel.hidePopover(); await tick(); picker?.show(); }}><Icon name="playlist_add" size={18} />add to playlist</button>
  {:else}<a class="text-button" href={resolve('/(app)/login') + '?' + new URLSearchParams({ return_to: trackHref(track) })}><Icon name="plus" size={18} />sign in to save</a>{/if}
  {#if downloadAllowed(track)}
    <button class="text-button" type="button" onclick={async () => { downloading = true; panel.hidePopover(); await tick(); await downloader?.start(); if (!document.querySelector('dialog[open]')) trigger.focus(); }}><Icon name="download" size={18} />download</button>
  {/if}
  <button class="text-button" type="button" onclick={share}><Icon name="share" size={18} />{copied ? 'link copied' : 'share track'}</button>
  {#if owner}
    <hr>
    <a class="text-button" href={resolve('/(app)/edit-track/[id]', { id: track.id })}><Icon name="edit" size={18} />edit track</a>
    <button class="text-button" type="button" onclick={() => { access = true; accessChanged = false; panel.hidePopover(); accessDialog.showModal(); }}><Icon name="lock" size={18} />who can listen</button>
  {/if}
  <hr>
  <a class="text-button" href={resolve('/(app)/u/[actor]', { actor: track.artist.did })}><Icon name="user" size={18} />go to artist</a>
  <a class="text-button" href={trackHref(track)}><Icon name="info" size={18} />about this track</a>
  {#if account.agent && account.did !== track.artist.did}
    <hr>
    <button class="text-button" type="button" onclick={async () => { reporting = true; panel.hidePopover(); await tick(); reporter?.show(); }}><Icon name="ph_flag" size={18} />report this track</button>
  {/if}
  {#if error}<p role="alert">could not share this track. try again.</p>{/if}
</div>
{#if picking}<PlaylistSheet bind:this={picker} {track} onclose={() => { picking = false; trigger.focus(); }} />{/if}
{#if reporting}<ReportSheet bind:this={reporter} subject={track.record.uri} name={track.metadata.title} owner={artistName(track)} returnTo={trackHref(track)} onclose={() => { reporting = false; trigger.focus(); }} />{/if}
{#if downloading}<TrackDownload bind:this={downloader} {track} announce onclose={() => trigger.focus()} />{/if}
<dialog bind:this={accessDialog} class="picker" onclose={() => { access = false; trigger.focus(); if (accessChanged) void invalidateAll(); }}>
  <header><strong>who can listen</strong><form method="dialog"><button class="icon-button" type="submit" aria-label="Close who can listen"><Icon name="x" size={18} /></button></form></header>
{#if access}
  {#await import('$lib/access/AccessDialog.svelte') then { default: Access }}<Access subject={{ noun: 'track', tracks: [track], skey: track.record.rkey }} returnTo={trackHref(track)} onchange={() => { accessChanged = true; }} />{:catch}<p role="alert">could not open this. reload the page and try again.</p>{/await}
{/if}
</dialog>

<style>
  .picker { width: min(32rem, calc(100% - 2rem)); max-height: calc(100dvh - 2rem); overflow-y: auto; background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 0.8rem; padding: 0.75rem; }
  .picker::backdrop { background: rgb(0 0 0 / 0.5); }
  header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 0.5rem; }
  .menu { position: fixed; inset: auto; margin: 0; width: min(15rem, calc(100vw - 1rem)); background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 0.8rem; padding: 0.4rem; box-shadow: 0 0.4rem 1.4rem rgb(0 0 0 / 0.13); }
  .menu :is(button, a) { width: 100%; justify-content: start; gap: 0.6rem; font-size: 0.875rem; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 0.3rem 0.2rem; }
  p { padding: 0.4rem; font-size: 0.875rem; color: var(--muted); }
</style>
