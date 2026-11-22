<script lang="ts">
  import type { TrackComment } from '@plyr/next-core/api';
  import { commentAuthor, commentTimeline, emojiOnly } from '@plyr/next-core/timed-comments';
  import { clock } from '$lib/tracks';
  import Artwork from '$lib/ui/Artwork.svelte';
  import Icon from '$lib/ui/Icon.svelte';

  /** The cover turned into the track's comments, kept in step with playback the way synced lyrics are. */
  let { items, cover, position, seek, close, compose }: {
    items: TrackComment[]; cover?: string; position: number;
    seek?: (seconds: number) => void; close: () => void; compose?: { label: string; run: () => void };
  } = $props();
  const timeline = $derived(commentTimeline(items, item => item.timestamp_ms, position * 1000));
  let list: HTMLOListElement;
  let touchedAt = 0;
  // Follow playback unless the listener scrolled the list themselves in the last few seconds.
  $effect(() => {
    const row = list?.children[timeline.focus] as HTMLElement | undefined;
    if (!row || Date.now() - touchedAt < 4000) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollTo({ top: row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2, behavior: still ? 'auto' : 'smooth' });
  });
</script>

<section class="comments-view" data-testid="comments-view" data-player-no-pull aria-label="Comments">
  {#if cover}<img class="wash" src={cover} alt="" aria-hidden="true" />{/if}
  <header>
    <strong>comments{#if items.length}<span class="count">{items.length}</span>{/if}</strong>
    <button type="button" class="icon-button" aria-label="Show the cover" onclick={close}><Icon name="x" size={18} /></button>
  </header>
  <ol bind:this={list} onwheel={() => { touchedAt = Date.now(); }} ontouchmove={() => { touchedAt = Date.now(); }}>
    {#each timeline.rows as { item, moment } (item.record.uri)}
      <li class={moment}>
        <button type="button" disabled={!seek} aria-label={`Play from ${clock(item.timestamp_ms / 1000)}, comment by ${commentAuthor(item)}: ${item.text}`}
          aria-current={moment === 'now' ? 'true' : undefined} onclick={() => seek?.(item.timestamp_ms / 1000)}>
          <span class="face"><Artwork src={item.author.avatar_url ?? undefined} size={40} fallbackIcon="user" /></span>
          <span class="body">
            <span class="meta"><strong>{commentAuthor(item)}</strong><span class="time">{clock(item.timestamp_ms / 1000)}</span>{#if moment === 'ahead'}<span class="soon">in {clock((item.timestamp_ms / 1000) - position)}</span>{/if}</span>
            <span class="say" class:emoji={emojiOnly(item.text)}>{item.text}</span>
          </span>
        </button>
      </li>
    {:else}
      <li class="empty">no comments yet.</li>
    {/each}
    {#if compose}<li class="yours"><button type="button" onclick={compose.run}>{compose.label}</button></li>{/if}
  </ol>
</section>

<style>
  .comments-view { position: absolute; inset: 0; z-index: 1; display: grid; grid-template-rows: auto minmax(0, 1fr); border-radius: inherit; overflow: hidden; background: var(--surface); isolation: isolate; }
  .wash { position: absolute; inset: -25%; width: 150%; height: 150%; object-fit: cover; filter: blur(46px) saturate(1.3); z-index: -2; }
  .comments-view::before { content: ''; position: absolute; inset: 0; z-index: -1; background: color-mix(in srgb, var(--bg) 62%, transparent); }
  header { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.5rem 0 1.1rem; font-size: var(--t-15); }
  .count { margin-left: 0.35rem; color: var(--muted); font-weight: 400; }
  ol { list-style: none; margin: 0; padding: 35% 1.1rem; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; mask-image: linear-gradient(transparent, #000 1.5rem, #000 calc(100% - 3rem), transparent); }
  ol::-webkit-scrollbar { display: none; }
  li { padding-block: 0.55rem; transition: opacity 0.3s; }
  li.heard { opacity: 0.5; }
  li.ahead { opacity: 0.45; }
  li > button { display: flex; gap: 0.75rem; align-items: flex-start; width: 100%; padding: 0; border: 0; background: none; color: var(--text); text-align: start; cursor: pointer; }
  li > button:disabled { cursor: default; }
  li > button:hover:not(:disabled) .say { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 0.2em; }
  .face { flex: none; width: 2rem; height: 2rem; margin-top: 0.1rem; border-radius: 50%; overflow: hidden; transition: width 0.3s, height 0.3s; }
  .now .face { width: 2.5rem; height: 2.5rem; }
  .body { display: grid; gap: 0.2rem; min-width: 0; }
  .meta { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; font-size: var(--t-12-8); color: var(--muted); font-variant-numeric: tabular-nums; }
  .meta strong { color: var(--text); font-weight: 650; }
  .now .time { color: var(--accent); font-weight: 700; }
  .soon { color: var(--faint); }
  .say { font-size: 1.2rem; line-height: 1.25; font-weight: 700; overflow-wrap: anywhere; white-space: pre-wrap; transition: font-size 0.3s; }
  .now .say { font-size: 1.6rem; }
  .say.emoji { font-size: 2.2rem; line-height: 1.05; font-weight: 400; }
  .now .say.emoji { font-size: 2.75rem; }
  .empty { color: var(--muted); font-size: var(--t-16-8); padding-top: 1.5rem; }
  .yours button { min-height: 2.75rem; padding: 0; border: 0; background: none; color: var(--accent); font-size: var(--t-16-8); font-weight: 700; cursor: pointer; }
  @media (prefers-reduced-motion: reduce) { li, .face, .say { transition: none; } }
</style>
