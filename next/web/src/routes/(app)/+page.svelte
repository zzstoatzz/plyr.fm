<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { tagColors } from '@plyr/next-core/tag-colors';
	import { palettes } from '@plyr/next-core/colors';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import type { Snapshot } from '@sveltejs/kit';
	import type { Track } from '@plyr/next-core/api';
	import { api } from '$lib/api';
	import { player } from '$lib/player.svelte';
	import { artistContext } from '@plyr/next-core/play-context';
	import PlayButton from '$lib/ui/PlayButton.svelte';
	import { prefs } from '$lib/prefs.svelte';
	import { artistName } from '$lib/tracks';
	import Artwork from '$lib/ui/Artwork.svelte';
	import AtlasTile from '$lib/atlas/AtlasTile.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import LinksMenu from '$lib/LinksMenu.svelte';
	import Loading from '$lib/ui/Loading.svelte';
	import RailRadio from '$lib/home/RailRadio.svelte';
	import TrackRow from '$lib/TrackRow.svelte';
	import FollowingLatest from '$lib/listening/FollowingLatest.svelte';
	import PullRefresh from '$lib/home/PullRefresh.svelte';
	import { newAtTop, type RefreshResult } from '@plyr/next-core/behaviors/pull-refresh';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	// The rail scrolls with the page until its end reaches the bottom of the screen, then stays there.
	let railHeight = $state(0);
	let viewHeight = $state(0);
	const chartPeriods = ['month', 'week', 'day', 'all_time'] as const;
	type ChartPeriod = typeof chartPeriods[number];
	const chartLabels: Record<ChartPeriod, string> = {
		month: 'past month', week: 'past week', day: 'past day', all_time: 'all time'
	};
	let period = $state<ChartPeriod>('month');
	const nextPeriod = $derived(chartPeriods[(chartPeriods.indexOf(period) + 1) % chartPeriods.length]);
	let selectedChart = $state.raw<typeof data.chart>();
	const chart = $derived(selectedChart ?? data.chart);
	let chartRequest: AbortController | undefined;
	let periodButton = $state<HTMLButtonElement>();

	function showChart(value: ChartPeriod) {
		chartRequest?.abort();
		chartRequest = new AbortController();
		period = value;
		selectedChart = api.chart(value, 10, chartRequest.signal).then(result => result.data, () => null);
	}

	// A pull-to-refresh swaps in a fresh first page without reloading the route, so nothing flashes.
	let refreshed = $state.raw<{ source: typeof data.latest; value: typeof data.latest }>();
	const latest = $derived(refreshed?.source === data.latest ? refreshed.value : data.latest);
	let following = $state<FollowingLatest>();

	let home: HTMLDivElement;
	let extra: Track[] = $state.raw([]);
	let nextCursor: string | undefined = $state();
	let loading = $state(false);
	let error = $state('');
	let restoring = $state<typeof latest>();
	let pending: AbortController | undefined;
	const completed = new Set<string>();
	$effect(() => {
		latest;
		pending?.abort();
		pending = undefined;
		completed.clear();
		extra = [];
		nextCursor = undefined;
		loading = false;
		error = '';
	});
	onDestroy(() => { pending?.abort(); chartRequest?.abort(); });

	export const snapshot: Snapshot<{ y: number; tracks: Track[]; cursor?: string; period?: ChartPeriod }> = {
		capture: () => ({ y: window.scrollY, tracks: extra, cursor: nextCursor, period }),
		restore: ({ y, tracks, cursor, period: savedPeriod }) => {
			if (savedPeriod && savedPeriod !== period) showChart(savedPeriod);
			const position = window.scrollY;
			const request = latest;
			restoring = request;
			pending?.abort();
			pending = undefined;
			loading = false;
			void Promise.allSettled([request, chart, data.featured, data.discovery]).then(async ([first]) => {
				await tick();
				if (!home?.isConnected || latest !== request) return;
				const firstIds = new Set(first.status === 'fulfilled' ? first.value.data.map(track => track.id) : []);
				extra = tracks.filter(track => !firstIds.has(track.id));
				nextCursor = cursor;
				// The browser can clamp the saved scroll before the streamed rows render.
				await tick();
				if (home.isConnected && latest === request && window.scrollY === position) window.scrollTo(0, y);
			}).finally(() => { if (restoring === request) restoring = undefined; });
		}
	};

	function observeMore(node: HTMLElement, cursor: string) {
		const request = latest;
		if (typeof IntersectionObserver === 'undefined') return;
		const observer = new IntersectionObserver(entries => {
			if (entries.some(entry => entry.isIntersecting) && restoring !== request && latest === request && !error) void more(cursor);
		}, { rootMargin: '0px 0px 200px' });
		observer.observe(node);
		return () => observer.disconnect();
	}

	async function more(cursor: string, retry?: HTMLButtonElement) {
		if (pending || completed.has(cursor)) return;
		const controller = new AbortController();
		const request = latest;
		pending = controller;
		loading = true;
		try {
			const [page, first] = await Promise.all([api.tracks({ cursor, tag: data.tags, hidden_tag: data.hidden, limit: 24 }, controller.signal), request]);
			if (controller.signal.aborted || request !== latest) return;
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
				if (controller.signal.aborted || request !== latest || document.activeElement !== document.body) return;
				const row = added[0] && home.querySelector(`[data-track-id="${CSS.escape(added[0].id)}"][data-testid="home-track-row"] .title`);
				(row instanceof HTMLElement ? row : home.querySelector<HTMLElement>('#home-latest'))?.focus();
			}
		} catch {
			if (!controller.signal.aborted && request === latest) error = 'could not load more tracks.';
		} finally {
			if (pending === controller) {
				pending = undefined;
				loading = false;
			}
		}
	}

	async function refresh(): Promise<RefreshResult> {
		const source = data.latest;
		const before = await latest.then(page => page.data, () => []);
		chartRequest?.abort();
		const [page, entries] = await Promise.all([
			api.tracks({ limit: 24, tag: data.tags, hidden_tag: data.hidden }),
			data.tags.length ? Promise.resolve(null) : api.chart(period, 10).then(result => result.data, () => undefined),
			following?.reload()
		]);
		if (source !== data.latest) return { ok: false };
		refreshed = { source, value: Promise.resolve(page) };
		if (entries !== undefined && entries !== null) selectedChart = Promise.resolve(entries);
		const fresh = newAtTop(before, page.data);
		if (fresh) void tick().then(() => highlight(page.data.slice(0, fresh).map(track => track.id)));
		return { ok: true, fresh };
	}

	function highlight(ids: string[]) {
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const tint = getComputedStyle(home).getPropertyValue('--accent').trim();
		for (const id of ids) {
			home.querySelector(`[data-testid="home-track-row"][data-track-id="${CSS.escape(id)}"]`)?.animate(
				[{ backgroundColor: `color-mix(in srgb, ${tint} 18%, transparent)` }, { backgroundColor: 'transparent' }],
				{ duration: 1600, easing: 'ease-out' }
			);
		}
	}
