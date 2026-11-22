<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { page } from '$app/state';
	import { api } from '$lib/api';
	import ArtistStats from '$lib/stats/ArtistStats.svelte';
	import TrackChart from '$lib/stats/TrackChart.svelte';
	import { catalogDuration } from '$lib/stats/duration';
	import Loading from '$lib/ui/Loading.svelte';
	import Icon from '$lib/ui/Icon.svelte';

	let stats = $state<Awaited<ReturnType<typeof api.stats>>>();
	let loading = $state(true);
	let attempted = $state(false);
	let error = $state(false);
	let request: AbortController | undefined;

	const artistView = $derived(Boolean(page.url.searchParams.get('artist')));
	const cards = $derived(stats && [
		{ label: 'plays', icon: 'play_circle', value: stats.plays.toLocaleString() },
		{ label: 'tracks', icon: 'music', value: stats.tracks.toLocaleString() },
		{ label: 'artists', icon: 'users', value: stats.artists.toLocaleString() },
		{ label: 'runtime', icon: 'clock', value: catalogDuration(stats.duration_seconds) }
	] as const);

	$effect(() => {
		if (!artistView) untrack(() => { if (!attempted) void refresh(); });
	});
	onDestroy(() => request?.abort());

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
	{#if artistView}
		<div class="artist-detail"><ArtistStats /></div>
	{:else}
		<header class="intro">
			<h1>stats</h1>
			<nav aria-label="on this page">
				<a href="#most-liked"><Icon name="heart" size={16} /> most liked tracks</a>
				<a href="#artist-stats"><Icon name="user" size={16} /> artist stats</a>
			</nav>
		</header>
		<section class="overview" aria-labelledby="overview-title" aria-busy={loading}>
			<header class="overview-heading">
				<h2 id="overview-title">catalog overview</h2>
				{#if attempted}
					<button class="icon-button refresh" type="button" aria-label={loading ? 'refreshing' : error ? 'try again' : 'refresh stats'}
						title={error ? 'try again' : 'refresh stats'} aria-disabled={loading} onclick={() => void refresh()}>
						<Icon name="repeat" size={17} />
					</button>
				{/if}
			</header>
			{#if loading && !cards}<Loading inline label="loading stats" />{/if}
			{#if cards}
				<dl class="totals" aria-label="Catalog totals">
					{#each cards as card (card.label)}
						<div class:lead={card.label === 'plays'}>
							<dt><Icon name={card.icon} size={17} />{card.label}</dt><dd>{card.value}</dd>
						</div>
					{/each}
				</dl>
			{/if}
			{#if stats}
				<footer class="overview-actions">
					<details>
						<summary>about these numbers</summary>
						<p>plays are counted on Next. catalog totals cover discoverable tracks. artist totals can include tracks shared by direct link.</p>
					</details>
					<p>updated <time datetime={new Date(stats.updated_at_ms).toISOString()}>{new Date(stats.updated_at_ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></p>
				</footer>
			{/if}
			{#if error}<p role="alert" class="state">{stats ? 'could not refresh stats.' : 'could not load stats.'}</p>{/if}
		</section>

		<div class="explore">
			<TrackChart />
			<ArtistStats />
		</div>
	{/if}
</section>

<style>
	.stats { max-width: 72rem; }
	.intro { display: flex; align-items: end; justify-content: space-between; flex-wrap: wrap; gap: 0.55rem 1rem; margin-bottom: 1.25rem; }
	h1 { font-size: clamp(2.4rem, 5vw, 3.3rem); font-weight: 730; line-height: 1; letter-spacing: -0.065em; }
	h2 { font-size: var(--t-16); }
	nav { display: flex; gap: 0 0.95rem; flex-wrap: wrap; color: var(--muted); }
	nav a { display: inline-flex; align-items: center; gap: 0.4rem; min-height: 2.75rem; font-size: var(--t-14); }
	.overview { container-type: inline-size; margin-bottom: 1.35rem; background: var(--surface); border: 1px solid var(--line); border-radius: 1rem; overflow: hidden; }
	.overview-heading, .overview-actions { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem 0.8rem; flex-wrap: wrap; padding-inline: 1rem; }
	.overview-heading { min-height: 3.4rem; }
	.totals { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; margin: 0; background: var(--line); border-block: 1px solid var(--line); }
	.totals div { display: grid; align-content: start; gap: 0.45rem; min-width: 0; background: var(--surface); padding: 0.9rem 1rem 1.05rem; }
	.totals .lead { background: color-mix(in srgb, var(--accent) 9%, var(--surface)); }
	dt { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; color: var(--muted); font-size: var(--t-13-6); }
	dd { margin: 0; line-height: 1.05; font-weight: 700; letter-spacing: -0.045em; font-size: clamp(1.25rem, 3.2vw, 2.2rem); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
	.lead dd { color: var(--accent); }
	.overview-actions { align-items: start; color: var(--muted); font-size: var(--t-12-8); }
	.overview-actions > p { padding-block: 0.85rem; }
	details p { max-width: 41ch; padding-bottom: 0.85rem; }
	summary { display: list-item; min-height: 2.75rem; padding-block: 0.8rem; cursor: pointer; }
	.refresh { color: var(--muted); }
	.refresh[aria-disabled='true'] { opacity: 0.6; cursor: wait; }
	.state { padding-inline: 1rem; }
	.artist-detail { max-width: 42rem; margin-inline: auto; }
	.explore { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(15rem, 1fr); gap: 1.2rem; align-items: start; }
	@media (max-width: 850px) { .explore { grid-template-columns: minmax(0, 1fr); } }
	@media (max-width: 720px) {
		.intro { margin-bottom: 0.75rem; }
		.totals { grid-template-columns: repeat(3, minmax(0, 1fr)); }
		.totals div { padding: 0.75rem; }
		.totals .lead { grid-column: 1 / -1; padding-inline: 1rem; }
		.lead dd { font-size: 2.65rem; }
	}
	@container (max-width: 17rem) {
		.totals { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.totals .lead { grid-column: auto; padding-inline: 0.75rem; }
		.lead dd { font-size: 1.65rem; }
	}
</style>
