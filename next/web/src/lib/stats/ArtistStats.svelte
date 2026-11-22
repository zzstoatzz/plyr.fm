<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Artist, ArtistMetrics, SearchHit } from '@plyr/next-core/api';
	import { api } from '$lib/api';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';
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

<section id="artist-stats" tabindex="-1" aria-label={did ? 'artist stats' : undefined} aria-labelledby={did ? undefined : 'artist-stats-title'}>
	{#if did}
		<nav aria-label="stats breadcrumb">
			<a href={resolve('/stats#artist-stats')}>stats</a>
			<Icon name="chevron" size={14} />
			<span aria-current="page">{lookup ? lookup.artist.display_name || lookup.artist.handle : 'artist'}</span>
		</nav>
		{#if lookup}
			{@const { artist, stats } = lookup}
			<div class="artist-result">
				<div class="artist-header">
					<span class="portrait"><Artwork src={artist.avatar_url ?? undefined} size={64} fallbackIcon="user" /></span>
					<div>
						<h1>{artist.display_name || artist.handle}</h1>
						<a class="artist-link" href={resolve('/(app)/u/[actor]', { actor: artist.did })}>@{artist.handle}</a>
					</div>
				</div>
				<dl aria-label="artist totals">
					<div><dt>plays</dt><dd>{stats.totals.plays.toLocaleString()}</dd></div>
					<div><dt>tracks</dt><dd>{stats.totals.tracks.toLocaleString()}</dd></div>
					<div><dt>runtime</dt><dd>{catalogDuration(stats.totals.duration_seconds)}</dd></div>
				</dl>
			</div>
		{:else}
			<h1>artist stats</h1>
			{#if lookupError}
				<p role="alert" class="state">couldn’t load this artist’s stats.</p>
				<button type="button" class="text-button" onclick={() => { artistRetry += 1; }}>retry artist stats</button>
			{:else}
				<Loading inline label="loading artist stats" />
			{/if}
		{/if}
	{/if}

	<div class="find">
		{#if !did}<h2 id="artist-stats-title">artist stats</h2>{/if}
		<label for="stat-artist">{did ? 'find another artist' : 'find an artist'}</label>
		<div class="search-field">
			<span><Icon name="search" size={18} /></span>
			<input id="stat-artist" type="search" bind:value={query} placeholder="artist name or @handle" aria-describedby="stat-artist-help" autocomplete="off" maxlength="100" />
		</div>
		<p id="stat-artist-help">type at least two characters.</p>
		<p class="announcer" role="status">{#if matches?.length}{matches.length} {matches.length === 1 ? 'artist found' : 'artists found'}{/if}</p>

		{#if searchError}
			<p role="alert" class="state">couldn’t find artists right now.</p>
			<button type="button" class="text-button" onclick={() => { searchRetry += 1; }}>retry artist search</button>
		{:else if matches?.length}
			<ul aria-label="matching artists">
				{#each matches as match (match.id)}
					<li><a href={resolve(`/stats?${new URLSearchParams({ artist: match.id })}#artist-stats`)} onclick={() => { query = ''; }}>
						<span class="avatar"><Artwork src={match.image_url ?? undefined} size={36} fallbackIcon="user" /></span>
						<span class="match-name"><strong>{match.title}</strong><span class="subtle">@{match.owner.handle}</span></span>
						<Icon name="chevron" size={16} />
					</a></li>
				{/each}
			</ul>
		{:else if matches}
			<p role="status" class="state">no artists found for “{term}”.</p>
		{:else if [...term].length >= 2}
			<Loading inline label="finding artists" />
		{/if}
	</div>
</section>

<style>
	section:focus { outline: none; }
	section { min-width: 0; }
	h1 { font-size: clamp(1.6rem, 4vw, 2.5rem); letter-spacing: -0.045em; line-height: 1.1; }
	h2 { font-size: 1.2rem; margin-bottom: 0.8rem; }
	.find, .artist-result { background: var(--surface); border: 1px solid var(--line); border-radius: 1rem; }
	.find { padding: 1rem; }
	label { display: block; margin-bottom: 0.4rem; color: var(--muted); font-size: var(--t-14); }
	#stat-artist-help { margin-top: 0.45rem; color: var(--muted); font-size: var(--t-12-8); }
	.search-field { position: relative; }
	.search-field > span { position: absolute; inset-inline-start: 0.75rem; inset-block: 0; display: grid; place-items: center; color: var(--muted); pointer-events: none; }
	input { display: block; width: 100%; min-height: 2.75rem; padding: 0.55rem 0.75rem 0.55rem 2.4rem; background: var(--bg); border: 1px solid var(--line); border-radius: 0.6rem; }
	nav { display: flex; align-items: center; gap: 0.45rem; color: var(--muted); margin-block: 0 0.55rem; overflow-wrap: anywhere; }
	nav a { display: inline-flex; align-items: center; min-height: 2.75rem; }
	nav a, .artist-link { text-decoration: underline; text-underline-offset: 0.18em; }
	.announcer { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
	ul { list-style: none; padding: 0; margin: 0.55rem 0 0; }
	li a { display: grid; grid-template-columns: 2.25rem minmax(0, 1fr) auto; align-items: center; gap: 0.65rem; padding: 0.45rem 0.15rem; border-top: 1px solid var(--line); overflow-wrap: anywhere; }
	.avatar, .portrait { border-radius: 50%; }
	.match-name { display: grid; min-width: 0; }
	.artist-result { container-type: inline-size; margin-bottom: 1rem; overflow-wrap: anywhere; }
	.artist-header { display: flex; align-items: center; gap: 0.85rem; padding: 1rem; }
	.portrait { flex: 0 0 clamp(2.75rem, 12vw, 4rem); }
	.artist-link { display: inline-block; color: var(--muted); margin-top: 0.25rem; }
	dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; margin: 0; border-top: 1px solid var(--line); background: var(--line); border-radius: 0 0 1rem 1rem; }
	dl div { display: grid; align-content: start; gap: 0.4rem; min-width: 0; padding: 0.75rem; background: var(--surface); border-radius: inherit; }
	dl div:first-child { background: color-mix(in srgb, var(--accent) 9%, var(--surface)); border-end-end-radius: 0; }
	dl div:nth-child(2) { border-radius: 0; }
	dl div:last-child { border-end-start-radius: 0; }
	dt { color: var(--muted); font-size: var(--t-12-8); }
	dd { margin: 0; line-height: 1.1; font-weight: 700; font-size: clamp(1.25rem, 4.5vw, 2rem); letter-spacing: -0.045em; font-variant-numeric: tabular-nums; }
	dl div:first-child dd { color: var(--accent); }
	@container (max-width: 17rem) {
		dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		dl div:first-child { grid-column: 1 / -1; border-radius: 0; }
		dl div:nth-child(2) { border-end-start-radius: 1rem; }
	}
	.state { margin: 0.75rem 0; }
	section > button { margin-bottom: 1rem; }
</style>
