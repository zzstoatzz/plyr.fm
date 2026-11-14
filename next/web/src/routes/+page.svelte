<script lang="ts">
	import type { Track } from '$core/api';
	import { api } from '$lib/api';
	import { trackArtwork } from '$core/artwork';
	import { player } from '$lib/player.svelte';
	import { artistName } from '$lib/tracks';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Loading from '$lib/ui/Loading.svelte';
	import TrackRow from '$lib/TrackRow.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let extra: Track[] = $state.raw([]);
	let nextCursor: string | undefined = $state();
	let loading = $state(false);
	let error = $state('');
	$effect(() => { data.latest; extra = []; nextCursor = undefined; error = ''; });

	async function more(cursor: string) {
		const request = data.latest;
		loading = true;
		error = '';
		try {
			const [page, first] = await Promise.all([api.tracks({ cursor, tag: data.tags, limit: 24 }), request]);
			if (request !== data.latest) return;
			const known = new Set([...first.data, ...extra].map(track => track.id));
			extra = [...extra, ...page.data.filter(track => !known.has(track.id))];
			nextCursor = page.next_cursor ?? '';
		} catch { error = 'could not load more tracks.'; }
		finally { loading = false; }
	}
</script>

<svelte:head><title>plyr.fm</title></svelte:head>

<div class="page-content home">
	<header class="mobile-brand"><h1><span aria-hidden="true">✻</span> plyr.fm</h1></header>
	{#await data.featured then featured}
		{#if featured.length}
			{@const top = featured[Math.floor(Date.now() / 604800000) % featured.length]}
			{@const byArtist = featured.filter(track => track.artist.did === top.artist.did)}
			<section class="featured" data-testid="home-featured" aria-label="artist of the week">
				<div class="wall" aria-hidden="true">
					{#each featured.slice(0, 6) as track (track.id)}
						<Artwork src={trackArtwork(track)} size={200} />
					{/each}
				</div>
				<div class="feature-content">
					<span>artist of the week</span>
					<h1><a href={`/u/${top.artist.did}`}>{artistName(top)}</a></h1>
					<button class="primary-button" aria-label={`Play all ${byArtist.length} by ${artistName(top)}`} onclick={() => player.play(top, byArtist, artistName(top))}><Icon name="play" /></button>
				</div>
			</section>
		{/if}
	{/await}
	<section class="latest">
		<header><h2>latest</h2>{#if data.tags.length}<a href="/">clear filters</a>{:else}<span>newest first</span>{/if}</header>
		{#await data.latest}
			<Loading label="loading the latest tracks" />
		{:then first}
			{#each [...first.data, ...extra] as track (track.id)}
				<TrackRow {track} testid="home-track-row" />
			{:else}
				<p class="state">no tracks found.</p>
			{/each}
			{@const cursor = nextCursor ?? first.next_cursor}
			{#if cursor}<button class="text-button" disabled={loading} onclick={() => more(cursor)}>{loading ? 'loading…' : 'load more'}</button>{/if}
			{#if error}<p role="status" class="state">{error}</p>{/if}
		{:catch}
			<p role="status" class="state">could not load tracks. <a href="/">try again</a></p>
		{/await}
	</section>
	{#await data.chart then chart}
		{#if chart.length}
			<section class="chart" data-testid="home-chart">
				<header><h2>top tracks</h2><span>past month</span></header>
				<ol>
					{#each chart as item (item.track.id)}
						<li><TrackRow track={item.track} collection={chart.map(entry => entry.track)} label="top tracks" /></li>
					{/each}
				</ol>
			</section>
		{/if}
	{/await}
</div>

<style>
	.home { display: grid; grid-template-columns: minmax(0, 2.6fr) minmax(12rem, 1fr); gap: 2.2rem; }
	.mobile-brand { display: none; }
	.featured { grid-column: 1 / -1; position: relative; isolation: isolate; display: grid; align-items: center; min-height: 17rem; overflow: hidden; border: 1px solid var(--line); border-radius: 1.15rem; background: var(--surface); }
	.wall { position: absolute; inset: -15% -5% -15% 32%; z-index: -1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.4rem; align-content: center; transform: rotate(-4deg); mask-image: linear-gradient(90deg, transparent 0%, #000 55%); }
	.feature-content { max-width: 65%; padding: clamp(1.2rem, 3vw, 2.5rem); }
	.feature-content span { font-weight: 650; color: var(--accent); font-size: 0.8rem; }
	h1 { line-height: 1.1; letter-spacing: -0.035em; }
	.feature-content h1 { font-size: clamp(1.75rem, 4vw, 3.25rem); margin-block: 0.5rem 1.2rem; }
	.latest, .chart { min-width: 0; }
	.latest header, .chart header { display: flex; justify-content: space-between; align-items: baseline; gap: 0.65rem; padding-bottom: 0.65rem; }
	h2 { font-size: 1.07rem; }
	header span, header a { color: var(--muted); font-size: 0.8rem; }
	ol { margin: 0; padding-left: 1.6rem; }
	li::marker { color: var(--faint); font-size: 0.75rem; }
	.chart :global(.track) { grid-template-columns: 2.5rem minmax(0, 1fr); min-height: 3.6rem; }
	.chart :global(.duration), .chart :global(.add), .chart :global(.metrics) { display: none; }
	@media (max-width: 900px) {
		.home { grid-template-columns: minmax(0, 1fr); gap: 1.5rem; }
		.chart { grid-row: 3; }
	}
	@media (max-width: 720px) {
		.mobile-brand { display: block; }
		.mobile-brand span { color: var(--accent); }
		.featured { min-height: 11.5rem; }
	}
</style>
