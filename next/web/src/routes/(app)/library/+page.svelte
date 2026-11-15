<script lang="ts">
  import Library from '$lib/collections/Library.svelte';
  import { resolve } from '$app/paths';
</script>

<div class="queue-link"><a class="text-button" href={resolve('/(app)/queue')}>open queue</a></div>
<Library />

<style>
  .queue-link { padding: 0 1rem; display: flex; justify-content: flex-end; }
  @media (min-width: 721px) { .queue-link { display: none; } }
</style>
