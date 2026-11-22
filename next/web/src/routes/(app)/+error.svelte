<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	const missing = $derived(page.status === 404);
</script>

<svelte:head><title>{missing ? 'not found' : 'something went wrong'} · plyr.fm</title></svelte:head>

<div class="page-content error">
	{#if missing}<img src="https://all-the.bufo.zone/bufo-shrug.png" alt="" width="180" height="180" />{/if}
	<h1>{missing ? '404' : 'hmm'}</h1>
	<p class="subtle">{missing ? (page.error?.message ?? "we couldn't find what you're looking for") : (page.error?.message ?? "plyr.fm couldn't load this page.")}</p>
	<div class="links">
		{#if missing}
			<a class="text-button" href={resolve('/search')}>search plyr.fm</a>
		{:else}
			<button class="text-button" type="button" onclick={() => location.reload()}>try again</button>
		{/if}
		<a class="text-button" href={resolve('/')}>go home</a>
	</div>
</div>

<style>
	.error { display: grid; align-content: center; justify-items: center; text-align: center; gap: 0.65rem; min-height: 70dvh; }
	img { object-fit: contain; }
	h1 { font-size: clamp(2.7rem, 8vw, 4rem); }
	.links { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.25rem; }
	.links :is(a, button) { color: var(--accent); }
</style>
