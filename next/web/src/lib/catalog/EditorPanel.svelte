<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '$lib/ui/Icon.svelte';

  let { title, close, children, busy = false }: { title: string; close: string; children: Snippet; busy?: boolean } = $props();
</script>

<div class="editor">
  <header>
    <h1>{title}</h1>
    {#if !busy}<a class="icon-button" href={close} aria-label="Close"><Icon name="x" /></a>{/if}
  </header>
  {@render children()}
</div>

<style>
  .editor { max-width: 36rem; padding: 1rem; border: 1px solid var(--line); border-radius: 0.85rem; background: var(--surface); margin: 0 auto; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
  h1 { font-size: clamp(1.4rem, 4.5vw, 1.95rem); }
  .editor :global(form) { display: grid; gap: 0.85rem; }
  .editor :global(form label) { min-width: 0; display: grid; gap: 0.4rem; }
  .editor :global(form input), .editor :global(form textarea) {
    width: 100%; min-width: 0; color: inherit;
    padding: 0.65rem; border-radius: 0.55rem; background: var(--bg); border: 1px solid var(--line);
  }
  .editor :global(.editor-actions) { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
  .editor :global(.editor-save) { background: var(--accent); color: var(--on-accent); padding-inline: 1rem; }
  .editor :global(.editor-save:hover) { background: var(--accent); filter: brightness(1.12); }
  .editor :global(.editor-error) { margin: 0.6rem 0; }
  .editor :global(.editor-danger) { color: var(--muted); }
</style>
