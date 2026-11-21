<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fade, fly } from 'svelte/transition';
  import type { TrackComment } from '@plyr/next-core/api';
  import { commentAuthor, emojiOnly, reachedComments } from '@plyr/next-core/timed-comments';
  import { clock } from '$lib/tracks';
  import Artwork from '$lib/ui/Artwork.svelte';

  /** Comments rise over the cover as playback reaches them, then fade. Any one of them opens the comments view. */
  let { items, position, open }: { items: TrackComment[]; position: number; open: () => void } = $props();
  const reached = $derived(reachedComments(items, item => item.timestamp_ms, position * 1000));
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
</script>

<div class="cover-comments" data-testid="cover-comments" aria-live="polite">
  {#each reached as item, index (item.record.uri)}
    <button type="button" class="chip" class:earlier={index < reached.length - 1} data-testid="cover-comment"
      aria-label={`${commentAuthor(item)} at ${clock(item.timestamp_ms / 1000)}: ${item.text}. Show all comments`}
      onclick={open} animate:flip={{ duration: still ? 0 : 220 }} in:fly={{ y: 10, duration: still ? 0 : 240 }} out:fade={{ duration: still ? 0 : 320 }}>
      <span class="face"><Artwork src={item.author.avatar_url ?? undefined} size={32} fallbackIcon="user" /></span>
      <span class="body">
        <span class="who"><strong>{commentAuthor(item)}</strong><span>{clock(item.timestamp_ms / 1000)}</span></span>
        <span class="say" class:emoji={emojiOnly(item.text)}>{item.text}</span>
      </span>
    </button>
  {/each}
</div>

<style>
  .cover-comments { position: absolute; inset: auto 0.75rem 0.75rem; display: flex; flex-direction: column; align-items: flex-start; gap: 0.4rem; pointer-events: none; }
  .chip { pointer-events: auto; display: flex; align-items: center; gap: 0.6rem; max-width: 100%; min-height: 2.75rem; padding: 0.45rem 0.9rem 0.45rem 0.45rem; border: 1px solid rgb(255 255 255 / 0.14); border-radius: 1.15rem; color: #fff; text-align: start;
    background: rgb(12 12 12 / 0.5); backdrop-filter: blur(18px) saturate(1.4); -webkit-backdrop-filter: blur(18px) saturate(1.4); box-shadow: 0 0.4rem 1.4rem rgb(0 0 0 / 0.25); transition: opacity 0.2s, transform 0.2s; transform-origin: left bottom; }
  .chip.earlier { opacity: 0.55; transform: scale(0.94); }
  .face { flex: none; width: 2rem; height: 2rem; border-radius: 50%; overflow: hidden; }
  .body { display: grid; min-width: 0; }
  .who { display: flex; gap: 0.45rem; align-items: baseline; font-size: 0.78rem; color: rgb(255 255 255 / 0.72); font-variant-numeric: tabular-nums; }
  .who strong { color: #fff; font-weight: 650; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .say { font-size: 0.95rem; line-height: 1.3; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
  .say.emoji { font-size: 1.6rem; line-height: 1.1; }
  .chip:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  @media (min-width: 800px) {
    .cover-comments { inset: auto 1.1rem 1.1rem; gap: 0.5rem; }
    .chip { gap: 0.75rem; padding: 0.55rem 1.2rem 0.55rem 0.55rem; border-radius: 1.4rem; }
    .face { width: 2.5rem; height: 2.5rem; }
    .who { font-size: 0.85rem; }
    .say { font-size: 1.15rem; }
    .say.emoji { font-size: 2rem; }
  }
</style>
