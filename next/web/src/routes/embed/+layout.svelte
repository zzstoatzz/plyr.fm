<script lang="ts">
  import { onMount } from 'svelte';
  import { mountEmbedEvents } from '$lib/embed/events';
  import { player } from '$lib/player.svelte';
  import '../../app.css';

  let { children } = $props();
  onMount(() => {
    const stopPlayer = player.mount(true);
    const stopEvents = mountEmbedEvents(() => player.embedSnapshot());
    return () => { stopEvents(); stopPlayer(); };
  });
</script>

<main id="main" class="embed">{@render children()}</main>

<style>
  .embed { min-height: 100dvh; }
  :global(html:has(.embed)) { background: transparent; }
</style>
