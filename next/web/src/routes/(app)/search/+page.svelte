<script lang="ts">
	import { goto } from '$app/navigation';
	import Icon from '$lib/ui/Icon.svelte';
	import Loading from '$lib/ui/Loading.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let query = $state('');
	$effect(() => { query = data.query; });

	function resultPath(type: string, id: string) {
		if (type === 'artist') return `/u/${id}`;
		return `/${type}/${id}`;
	}
</script>

<svelte:head><title>search · plyr.fm</title></svelte:head>

<section class="page-content">
	<h1>search</h1>
	<form action="/search" onsubmit={event => { event.preventDefault(); void goto(`/search?${new URLSearchParams({ q: query.trim() })}`); }}>
		<input aria-label="Search tracks, artists, albums and playlists" type="search" name="q" bind:value={query} placeholder="tracks, artists, albums and playlists" />
		<button class="icon-button" type="submit" aria-label="Search"><Icon name="search" /></button>
	</form>
	{#await data.results}
		<Loading label="searching" />
	{:then results}
		{#if data.query && !results.length}<p class="state">no results for “{data.query}”.</p>{/if}
		<ul>
			{#each results as result (`${result.type}/${result.id}`)}
				<li><a href={resultPath(result.type, result.id)}>{result.title}</a><span class="subtle">{result.type}</span></li>
			{/each}
		</ul>
	{:catch}<p class="state" role="status">could not search. try again.</p>{/await}
</section>

<style>
	form { display: flex; gap: 0.5rem; margin: 0.75rem 0; max-width: 40rem; }
	input { flex: 1; min-width: 0; border: 1px solid var(--line); border-radius: 0.6rem; background: var(--surface); padding: 0.65rem; }
	ul { list-style: none; margin: 0; padding: 0; max-width: 40rem; }
	li { padding: 0.65rem 0; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; gap: 1rem; }
</style>
