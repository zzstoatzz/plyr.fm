<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import Player from '$lib/components/Player.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children?.()}
<Player />

<style>
	:global(*),
	:global(*::before),
	:global(*::after) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		padding: 0;
		font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Consolas', monospace;
		background: #0a0a0a;
		color: #e0e0e0;
		-webkit-font-smoothing: antialiased;
	}
</style>
