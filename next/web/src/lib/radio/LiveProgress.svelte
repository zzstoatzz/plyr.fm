<script lang="ts">
  import { onMount } from 'svelte';
  import { player } from '$lib/player.svelte';

  let value = $state(0);
  onMount(() => {
    const update = () => { value = player.livePosition(); };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  });
</script>

{#if player.duration > 0}<progress aria-label="Song progress" max={player.duration} value={value}></progress>{/if}

<style>
  progress { width: 100%; height: 0.6rem; accent-color: var(--accent); }
</style>
