<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import type { Snapshot } from '@sveltejs/kit';
	import type { Track } from '@plyr/next-core/api';
	import { api } from '$lib/api';
	import { player } from '$lib/player.svelte';
	import { artistName } from '$lib/tracks';
	import Artwork from '$lib/ui/Artwork.svelte';
	import AtlasTile from '$lib/atlas/AtlasTile.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import LinksMenu from '$lib/LinksMenu.svelte';
	import Loading from '$lib/ui/Loading.svelte';
	import TrackRow from '$lib/TrackRow.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let home: HTMLDivElement;
	let extra: Track[] = $state.raw([]);
	let nextCursor: string | undefined = $state();
	let loading = $state(false);
	let error = $state('');
	let restoring = $state<typeof data.latest>();
	let pending: AbortController | undefined;
	const completed = new Set<string>();
	$effect(() => {
		data.latest;
		pending?.abort();
		pending = undefined;
		completed.clear();
		extra = [];
		nextCursor = undefined;
		loading = false;
		error = '';
	});
	onDestroy(() => pending?.abort());

	export const snapshot: Snapshot<{ y: number; tracks: Track[]; cursor?: string }> = {
		capture: () => ({ y: window.scrollY, tracks: extra, cursor: nextCursor }),
		restore: ({ y, tracks, cursor }) => {
			const position = window.scrollY;
			const request = data.latest;
			restoring = request;
			pending?.abort();
			pending = undefined;
			loading = false;
			void Promise.allSettled([request, data.chart, data.featured]).then(async ([first]) => {
				await tick();
				if (!home?.isConnected || data.latest !== request) return;
				const firstIds = new Set(first.status === 'fulfilled' ? first.value.data.map(track => track.id) : []);
				extra = tracks.filter(track => !firstIds.has(track.id));
				nextCursor = cursor;
				// The browser can clamp the saved scroll before the streamed rows render.
				await tick();
				if (home.isConnected && data.latest === request && window.scrollY === position) window.scrollTo(0, y);
			}).finally(() => { if (restoring === request) restoring = undefined; });
		}
	};

	function observeMore(node: HTMLElement, cursor: string) {
		const request = data.latest;
		if (typeof IntersectionObserver === 'undefined') return;
		const observer = new IntersectionObserver(entries => {
			if (entries.some(entry => entry.isIntersecting) && restoring !== request && data.latest === request && !error) void more(cursor);
		}, { rootMargin: '0px 0px 200px' });
		observer.observe(node);
		return () => observer.disconnect();
	}

	async function more(cursor: string, retry?: HTMLButtonElement) {
		if (pending || completed.has(cursor)) return;
		const controller = new AbortController();
		const request = data.latest;
		pending = controller;
		loading = true;
		try {
			const [page, first] = await Promise.all([api.tracks({ cursor, tag: data.tags, limit: 24 }, controller.signal), request]);
			if (controller.signal.aborted || request !== data.latest) return;
			const known = new Set([...first.data, ...extra].map(track => track.id));
			const added = page.data.filter(track => {
				if (known.has(track.id)) return false;
				known.add(track.id);
				return true;
			});
			const restoreFocus = retry && document.activeElement === retry;
			extra = [...extra, ...added];
			error = '';
			completed.add(cursor);
			nextCursor = page.next_cursor && !completed.has(page.next_cursor) ? page.next_cursor : '';
			if (restoreFocus) {
				await tick();
				if (controller.signal.aborted || request !== data.latest || document.activeElement !== document.body) return;
				const row = added[0] && home.querySelector(`[data-track-id="${CSS.escape(added[0].id)}"][data-testid="home-track-row"] .title`);
				(row instanceof HTMLElement ? row : home.querySelector<HTMLElement>('#home-latest'))?.focus();
			}
		} catch {
			if (!controller.signal.aborted && request === data.latest) error = 'could not load more tracks.';
		} finally {
			if (pending === controller) {
				pending = undefined;
				loading = false;
			}
		}
	}
</script>

<svelte:head><title>plyr.fm</title></svelte:head>

