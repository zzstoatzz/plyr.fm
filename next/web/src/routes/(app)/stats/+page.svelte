<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import ArtistStats from '$lib/stats/ArtistStats.svelte';
	import TrackChart from '$lib/stats/TrackChart.svelte';
	import { catalogDuration } from '$lib/stats/duration';
	import Loading from '$lib/ui/Loading.svelte';

	let stats = $state<Awaited<ReturnType<typeof api.stats>>>();
	let loading = $state(true);
	let attempted = $state(false);
	let error = $state(false);
	let request: AbortController | undefined;

	const cards = $derived(stats && [
		{ label: 'plays on Next', value: stats.plays.toLocaleString() },
		{ label: 'tracks', value: stats.tracks.toLocaleString() },
		{ label: 'artists', value: stats.artists.toLocaleString() },
		{ label: 'catalog runtime', value: catalogDuration(stats.duration_seconds) }
	] as const);

	onMount(() => {
		void refresh();
		return () => request?.abort();
	});

	async function refresh() {
		if (request) return;
		const controller = new AbortController();
		request = controller;
		loading = true;
		error = false;
		try { stats = await api.stats(controller.signal); }
		catch { if (!controller.signal.aborted) error = true; }
		finally { request = undefined; loading = false; attempted = true; }
	}

</script>

<svelte:head><title>stats · plyr.fm</title></svelte:head>

<section class="page-content stats">
	<header class="intro">
		<h1>stats</h1>
		<nav aria-label="on this page">
			<a href="#most-liked">most liked tracks</a>
			<a href="#artist-stats">artist stats</a>
		</nav>
	</header>

	<section class="overview" aria-labelledby="overview-title" aria-busy={loading}>
		<header class="overview-heading">
			<h2 id="overview-title">catalog overview</h2>
			{#if stats}
				<p class="subtle">updated <time datetime={new Date(stats.updated_at_ms).toISOString()}>{new Date(stats.updated_at_ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></p>
			{/if}
		</header>
		{#if loading && !cards}<Loading inline label="loading stats" />{/if}
		{#if cards}
			<dl class="totals" aria-label="Catalog totals">
				{#each cards as card (card.label)}
					<div><dt>{card.label}</dt><dd>{card.value}</dd></div>
				{/each}
			</dl>
		{/if}
		<div class="overview-actions">
			{#if cards}
				<details>
					<summary>what counts</summary>
					<p>tracks, artists and runtime are for music you can discover on Next. plays are listens that counted on Next. they don’t include earlier plays on plyr.fm.</p>
				</details>
			{/if}
			{#if attempted}<button class="text-button refresh" type="button" aria-disabled={loading} onclick={() => void refresh()}>{loading ? 'refreshing…' : error ? 'try again' : 'refresh stats'}</button>{/if}
		</div>
		{#if error}<p role="alert" class="state">{stats ? 'could not refresh stats.' : 'could not load stats.'}</p>{/if}
	</section>

	<div class="explore">
		<TrackChart />
		<ArtistStats />
	</div>
</section>

<style>
	.stats { max-width: 68rem; }
	.intro { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem 1.25rem; }
	h1 { font-size: clamp(1.9rem, 4vw, 2.6rem); letter-spacing: -0.035em; }
	h2 { font-size: 1.2rem; }
	nav { display: flex; gap: 1rem; flex-wrap: wrap; color: var(--muted); }
	nav a { display: inline-flex; align-items: center; min-height: 2.75rem; text-decoration: underline; text-underline-offset: 0.2em; }
	.overview { margin: 1.1rem 0 1.5rem; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 0.75rem 0 0.45rem; }
	.overview-heading, .overview-actions { display: flex; justify-content: space-between; align-items: start; gap: 0.5rem 1rem; flex-wrap: wrap; }
	.overview-actions { align-items: baseline; }
	.totals { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem 0.75rem; margin: 1rem 0 0.65rem; }
	.totals div { display: grid; align-content: start; }
	dt { grid-row: 2; color: var(--muted); font-size: 0.875rem; }
	dd { margin: 0; font-weight: 690; font-size: clamp(1.5rem, 4vw, 2.1rem); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
	details p { color: var(--muted); max-width: 30rem; padding: 0 0 0.6rem; }
	summary { line-height: 2.75rem; cursor: pointer; }
	.refresh { text-decoration: underline; text-underline-offset: 0.2em; }
	.refresh[aria-disabled="true"] { opacity: 0.6; cursor: wait; }
	.explore { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: clamp(1.5rem, 5vw, 3rem); }
	@media (max-width: 980px) { .explore { grid-template-columns: minmax(0, 1fr); } }
	@media (max-width: 720px) { .totals { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
