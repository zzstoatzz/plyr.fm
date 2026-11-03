<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	// profile editing moved into the portal
	onMount(() => goto('/portal', { replaceState: true }));
</script>