<div class="page-content home" bind:this={home}>
	<header class="mobile-brand"><LinksMenu /><h1>plyr.fm</h1></header>
	{#await data.featured}
		<div class="featured" aria-hidden="true"></div>
	{:then featured}
		{#if featured.length}
			{@const top = featured[Math.floor(Date.now() / 604800000) % featured.length]}
			{@const byArtist = featured.filter(track => track.artist.did === top.artist.did)}
			{@const covers = [...new Set(byArtist.flatMap(track => track.media.artwork?.url ? [track.media.artwork.url] : []))].slice(0, 6)}
			{@const artwork = covers.length ? covers : top.artist.profile.avatar_url ? [top.artist.profile.avatar_url] : []}
			<section class="featured" data-testid="home-featured" aria-label="artist of the week">
				<div class="wall" class:single={artwork.length === 1} class:pair={artwork.length === 2} aria-hidden="true">
					{#each artwork as src (src)}
						<Artwork {src} size={artwork.length === 1 ? 640 : 220} />
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
	<AtlasTile />
	<section class="chart" data-testid="home-chart" aria-labelledby="home-top-tracks">
		<header><h2 id="home-top-tracks">top tracks</h2><span>past month</span></header>
		{#await data.chart}
			<div class="chart-loading"><Loading label="loading top tracks" inline /></div>
		{:then chart}
			{@const tracks = chart.map(item => item.track)}
			<ol>
				{#each chart as item (item.track.id)}
					<li><TrackRow track={item.track} collection={tracks} label="top tracks" /></li>
				{:else}
					<li class="chart-empty">no top tracks yet.</li>
				{/each}
			</ol>
		{/await}
	</section>
	<section class="latest" aria-labelledby="home-latest">
		<header><h2 id="home-latest" tabindex="-1">latest</h2>{#if data.tags.length}<a href="/">clear filters</a>{:else}<span>newest first</span>{/if}</header>
		{#await data.latest}
			<Loading label="loading the latest tracks" />
		{:then first}
			{#each [...first.data, ...extra] as track (track.id)}
				<TrackRow {track} testid="home-track-row" />
			{:else}
				<p class="state">no tracks found.</p>
			{/each}
			{@const cursor = nextCursor ?? first.next_cursor}
			{#if cursor && restoring !== data.latest}
				{#key cursor}
					<div class="more" {@attach node => observeMore(node, cursor)}>
						{#if error}
							<p role="status">{loading ? 'loading more tracks…' : error}</p>
							<button type="button" class="text-button" aria-disabled={loading} onclick={event => more(cursor, event.currentTarget)}>try again</button>
						{:else if loading}<Loading label="loading more tracks" inline />
						{:else if typeof IntersectionObserver === 'undefined'}
							<button type="button" class="text-button" onclick={event => more(cursor, event.currentTarget)}>load more</button>
						{/if}
					</div>
				{/key}
			{/if}
		{:catch}
			<p role="status" class="state">could not load tracks.</p>
			<button type="button" class="text-button" onclick={() => invalidateAll()}>try again</button>
		{/await}
	</section>

</div>

<style>
	.home { display: grid; grid-template-columns: minmax(0, 2.6fr) minmax(12rem, 1fr); grid-template-areas: "brand brand" "featured featured" "latest chart"; gap: 2.2rem; }
	.mobile-brand { grid-area: brand; display: flex; align-items: center; gap: 0.5rem; margin-bottom: -1rem; }
	@media (min-width: 721px) { .mobile-brand h1 { display: none; } }
	.featured { grid-area: featured; position: relative; isolation: isolate; display: grid; align-items: center; min-height: 17rem; overflow: hidden; border: 1px solid var(--line); border-radius: 1.15rem; background: var(--surface); }
	.wall { position: absolute; inset: -15% -5% -15% 32%; z-index: -1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.4rem; align-content: center; transform: rotate(-4deg); mask-image: linear-gradient(90deg, transparent 0%, #000 55%); }
	.wall.pair { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.wall.single { inset: 0 0 0 30%; display: block; transform: none; }
	.wall.single :global(.artwork) { height: 100%; aspect-ratio: auto; }
	.feature-content { max-width: 65%; padding: clamp(1.2rem, 3vw, 2.5rem); }
	.feature-content span { font-weight: 650; color: var(--accent); font-size: 0.8rem; }
	h1 { line-height: 1.1; letter-spacing: -0.035em; }
	.feature-content h1 { font-size: clamp(1.75rem, 4vw, 3.25rem); margin-block: 0.5rem 1.2rem; }
	.more { min-height: 2.75rem; color: var(--muted); }
	.latest { grid-area: latest; min-width: 0; }
	.chart { grid-area: chart; min-width: 0; }
	.chart-loading, .chart-empty { display: grid; align-items: center; min-height: 4.75rem; color: var(--muted); }
	.chart-empty { list-style: none; }
	.latest header, .chart header { display: flex; justify-content: space-between; align-items: baseline; gap: 0.65rem; padding-bottom: 0.65rem; }
	h2 { font-size: 1.07rem; }
	header span, header a { color: var(--muted); font-size: 0.8rem; }
	ol { margin: 0; padding-left: 1.6rem; }
	li::marker { color: var(--faint); font-size: 0.75rem; }
	@media (min-width: 1240px) {
		.home { grid-template-columns: minmax(0, 1fr) minmax(16rem, 29%); grid-template-areas: "brand brand" "featured atlas" "latest chart"; }
		.home:not(:has(.featured)) { grid-template-areas: "brand brand" "atlas atlas" "latest chart"; }
	}
	.chart :global(.track) { grid-template-columns: 2.5rem minmax(0, 1fr); min-height: 3.6rem; }
	.chart :global(.duration), .chart :global(.add), .chart :global(.metrics) { display: none; }
	@media (max-width: 900px) {
		.home { grid-template-columns: minmax(0, 1fr); grid-template-areas: "brand" "featured" "chart" "latest"; gap: 1.5rem; }
		.chart ol { display: grid; grid-auto-flow: column; grid-auto-columns: min(14rem, 78vw); gap: 0.65rem; min-height: 4.75rem; padding: 0; overflow-x: auto; scrollbar-width: none; }
		.chart li { display: grid; align-items: center; min-width: 0; padding-inline: 0.7rem; border: 1px solid var(--line); border-radius: 0.6rem; background: var(--surface); }
		.chart li::marker { content: ''; }
	}
	@media (max-width: 720px) {
		.home { grid-template-areas: "brand" "featured" "chart" "latest"; }
		.mobile-brand { display: flex; align-items: center; gap: 0.5rem; }
		.featured { min-height: 11.5rem; }
	}
</style>
