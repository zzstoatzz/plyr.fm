<script lang="ts">
	import { page } from '$app/state';
	import type { Artist, ArtistMetrics, SearchHit } from '@plyr/next-core/api';
	import { api } from '$lib/api';
	import Loading from '$lib/ui/Loading.svelte';
	import { catalogDuration } from './duration';

	let query = $state('');
	let searchRetry = $state(0);
	let artistRetry = $state(0);
	let matches = $state.raw<SearchHit[]>();
	let searchError = $state(false);
	let lookup = $state.raw<{ artist: Artist; stats: ArtistMetrics }>();
	let lookupError = $state(false);
	const term = $derived(query.trim().replace(/^@/, ''));
	const did = $derived(page.url.searchParams.get('artist') ?? '');

	$effect(() => {
		searchRetry;
		const value = term;
		matches = undefined;
		searchError = false;
		if ([...value].length < 2) return;
		const request = new AbortController();
		const timer = setTimeout(() => {
			void api.search(value, { types: 'artist', limit: 6, signal: request.signal }).then(
				({ data }) => { if (!request.signal.aborted) matches = data; },
				() => { if (!request.signal.aborted) searchError = true; }
			);
		}, 180);
		return () => { clearTimeout(timer); request.abort(); };
	});

	$effect(() => {
		artistRetry;
		const selected = did;
		lookup = undefined;
		lookupError = false;
		if (!selected) return;
		if (!selected.startsWith('did:') || selected.length > 2048) { lookupError = true; return; }
		const request = new AbortController();
		void Promise.all([api.artist(selected, request.signal), api.artistMetrics(selected, request.signal)]).then(
			([artist, stats]) => { if (!request.signal.aborted) lookup = { artist, stats }; },
			() => { if (!request.signal.aborted) lookupError = true; }
		);
		return () => request.abort();
	});
</script>

<section id="artist-stats" tabindex="-1" aria-labelledby="artist-stats-title">
	{#if did}
		<nav aria-label="stats breadcrumb"><a href="/stats#artist-stats">stats</a><span aria-hidden="true">/</span><span aria-current="page">artist</span></nav>
	{/if}
	<h2 id="artist-stats-title">artist stats</h2>
	<label for="stat-artist">find an artist</label>
	<input id="stat-artist" type="search" bind:value={query} placeholder="artist name or @handle" aria-describedby="artist-search-help" autocomplete="off" maxlength="160" />
	<p id="artist-search-help" class="subtle">type at least two characters, then choose an artist to see their stats.</p>

	{#if searchError}
		<p role="alert" class="state">couldn’t find artists right now.</p>
		<button type="button" class="text-button" onclick={() => { searchRetry += 1; }}>retry artist search</button>
	{:else if matches?.length}
		<ul aria-label="matching artists">
			{#each matches as match (match.id)}
				<li><a href={'/stats?artist=' + encodeURIComponent(match.id) + '#artist-stats'} onclick={() => { query = ''; }}>
					<strong>{match.title}</strong><span class="subtle">@{match.owner.handle}</span>
				</a></li>
			{/each}
		</ul>
	{:else if matches}
		<p role="status" class="state">no artists found for “{term}”.</p>
	{:else if [...term].length >= 2}
		<Loading inline label="finding artists" />
	{/if}

	{#if lookup}
		<div class="artist-result">
			<h3><a href={'/u/' + encodeURIComponent(lookup.artist.did)}>{lookup.artist.display_name || lookup.artist.handle}</a></h3>
			<dl aria-label="artist totals">
				<div><dt>tracks</dt><dd>{lookup.stats.totals.tracks.toLocaleString()}</dd></div>
				<div><dt>plays</dt><dd>{lookup.stats.totals.plays.toLocaleString()}</dd></div>
				<div><dt>catalog runtime</dt><dd>{catalogDuration(lookup.stats.totals.duration_seconds)}</dd></div>
			</dl>
			{#if lookup.stats.top_track && lookup.stats.top_track.play_count > 0}
				<p class="top"><span class="subtle">most played</span><a href={'/track/' + encodeURIComponent(lookup.stats.top_track.id)}>{lookup.stats.top_track.title}</a></p>
			{/if}
		</div>
	{:else if lookupError}
		<p role="alert" class="state">couldn’t load this artist’s stats. try again or choose another artist.</p>
		<button type="button" class="text-button" onclick={() => { artistRetry += 1; }}>retry artist stats</button>
	{:else if did}
		<Loading inline label="loading artist stats" />
	{/if}
</section>

<style>
	h2 { font-size: 1.2rem; margin: 0 0 0.65rem; }
	label { display: block; margin-bottom: 0.35rem; }
	input { display: block; width: 100%; min-height: 2.75rem; padding: 0.55rem 0.75rem; background: var(--bg); border: 1px solid var(--line); border-radius: 0.5rem; }
	input + p { margin: 0.45rem 0; }
	nav { display: flex; gap: 0.55rem; color: var(--muted); margin-bottom: 0.35rem; }
	nav a, h3 a, .top a { text-decoration: underline; text-underline-offset: 0.18em; }
	ul { list-style: none; padding: 0; margin: 0.55rem 0 0; }
	li a { display: grid; gap: 0.05rem; min-height: 2.75rem; padding: 0.45rem 0; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
	.artist-result { border-top: 1px solid var(--line); margin-top: 1.15rem; padding-top: 0.9rem; overflow-wrap: anywhere; }
	dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(4.6rem, 100%), 1fr)); gap: 0.6rem; }
	dl div { display: grid; }
	dt { grid-row: 2; color: var(--muted); font-size: 0.875rem; }
	dd { margin: 0; font-weight: 650; font-size: 1.1rem; font-variant-numeric: tabular-nums; }
	.top { display: grid; overflow-wrap: anywhere; }
</style>
