<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { SearchHit } from '@plyr/next-core/api';
	import { api } from '$lib/api';
	import { trackHref } from '$lib/tracks';
	import Icon from '$lib/ui/Icon.svelte';
	import Artwork from '$lib/ui/Artwork.svelte';
	import SearchExplore from '$lib/search/SearchExplore.svelte';
	import Loading from '$lib/ui/Loading.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let query = $derived(data.query);
	let input: HTMLInputElement;
	let list = $state<HTMLUListElement>();
	let recent = $state<string[]>([]);
	let browseTags = $state.raw<{ name: string; track_count: number }[]>([]);
	onMount(() => {
		const request = new AbortController();
		void api.tags(100, request.signal).then(({ data }) => { browseTags = data; }, () => {});
		return () => request.abort();
	});
	const recentKey = 'plyr:recent-searches';
	const resultIcons = { track: 'music', artist: 'user', album: 'library', playlist: 'queue' } as const;

	onMount(() => {
		try {
			const saved: unknown = JSON.parse(localStorage.getItem(recentKey) ?? '[]');
			if (Array.isArray(saved)) recent = saved.filter((value): value is string => typeof value === 'string' && value.length >= 2 && value.length <= 100).slice(0, 6);
		} catch {}
	});

	function saveRecent(entries: string[]) {
		recent = entries;
		try { localStorage.setItem(recentKey, JSON.stringify(entries)); } catch {}
	}

	function clearRecent() {
		saveRecent([]);
		input.focus();
	}

	function rememberQuery(query: string) {
		if (query.length < 2) return;
		saveRecent([query, ...recent.filter(value => value.toLowerCase() !== query.toLowerCase())].slice(0, 6));
	}

	function searchHref(query: string) {
		return resolve('/search') + (query ? '?' + new URLSearchParams({ q: query }) : '');
	}
	type Preview = { query: string; results: SearchHit[] } | { query: string; error: true };
	let preview = $state.raw<Preview>();
	const term = $derived(query.trim());
	const length = $derived([...term].length);
	const matchingTags = $derived(length >= 2 ? browseTags.filter(tag => tag.name.toLocaleLowerCase().includes(term.toLocaleLowerCase())).slice(0, 8) : []);
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

	function resultPath(result: SearchHit) {
		const { id } = result;
		switch (result.type) {
			case 'artist': return resolve('/(app)/u/[actor]', { actor: id });
			case 'track': return trackHref(result);
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

	function submitSearch(value: string) {
		if ([...value].length === 1) { input.focus(); return; }
		rememberQuery(value);
		const url = new URL(searchHref(value), page.url);
		const shortcutSearch = page.state.shortcutSearch;
		const retry = !!value && url.href === page.url.href;
		void goto(url, {
			replaceState: shortcutSearch || retry,
			keepFocus: retry,
			noScroll: retry,
			invalidate: retry ? ['plyr:catalog-search'] : undefined,
			state: { shortcutSearch }
		});
	}

	function selectRecent(event: MouseEvent, value: string) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		submitSearch(value);
	}
</script>

{#snippet hits(results: SearchHit[], suggestions: boolean)}
	{#if results.length}
		<ul bind:this={list} aria-label={suggestions ? 'search suggestions' : 'search results'}>
			{#each results as result, index (`${result.type}/${result.id}`)}
				<li>
					<a href={resultPath(result)} onclick={() => rememberQuery(term)} onkeydown={event => moveFocus(event, index)}>
						<span class="result-art" class:avatar={result.type === 'artist'}><Artwork src={result.image_url ?? undefined} fallbackIcon={resultIcons[result.type]} /></span>
						<span class="result-name">
							<strong>{result.title}</strong>
							<span class="subtle">{result.type === 'artist' ? '@' + result.owner.handle : result.owner.display_name || result.owner.handle}</span>
						</span>
						<span class="result-type">{result.type}</span>
					</a>
				</li>
			{/each}
		</ul>
	{:else if !matchingTags.length}
		<p class="state" role="status">no results for “{term}”.</p>
	{/if}
{/snippet}

<svelte:head><title>search · plyr.fm</title></svelte:head>

<section class="page-content search-page">
	<h1>search</h1>
	<form action="/search" onsubmit={event => { event.preventDefault(); submitSearch(term); }}>
		<input id="search-query" aria-label="Search tracks, artists, albums and playlists" type="search" name="q"
			bind:this={input} bind:value={query} autocomplete="off" maxlength="100" placeholder="tracks, artists, albums and playlists"
			onkeydown={event => moveFocus(event, -1)} />
		<button class="icon-button" type="submit" aria-label="Search"><Icon name="search" /></button>
	</form>
	<p class="announcer" role="status">{#if suggestionCount}{suggestionCount} {suggestionCount === 1 ? 'suggestion' : 'suggestions'}{/if}</p>
	{#if length < 2}
		{#if length === 1}<p class="subtle" role="status">type at least two characters to search.</p>{/if}
		<SearchExplore {recent} {searchHref} {selectRecent} clear={clearRecent} />
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
	{#if matchingTags.length}
			<nav class="search-tags" aria-label="Matching tags">
				<h2>tags</h2>
				{#each matchingTags as tag (tag.name)}
					<a href={resolve('/(app)/tag/[name]', { name: tag.name })}>{tag.name} <small>{tag.track_count}</small></a>
				{/each}
			</nav>
	{/if}
</section>

<style>
	.search-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-block-start: 1rem; }
	.search-tags h2 { flex-basis: 100%; font-size: 1rem; }
	.search-tags a { display: inline-flex; align-items: center; gap: 0.3rem; min-height: 2.75rem; border: 1px solid var(--line); border-radius: 2rem; padding-inline: 0.7rem; }
	.search-tags small { color: var(--muted); }
	.search-page { max-width: 66rem; }
	form { display: flex; gap: 0.5rem; margin: 0.75rem 0; max-width: 40rem; }
	input { flex: 1; min-width: 0; min-height: 2.75rem; border: 1px solid var(--line); border-radius: 0.6rem; background: var(--surface); padding: 0.65rem; }
	.announcer { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
	ul { list-style: none; margin: 0; padding: 0; max-width: 40rem; }
	li { border-bottom: 1px solid var(--line); }
	li a { display: flex; align-items: center; gap: 0.75rem; min-height: 3.5rem; padding: 0.5rem 0.25rem; border-radius: 0.65rem; }
	li a:hover { background: var(--hover); text-decoration: none; }
	.result-name { flex: 1; display: grid; min-width: 0; gap: 0.12rem; overflow-wrap: anywhere; }
	.result-name strong { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
	.result-name .subtle, .result-type { font-size: 0.84rem; }
	.result-type { color: var(--muted); }
	.result-art { width: 3rem; flex: none; border-radius: 0.45rem; overflow: hidden; }
	.result-art.avatar { border-radius: 50%; }
</style>