</script>

<svelte:head><title>plyr.fm</title></svelte:head>
<svelte:window bind:innerHeight={viewHeight} />

{#snippet rail()}
<AtlasTile />
<section class="chart" data-testid="home-chart" aria-labelledby="home-top-tracks">
	<header>
		<h2 id="home-top-tracks">top tracks</h2>
		<button bind:this={periodButton} type="button" class="chart-period" aria-label={`top tracks period: ${chartLabels[period]}. show ${chartLabels[nextPeriod]}`} onclick={() => showChart(nextPeriod)}>
			{chartLabels[period]} <Icon name="chevron" size={15} />
		</button>
	</header>
	{#await chart}
		<div class="chart-loading"><Loading label="loading top tracks" inline /></div>
	{:then entries}
		{#if entries?.length}
			{@const tracks = entries.map(item => item.track)}
			<ol>
				{#each entries as item (item.track.id)}
					<li><TrackRow track={item.track} collection={tracks} label="top tracks" /></li>
				{/each}
			</ol>
		{:else if entries}
			<p class="chart-empty" role="status">no top tracks for this period</p>
		{:else}
			<div class="chart-empty">
				<p role="status">could not load top tracks</p>
				<button type="button" class="text-button" onclick={event => {
					if (document.activeElement === event.currentTarget) periodButton?.focus({ preventScroll: true });
					showChart(period);
				}}>try again</button>
			</div>
		{/if}
	{/await}
</section>
{#await data.discovery then tags}
	{#if tags.length}
		<section class="tags" aria-labelledby="home-tags">
			<header><h2 id="home-tags">browse by tag</h2></header>
			<nav class="tag-list" aria-label="Browse by tag">
				{#each tags.filter(tag => !prefs.hiddenTags.includes(tag.name)) as tag (tag.name)}
					<a style:--dot="light-dark({tagColors(tag.name, palettes.light.background, false).color}, {tagColors(tag.name, palettes.dark.background, false).color})" href={resolve('/(app)/tag/[name]', { name: tag.name })}><i aria-hidden="true"></i><span class="truncate">{tag.name}</span> <small>{tag.track_count}</small></a>
				{/each}
			</nav>
		</section>
	{/if}
{/await}
{/snippet}

<PullRefresh onrefresh={refresh}>
<div class="page-content home" class:filtered={data.tags.length > 0} bind:this={home}>
	<header class="mobile-brand"><LinksMenu /><h1>plyr.fm</h1></header>
	<div class="main">
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
					<h1><a class="feature-link" href={`/u/${top.artist.did}`}>{artistName(top)}</a></h1>
					<PlayButton name={artistName(top)} context={artistContext(top.artist.did)} start={() => player.play(byArtist[0], byArtist, artistName(top))} />
				</div>
			</section>
		{/if}
	{/await}
	{#if !data.tags.length}<FollowingLatest bind:this={following} />{/if}
	<section class="latest" aria-labelledby="home-latest">
		<header><h2 id="home-latest" tabindex="-1">{data.tags.length ? data.tags.join(', ') : 'latest'}</h2>{#if data.tags.length}<a href={resolve('/')}>all tracks</a>{:else}<span>newest first</span>{/if}</header>
		{#await data.discovery then tags}
			{#if tags.length}
				<nav class="tag-shelf" aria-label="Browse by tag">
					{#each tags.filter(tag => data.tags.includes(tag.name) || !prefs.hiddenTags.includes(tag.name)) as tag (tag.name)}
						{@const selected = data.tags.includes(tag.name)}
						{@const light = tagColors(tag.name, palettes.light.background, selected)}
						{@const dark = tagColors(tag.name, palettes.dark.background, selected)}
						<a style:color="light-dark({light.color}, {dark.color})" style:background-color="light-dark({light.backgroundColor}, {dark.backgroundColor})" style:border-color="light-dark({light.borderColor}, {dark.borderColor})" href={resolve('/(app)/tag/[name]', { name: tag.name })} aria-current={data.tags.includes(tag.name) ? 'page' : undefined}>{tag.name} <small>{tag.track_count}</small></a>
					{/each}
				</nav>
			{/if}
		{/await}
		{#await latest}
			<Loading label="loading the latest tracks" />
		{:then first}
			{#each [...first.data, ...extra] as track (track.id)}
				<TrackRow {track} testid="home-track-row" />
			{:else}
				<p class="state">no tracks found.</p>
			{/each}
			{@const cursor = nextCursor ?? first.next_cursor}
			{#if cursor && restoring !== latest}
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
	{#if !data.tags.length}<aside class="rail" aria-label="explore" bind:clientHeight={railHeight} style:--pin={`${Math.min(24, viewHeight - railHeight - 24)}px`}>{@render rail()}<RailRadio /></aside>{/if}
</div>
</PullRefresh>

<style>
	/* desktop: one main column (spotlight, people you know, latest) beside a rail (atlas, top tracks, tags) */
	.home { max-width: 118rem; display: grid; grid-template-columns: minmax(0, 2.6fr) minmax(12rem, 1fr); gap: 2.2rem; align-items: start; }
	.main { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2.2rem; min-width: 0; }
	.rail { display: grid; gap: 1.6rem; min-width: 0; }
	.home.filtered { grid-template-columns: minmax(0, 1fr); }
	.mobile-brand { grid-area: brand; display: flex; align-items: center; gap: 0.5rem; margin-bottom: -1rem; }
	@media (min-width: 721px) { .mobile-brand { display: none; } }
	.featured { position: relative; isolation: isolate; display: grid; align-items: center; min-height: 13rem; overflow: hidden; border: 1px solid var(--line); border-radius: 1.15rem; background: var(--surface); }
	.wall { position: absolute; inset: -15% -5% -15% 32%; z-index: -1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.4rem; align-content: center; transform: rotate(-4deg); mask-image: linear-gradient(90deg, transparent 0%, #000 55%); }
	.wall.pair { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.wall.single { inset: 0 0 0 30%; display: block; transform: none; }
	.wall.single :global(.artwork) { height: 100%; aspect-ratio: auto; }
	.feature-content { max-width: 65%; padding: clamp(1.2rem, 2.5vw, 2rem); }
	.feature-content span { font-weight: 650; color: var(--accent); font-size: var(--t-12-8); }
	h1 { line-height: 1.1; letter-spacing: -0.035em; }
	.feature-content h1 { font-size: clamp(1.75rem, 3.2vw, 2.75rem); margin-block: 0.4rem 1rem; }
	/* the whole card opens the artist; the play button sits above that link */
	.feature-link::after { content: ''; position: absolute; inset: 0; border-radius: inherit; }
	.feature-link:focus-visible { outline: none; }
	.featured:has(.feature-link:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
	.featured:hover .feature-link { text-decoration: underline; text-decoration-thickness: 0.06em; text-underline-offset: 0.12em; }
	.feature-content :global(.primary-button) { position: relative; z-index: 1; }
	.more { min-height: 2.75rem; color: var(--muted); }
	.latest { min-width: 0; }
	.tag-shelf { display: flex; gap: 0.45rem; overflow-x: auto; padding: 0.2rem 0.15rem 0.75rem; scrollbar-width: none; }
	.tag-shelf a { display: inline-flex; align-items: center; gap: 0.3rem; min-height: 2.75rem; padding-inline: 0.65rem; border: 1px solid var(--line); border-radius: 1.5rem; white-space: nowrap; color: var(--muted); }
	.tag-shelf a[aria-current=page] { border-color: var(--accent); color: var(--accent); }
	.tag-shelf small { font-variant-numeric: tabular-nums; }
	.chart, .tags { min-width: 0; }
	.chart-loading, .chart-empty { display: grid; align-items: center; min-height: 4.75rem; color: var(--muted); }
	.chart-empty button { justify-self: start; }
	.chart-period { display: inline-flex; align-items: center; justify-content: flex-end; gap: 0.2rem; min-height: 2.75rem; padding: 0; border: 0; background: none; color: var(--accent); white-space: nowrap; }
	.chart-period:hover { text-decoration: underline; text-underline-offset: 0.2em; }
	.latest header, .chart header, .tags header { display: flex; justify-content: space-between; align-items: baseline; gap: 0.65rem; padding-bottom: 0.65rem; }
	.tags header { align-items: center; min-height: 2.75rem; padding-bottom: 0.35rem; }
	h2 { font-size: var(--t-16-8); }
	header span, header a { color: var(--muted); font-size: var(--t-12-8); }
	/* the rank sits centred beside each cover */
	ol { margin: 0; padding: 0; list-style: none; counter-reset: rank; }
	.chart li { display: grid; grid-template-columns: 1.4rem minmax(0, 1fr); align-items: center; gap: 0.35rem; counter-increment: rank; }
	.chart li::before { content: counter(rank); color: var(--faint); font-size: var(--t-12-8); text-align: end; font-variant-numeric: tabular-nums; }
	.chart :global(.track) { grid-template-columns: 2.5rem minmax(0, 1fr); min-height: 3.6rem; }
	.chart :global(.duration), .chart :global(.row-actions), .chart :global(.metrics) { display: none; }
	.tag-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 0.75rem; }
	.tag-list a { display: flex; align-items: center; gap: 0.55rem; min-width: 0; min-height: 2.5rem; padding-inline: 0.5rem; border-radius: 0.5rem; color: var(--muted); }
	.tag-list a:hover { background: var(--hover); color: var(--text); }
	.tag-list i { flex: none; width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--dot); }
	.tag-list small { margin-left: auto; color: var(--faint); font-size: var(--t-12); font-variant-numeric: tabular-nums; }
	@media (min-width: 901px) {
		.main > :global(.following), .rail > :global(.tile) { grid-area: auto; }
		.home:not(.filtered) .tag-shelf { display: none; }
		.rail { position: sticky; top: var(--pin); }
		.chart :global(.track) { gap: 0.7rem; padding-inline: 0.375rem; margin-inline: 0; }
	}
	@media (min-width: 901px) and (max-width: 1239px) {
		/* the narrower rail has room for one tag per row */
		.tag-list { grid-template-columns: minmax(0, 1fr); }
	}
	@media (min-width: 1240px) {
		.home { grid-template-columns: minmax(0, 1fr) clamp(19rem, 25%, 25rem); column-gap: 2.75rem; }
		.rail > :global(.tile) { min-height: 9.5rem; }
		/* rows go to one line: plays, likes and when line up in columns before the hover actions */
		.latest :global(.track) { min-height: 4rem; }
		.latest :global(.name) { grid-template-columns: minmax(0, 1fr) auto; column-gap: 2rem; align-items: center; }
		.latest :global(.name > a) { grid-column: 1; }
		.latest :global(.metrics) { grid-column: 2; grid-row: 1 / 3; display: grid; grid-template-columns: 3.25rem 3.25rem 4.5rem; gap: 0.5rem; font-size: var(--t-12-8); }
	}
	@media (max-width: 900px) {
		.main, .rail { display: contents; }
		.tags, .rail > :global(.radio) { display: none; }
		.featured { grid-area: featured; min-height: 17rem; }
		.chart { grid-area: chart; }
		.latest { grid-area: latest; }
		.home { grid-template-columns: minmax(0, 1fr); grid-template-areas: "featured" "chart" "latest"; gap: 1.5rem; }
		.home:has(:global(.following)) { grid-template-areas: "featured" "following" "chart" "latest"; }
		.home.filtered { grid-template-areas: "latest"; }
		.chart ol { display: grid; grid-auto-flow: column; grid-auto-columns: min(14rem, 78vw); gap: 0.65rem; min-height: 4.75rem; padding: 0; overflow-x: auto; scrollbar-width: none; }
		.chart li { grid-template-columns: minmax(0, 1fr); align-items: center; min-width: 0; padding-inline: 0.7rem; border: 1px solid var(--line); border-radius: 0.6rem; background: var(--surface); }
		.chart li::before { display: none; }
	}
	@media (max-width: 720px) {
		.home { grid-template-areas: "brand" "featured" "chart" "latest"; }
		.home:has(:global(.following)) { grid-template-areas: "brand" "featured" "following" "chart" "latest"; }
		.home.filtered { grid-template-areas: "brand" "latest"; }
		.mobile-brand { display: flex; align-items: center; gap: 0.5rem; }
		.featured { min-height: 11.5rem; }
	}
</style>
