<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ListSummary, Track } from '@plyr/next-core/api';
  import { tracksContext } from '@plyr/next-core/play-context';
  import { api } from '$lib/api';
  import { player } from '$lib/player.svelte';
  import { toast } from '$lib/toast.svelte';
  import PlayButton from '$lib/ui/PlayButton.svelte';
  import CollectionArtwork from './CollectionArtwork.svelte';

  /** the library's playlists as a cover grid; each cover plays its playlist without opening it. */
  let { lists, first }: { lists: ListSummary[]; first?: Snippet } = $props();
  // members read on the first press, so the button can tell when its playlist is the one on air
  let members = $state<Record<string, Track[]>>({});

  const name = (list: ListSummary) => list.metadata.name || 'untitled playlist';
  async function start(list: ListSummary) {
    try {
      const detail = await api.playlist(list.id);
      const tracks = detail.members.flatMap(member => member.track ? [member.track] : []);
      members[list.id] = tracks;
      if (tracks[0]) player.play(tracks[0], tracks, name(list));
      else toast.add(`nothing in ${name(list)} can play right now.`, 'error');
    } catch {
      toast.add(`could not load ${name(list)}. try again.`, 'error');
    }
  }
</script>

<ul class="shelf">
  {#if first}<li class="first">{@render first()}</li>{/if}
  {#each lists as list (list.record.uri)}
    <li>
      <a href={`/playlist/${list.id}`}>
        <span class="art"><CollectionArtwork {list} size={240} /></span>
        <strong class="truncate">{name(list)}</strong>
        <span class="subtle">{list.metrics.member_count} {list.metrics.member_count === 1 ? 'track' : 'tracks'}</span>
      </a>
      {#if list.metrics.member_count}
        <PlayButton class="cover-play" name={name(list)} context={tracksContext(members[list.id] ?? [])} start={() => void start(list)} />
      {/if}
    </li>
  {/each}
</ul>

<style>
  .shelf { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr)); gap: 1.4rem 1.1rem; }
  li { position: relative; min-width: 0; }
  a { display: grid; gap: 0.3rem; min-width: 0; color: inherit; }
  .art { display: block; border-radius: 0.6rem; overflow: hidden; margin-bottom: 0.35rem; }
  .subtle { color: var(--faint); }
  /* sits on the cover's bottom-right corner: the cover is square, so its edge is the li's width down */
  li :global(.cover-play) { position: absolute; right: 0.6rem; top: calc(100cqw - 3.35rem); width: 2.75rem; height: 2.75rem; border: 0; border-radius: 999px; display: grid; place-items: center; background: var(--accent); color: var(--on-accent); box-shadow: 0 6px 16px rgb(0 0 0 / 0.35); transition: opacity 0.15s, transform 0.15s; }
  li { container-type: inline-size; }
  /* hidden until hovered or focused, except while its playlist is on air */
  li :global(.cover-play[data-play-state='idle']) { opacity: 0; transform: translateY(6px); }
  @media (hover: hover) { li:is(:hover, :focus-within) :global(.cover-play) { opacity: 1; transform: none; } }
  @media (hover: none) { li :global(.cover-play[data-play-state='idle']) { visibility: hidden; } }
  @media (max-width: 720px) {
    .shelf { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.1rem 0.8rem; }
    li :global(.cover-play) { width: 2.5rem; height: 2.5rem; top: calc(100cqw - 3rem); right: 0.5rem; }
  }
  @media (prefers-reduced-motion: reduce) { li :global(.cover-play) { transition: none; } }
</style>
