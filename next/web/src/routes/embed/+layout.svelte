<script lang="ts">
  import { onMount } from 'svelte';
  import { player } from '$lib/player.svelte';
  import '../../app.css';

  let { children } = $props();
  onMount(() => player.mount(true));
</script>

<main id="main" class="embed">{@render children()}</main>

<style>
  .embed { min-height: 100dvh; }
  :global(html:has(.embed)) { background: transparent; }
</style>
