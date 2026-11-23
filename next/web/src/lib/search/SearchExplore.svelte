<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { ChartEntry, ListSummary } from '@plyr/next-core/api';
	import { api } from '$lib/api';
	import { artistName, trackHref } from '$lib/tracks';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Loading from '$lib/ui/Loading.svelte';

	let { recent, searchHref, selectRecent, clear }: {
		recent: string[];
		searchHref: (query: string) => string;
		selectRecent: (event: MouseEvent, query: string) => void;
		clear: () => void;
	} = $props();
	let charts = $state.raw<ChartEntry[]>();
	let lists = $state.raw<ListSummary[]>();
	let chartError = $state(false);
	let listError = $state(false);
	let chartRequest: AbortController | undefined;
	let live = false;
	const artists = $derived([...new Map((charts ?? []).map(({ track }) =>
		[track.artist.did, track])).values()].slice(0, 10));

	function loadChart() {
		chartError = false;
		chartRequest = new AbortController();
		const { signal } = chartRequest;
		void api.chart('month', 14, signal).then(
			({ data }) => { if (!signal.aborted) charts = data; },
			() => { if (!signal.aborted) chartError = true; }
		);
	}

	function loadLists() {
		listError = false;
		void api.playlists({ limit: 8 }).then(
			({ data }) => { if (live) lists = data; },
			() => { if (live) listError = true; }
		);
	}

	onMount(() => {
		live = true;
		loadChart();
		loadLists();
		return () => { live = false; chartRequest?.abort(); };
	});
</script>

<div class="explore">
	{#if recent.length}
		<section aria-labelledby="recent-searches">
			<header><h2 id="recent-searches">recent searches</h2><button class="text-button clear" type="button" onclick={clear}>clear</button></header>
			<ul class="recent">
				{#each recent as query (query)}<li><a href={searchHref(query)} onclick={event => selectRecent(event, query)}><Icon name="clock" size={16} /><span>{query}</span></a></li>{/each}
			</ul>
		</section>
	{/if}

	<section aria-labelledby="popular-tracks">
		<header><h2 id="popular-tracks">popular tracks</h2><span>past month</span></header>
		{#if chartError}
			<p class="subtle">could not load popular tracks.</p><button class="text-button" type="button" onclick={loadChart}>retry popular tracks</button>
		{:else if !charts}
			<Loading label="loading popular tracks" inline />
		{:else if charts.length}
			<ul class="covers">
				{#each charts.slice(0, 8) as { track } (track.id)}
					<li><a href={trackHref(track)}>
						<span class="tile-art"><Artwork src={track.media.artwork?.url} fallback={track.artist.profile.avatar_url ?? undefined} size={200} eager /></span>
						<strong>{track.metadata.title}</strong><small>{artistName(track)}</small>
					</a></li>
				{/each}
			</ul>
		{:else}<p class="subtle">no tracks on the chart yet.</p>{/if}
	</section>

	{#if artists.length}
		<section aria-labelledby="discover-artists">
			<header><h2 id="discover-artists">artists to explore</h2></header>
			<ul class="people">
				{#each artists as track (track.artist.did)}
					<li><a href={resolve('/(app)/u/[actor]', { actor: track.artist.did })}>
						<span class="tile-art"><Artwork src={track.artist.profile.avatar_url ?? undefined} fallback={track.media.artwork?.url} fallbackIcon="user" size={96} /></span>
						<strong>{track.artist.profile.display_name || '@' + track.artist.profile.handle}</strong>
						{#if track.artist.profile.display_name && track.artist.profile.display_name !== track.artist.profile.handle}
							<small>@{track.artist.profile.handle}</small>
						{/if}
					</a></li>
				{/each}
			</ul>
		</section>
	{/if}

	<section aria-labelledby="discover-playlists">
		<header><h2 id="discover-playlists">playlists</h2></header>
		{#if listError}
			<p class="subtle">could not load playlists.</p><button class="text-button" type="button" onclick={loadLists}>retry playlists</button>
		{:else if !lists}
			<Loading label="loading playlists" inline />
		{:else if lists.length}
			<ul class="covers">
				{#each lists.slice(0, 8) as list (list.id)}
					<li><a href={resolve('/(app)/playlist/[id]', { id: list.id })}>
						<span class="tile-art"><Artwork src={list.media?.artwork?.url} fallbackIcon="queue" size={200} /></span>
						<strong>{list.metadata.name || 'untitled playlist'}</strong><small>{list.owner.profile?.display_name || list.owner.profile?.handle || 'playlist'}</small>
					</a></li>
				{/each}
			</ul>
		{:else}<p class="subtle">no playlists yet.</p>{/if}
	</section>
</div>

<style>
	.explore { display: grid; gap: 1.75rem; margin-top: 1.45rem; min-width: 0; }
	section { min-width: 0; }
	header { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.65rem; }
	h2 { font-size: var(--t-18); letter-spacing: -0.02em; }
	header span, small { color: var(--muted); font-size: var(--t-13-6); }
	ul { list-style: none; padding: 0; margin: 0; }
	.covers, .people { display: grid; gap: 0.85rem; grid-template-columns: repeat(4, minmax(0, 1fr)); }
	.people { grid-template-columns: repeat(6, minmax(0, 1fr)); }
	.covers a, .people a { display: grid; align-content: start; gap: 0.2rem; height: 100%; min-width: 0; }
	.tile-art { display: block; overflow: hidden; border-radius: 0.7rem; outline: 1px solid var(--line); outline-offset: -1px; margin-bottom: 0.25rem; }
	.people .tile-art { width: min(100%, 5.5rem); border-radius: 50%; }
	strong, small { display: block; overflow-wrap: anywhere; }
	strong { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: var(--t-15); line-height: 1.25; font-weight: 650; }
	small { line-height: 1.3; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.recent { display: flex; flex-wrap: wrap; gap: 0.45rem; }
	.recent a { display: flex; align-items: center; gap: 0.4rem; min-height: 2.75rem; padding-inline: 0.7rem; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); }
	.recent span { overflow-wrap: anywhere; }
	.recent :global(svg) { flex: none; }
	.clear { color: var(--muted); margin-block: -0.5rem; margin-inline-end: -0.5rem; }
	.covers li:nth-child(n + 5), .people li:nth-child(n + 7) { display: none; }
	@media (min-width: 1500px) {
		.covers { grid-template-columns: repeat(6, minmax(0, 1fr)); }
		.people { grid-template-columns: repeat(8, minmax(0, 1fr)); }
		.covers li:nth-child(-n + 6), .people li:nth-child(-n + 8) { display: list-item; }
	}
	@media (min-width: 1900px) {
		.covers { grid-template-columns: repeat(8, minmax(0, 1fr)); }
		.people { grid-template-columns: repeat(10, minmax(0, 1fr)); }
		.covers li:nth-child(n), .people li:nth-child(n) { display: list-item; }
	}
	@media (max-width: 720px) {
		.covers, .people { grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: 44%; overflow-x: auto; padding: 0.2rem 0.2rem 0.65rem; scroll-snap-type: x proximity; }
		.people { grid-auto-columns: 30%; }
		.recent { flex-wrap: nowrap; overflow-x: auto; padding: 0.2rem; }
		.recent li { flex: 0 0 auto; max-width: 90%; }
		.covers li, .people li { scroll-snap-align: start; }
	}
</style>
