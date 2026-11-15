<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { SearchHit } from '@plyr/next-core/api';
	import { api } from '$lib/api';
	import Icon from '$lib/ui/Icon.svelte';
	import Loading from '$lib/ui/Loading.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let query = $derived(data.query);
	let input: HTMLInputElement;
	let list = $state<HTMLUListElement>();
	type Preview = { query: string; results: SearchHit[] } | { query: string; error: true };
	let preview = $state.raw<Preview>();
	const term = $derived(query.trim());
	const length = $derived([...term].length);
	const matching = $derived(preview?.query === term ? preview : undefined);
	const suggestionCount = $derived(matching && 'results' in matching ? matching.results.length : 0);

	$effect(() => {
		const value = term;
		preview = undefined;
		if (length < 2 || value === data.query) return;
		const request = new AbortController();
		const timer = setTimeout(() => {
			void api.search(value, { limit: 8, signal: request.signal }).then(
				({ data: results }) => { if (!request.signal.aborted) preview = { query: value, results }; },
				() => { if (!request.signal.aborted) preview = { query: value, error: true }; }
			);
		}, 180);
		return () => { clearTimeout(timer); request.abort(); };
	});

	function resultPath({ type, id }: SearchHit) {
		switch (type) {
			case 'artist': return resolve('/(app)/u/[actor]', { actor: id });
			case 'track': return resolve('/(app)/track/[id]', { id });
			case 'album': return resolve('/(app)/album/[id]', { id });
			case 'playlist': return resolve('/(app)/playlist/[id]', { id });
		}
	}

	function moveFocus(event: KeyboardEvent, index: number) {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		const links = list?.querySelectorAll('a');
		if (!links?.length) return;
		event.preventDefault();
		const next = event.key === 'ArrowDown' ? index + 1 : index < 0 ? links.length - 1 : index - 1;
		if (next < 0) input.focus();
		else links[next]?.focus();
	}
</script>

{#snippet hits(results: SearchHit[], suggestions: boolean)}
	{#if results.length}
		<ul bind:this={list} aria-label={suggestions ? 'search suggestions' : 'search results'}>
			{#each results as result, index (`${result.type}/${result.id}`)}
				<li>
					<a href={resultPath(result)} onkeydown={event => moveFocus(event, index)}>
						<span class="result-name">
							<strong>{result.title}</strong>
							<span class="subtle">{result.type === 'artist' ? '@' + result.owner.handle : result.owner.display_name || result.owner.handle}</span>
						</span>
						<span class="subtle">{result.type}</span>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="state" role="status">no results for “{term}”.</p>
	{/if}
{/snippet}

<svelte:head><title>search · plyr.fm</title></svelte:head>

<section class="page-content">
	<h1>search</h1>
	<form action="/search" onsubmit={event => {
		event.preventDefault();
		const shortcutSearch = page.state.shortcutSearch;
		if (length === 1) { input.focus(); return; }
		const url = new URL(resolve('/search'), page.url);
		if (term) url.searchParams.set('q', term);
		const retry = !!term && url.href === page.url.href;
		void goto(url, {
			replaceState: shortcutSearch || retry,
			keepFocus: retry,
			noScroll: retry,
			invalidate: retry ? ['plyr:catalog-search'] : undefined,
			state: { shortcutSearch }
		});
	}}>
		<input id="search-query" aria-label="Search tracks, artists, albums and playlists" type="search" name="q"
			bind:this={input} bind:value={query} autocomplete="off" placeholder="tracks, artists, albums and playlists"
			aria-describedby={!term ? 'search-hint' : undefined} onkeydown={event => moveFocus(event, -1)} />
		<button class="icon-button" type="submit" aria-label="Search"><Icon name="search" /></button>
	</form>
	<p class="announcer" role="status">{#if suggestionCount}{suggestionCount} {suggestionCount === 1 ? 'suggestion' : 'suggestions'}{/if}</p>
	{#if !term}
		<div class="empty">
			<Icon name="search" size={22} />
			<p id="search-hint">try a track title, artist name or handle, album, or playlist.</p>
		</div>
	{:else if length < 2}
		<p class="state" role="status">type at least two characters to search.</p>
	{:else if term === data.query}
		{#await data.results}
			<Loading label="searching" />
		{:then results}
			{@render hits(results, false)}
		{:catch}<p class="state" role="status">could not search. try again.</p>{/await}
	{:else if matching}
		{#if 'error' in matching}
			<p class="state" role="status">could not search. try again.</p>
		{:else}
			{@render hits(matching.results, true)}
		{/if}
	{:else}
		<Loading label="searching" />
	{/if}
</section>

<style>
	form { display: flex; gap: 0.5rem; margin: 0.75rem 0; max-width: 40rem; }
	input { flex: 1; min-width: 0; min-height: 2.75rem; border: 1px solid var(--line); border-radius: 0.6rem; background: var(--surface); padding: 0.65rem; }
	.empty { display: flex; align-items: center; gap: 0.75rem; max-width: 40rem; padding: 1rem; border: 1px solid var(--line); border-radius: 0.75rem; background: var(--surface); color: var(--accent); }
	.empty p { color: var(--muted); }
	.announcer { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
	ul { list-style: none; margin: 0; padding: 0; max-width: 40rem; }
	li { border-bottom: 1px solid var(--line); }
	li a { display: flex; justify-content: space-between; align-items: center; gap: 1rem; min-height: 2.75rem; padding: 0.65rem; }
	li a:hover { background: var(--hover); text-decoration: none; }
	.result-name { display: grid; min-width: 0; gap: 0.15rem; overflow-wrap: anywhere; }
</style>
