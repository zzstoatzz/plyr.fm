<script lang="ts">
  import type { ListSummary } from '@plyr/next-core/api';
  import CollectionArtwork from './CollectionArtwork.svelte';

  let { lists }: { lists: ListSummary[] } = $props();
</script>

<ul class="collections">
  {#each lists as list (list.record.uri)}
    <li>
      <a href={`/${list.object}/${list.id}`}>
        <span class="art"><CollectionArtwork {list} size={168} /></span>
        <span class="text">
          <strong class="truncate">{list.metadata.name || `untitled ${list.object}`}</strong>
          <span class="subtle">{list.metrics.member_count} {list.metrics.member_count === 1 ? 'track' : 'tracks'}</span>
        </span>
      </a>
    </li>
  {/each}
</ul>

<style>
  .collections { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(10rem, 100%), 1fr)); gap: 0.8rem; list-style: none; margin: 0.8rem 0; padding: 0; }
  a { display: grid; grid-template-rows: auto 1fr; gap: 0.65rem; padding: 0.6rem; min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 0.7rem; }
  .art { width: 100%; border-radius: 0.4rem; }
  .text { display: grid; min-width: 0; }
  @media (max-width: 720px) {
    .collections { grid-template-columns: 1fr; gap: 0; }
    a { grid-template-columns: 3.25rem minmax(0, 1fr); grid-template-rows: auto; align-items: center; padding: 0.45rem 0; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: none; }
  }
</style>
