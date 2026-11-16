<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '$lib/ui/Icon.svelte';

  let { rows, move, remove, disabled = false, titleField }: {
    rows: { key: string | number; title: string }[];
    move: (from: number, to: number) => void;
    remove: (index: number) => void;
    disabled?: boolean;
    titleField?: Snippet<[number]>;
  } = $props();
</script>

<ol>
  {#each rows as row, index (row.key)}
    <li><div class="row">
      <span>{#if titleField}{@render titleField(index)}{:else}{row.title}{/if}</span>
      <div class="controls">
        <button type="button" class="icon-button up" aria-label={`Move ${row.title} up`} disabled={disabled || index === 0} onclick={() => move(index, index - 1)}><Icon name="down" size={18} /></button>
        <button type="button" class="icon-button" aria-label={`Move ${row.title} down`} disabled={disabled || index + 1 === rows.length} onclick={() => move(index, index + 1)}><Icon name="down" size={18} /></button>
        <button type="button" class="icon-button" aria-label={`Remove ${row.title}`} disabled={disabled} onclick={() => remove(index)}><Icon name="x" size={18} /></button>
      </div>
    </div></li>
  {/each}
</ol>

<style>
  ol { margin: 0; padding-inline-start: 1.5rem; }
  li { display: list-item; border-bottom: 1px solid var(--line); padding-block: 0.35rem; }
  .row { display: flex; gap: 0.4rem; align-items: center; justify-content: space-between; }
  .row > span { min-width: 0; overflow-wrap: anywhere; }
  .controls { display: flex; flex: none; }
  .up :global(svg) { transform: rotate(180deg); }
</style>
