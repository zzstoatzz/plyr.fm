<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import type { Track } from '@plyr/next-core/api';
  import { auth } from '$lib/auth';
  import { trackHref } from '$lib/tracks';
  import Icon from '$lib/ui/Icon.svelte';
  import { placePopover } from './popover';
  let { track }: { track: Track } = $props();
  let panel: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let picking = $state(false);
  let open = $state(false);
  let picker: HTMLDialogElement;
  let copied = $state(false);
  let error = $state(false);
  let account = $state.raw(auth.getAuth());
  const id = $props.id();
  onMount(() => auth.subscribe(() => { const next = auth.getAuth(); if (next.rpc !== account.rpc) { picker?.close(); picking = false; } account = next; }));
  async function share() {
    const current = track;
    try {
      const url = new URL(trackHref(current), location.origin).href;
      if (navigator.share) await navigator.share({ title: current.metadata.title, url });
      else { await navigator.clipboard.writeText(url); if (track === current) copied = true; }
    } catch (failure) { if (!(failure instanceof DOMException && failure.name === 'AbortError')) error = true; }
  }
</script>

<button bind:this={trigger} class="icon-button" aria-label={`More actions for ${track.metadata.title}`} aria-controls={id} aria-expanded={open} onclick={() => { if (open) panel.hidePopover(); else { copied = error = false; panel.showPopover(); placePopover(panel, trigger); } }}><Icon name="more" size={20} /></button>
<div bind:this={panel} {id} popover="auto" data-player-no-pull role="group" aria-label={`Actions for ${track.metadata.title}`} ontoggle={() => { open = panel.matches(':popover-open'); }} class="menu">
  <button class="text-button" type="button" onclick={share}><Icon name="share" size={18} />{copied ? 'link copied' : 'share track'}</button>
  {#if account.rpc}
    <button class="text-button" type="button" onclick={() => { picking = true; panel.hidePopover(); picker.showModal(); }}><Icon name="plus" size={18} />add to playlist</button>
  {:else}<a class="text-button" href={resolve('/(app)/login') + '?' + new URLSearchParams({ return_to: trackHref(track) })}><Icon name="plus" size={18} />sign in to save</a>{/if}
  <a class="text-button" href={trackHref(track)}><Icon name="info" size={18} />about this track</a>
  {#if error}<p role="alert">could not share this track. try again.</p>{/if}
</div>
<dialog bind:this={picker} class="picker" onclose={() => { picking = false; trigger.focus(); }}>
  <header><strong>add to playlist</strong><form method="dialog"><button class="icon-button" type="submit" aria-label="Close playlists"><Icon name="x" size={18} /></button></form></header>
{#if picking && account.rpc && account.did}
  {#key account.rpc}{#await import('$lib/collections/PlaylistPicker.svelte') then { default: Picker }}<Picker {account} {track} />{/await}{/key}
{/if}
</dialog>

<style>
  .picker { width: min(32rem, calc(100% - 2rem)); max-height: calc(100dvh - 2rem); overflow-y: auto; background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 0.8rem; padding: 0.75rem; }
  .picker::backdrop { background: rgb(0 0 0 / 0.5); }
  header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 0.5rem; }
  .menu { position: fixed; inset: auto; margin: 0; width: min(15rem, calc(100vw - 1rem)); background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 0.8rem; padding: 0.4rem; box-shadow: 0 0.4rem 1.4rem rgb(0 0 0 / 0.13); }
  .menu :is(button, a) { width: 100%; justify-content: start; gap: 0.6rem; font-size: 0.875rem; }
  p { padding: 0.4rem; font-size: 0.875rem; color: var(--muted); }
</style>
