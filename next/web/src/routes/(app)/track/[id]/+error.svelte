<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
</script>

<svelte:head><title>{page.status} · plyr.fm</title></svelte:head>

<div class="page-content error">
	{#if page.status === 404}<img src="https://all-the.bufo.zone/bufo-shrug.png" alt="" width="180" height="180" />{/if}
	<h1>{page.status}</h1>
	<p class="subtle">{page.status === 404 ? "we couldn't find what you're looking for" : page.error?.message}</p>
	<a class="text-button" href={resolve('/')}>go home</a>
</div>

<style>
	.error { display: grid; align-content: center; justify-items: center; text-align: center; gap: 0.65rem; min-height: 70dvh; }
	img { object-fit: contain; }
	h1 { font-size: clamp(2.7rem, 8vw, 4rem); }
	a { color: var(--accent); }
</style>
