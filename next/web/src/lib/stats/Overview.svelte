<script lang="ts">
	/** Stats for everyone: the same page whoever is looking, signed in or not. The range drives the headline,
	 *  the bars, new tracks and most played; totals, sounds and tags are all time. */
	import { resolve } from '$app/paths';
	import type { NetworkArtist, StatsOverview, StatsRange, Track } from '@plyr/next-core/api';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { trackIdFromUri } from '@plyr/next-core/api';
	import { api } from '$lib/api';
	import { loadAtlas } from '$lib/atlas/catalog';
	import type { AtlasData } from '@plyr/next-core/atlas/types';
	import { trackHref, artistName } from '$lib/tracks';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Loading from '$lib/ui/Loading.svelte';
	import BarChart from './BarChart.svelte';
	import RankedTrack from './RankedTrack.svelte';
	import SoundTable from './SoundTable.svelte';
	import { catalogDuration } from './duration';
	import { homeSounds, soundHeadline, sounds as toSounds, typicalPlays } from './sounds';
	import { averageBars, averageSpan, barDetail, barSpan, barTicks, rangeSpan } from './ranges';

	let { range }: { range: StatsRange } = $props();

	type Totals = Awaited<ReturnType<typeof api.stats>>;
	let totals = $state.raw<Totals>();
	let overview = $state.raw<StatsOverview>();
	let topTracks = $state.raw<{ track: Track; plays: number }[]>();
	let artists = $state.raw<{ artist: NetworkArtist; plays: number; tracks: number }[]>();
	let tags = $state.raw<{ name: string; track_count: number; total_plays: number }[]>();
	let latest = $state.raw<Track[]>();
	let atlas = $state.raw<AtlasData>();
	let failed = $state(false);
	let retry = $state(0);
	let selectedDay = $state<number>();

	// all-time pieces load once
	$effect(() => {
		retry;
		const request = new AbortController();
		void api.stats(request.signal).then(value => { totals = value; }, () => {});
		void api.tags(9, request.signal).then(page => { tags = [...page.data].sort((a, b) => b.total_plays - a.total_plays); }, () => {});
		void api.tracks({ limit: 8 }, request.signal).then(page => { latest = page.data; }, () => {});
		void loadAtlas().then(value => { if (!request.signal.aborted) atlas = value; }, () => {});
		return () => request.abort();
	});

	// the range drives the rest
	$effect(() => {
		retry;
		const chosen = range;
		const request = new AbortController();
		failed = false;
		selectedDay = undefined;
		void api.statsOverview(chosen, request.signal).then(async value => {
			if (request.signal.aborted) return;
			overview = value;
			const [resolved, people] = await Promise.all([
				value.tracks.length ? api.resolveTracks(value.tracks.map(entry => trackIdFromUri(entry.uri))) : { data: [] as Track[] },
				value.artists.length ? api.resolveArtists(value.artists.slice(0, 7).map(entry => entry.did), request.signal) : []
			]);
			if (request.signal.aborted) return;
			const byUri = new Map(resolved.data.map(track => [track.record.uri, track]));
			topTracks = value.tracks.flatMap(entry => { const track = byUri.get(entry.uri); return track ? [{ track, plays: entry.plays }] : []; }).slice(0, 7);
			const byDid = new Map(people.map(person => [person.did, person]));
			artists = value.artists.slice(0, 7).flatMap(entry => { const artist = byDid.get(entry.did); return artist ? [{ artist, plays: entry.plays, tracks: entry.tracks }] : []; });
		}, () => { if (!request.signal.aborted) failed = true; });
		return () => request.abort();
	});

	const span = $derived(rangeSpan(range));
	const soundList = $derived(atlas ? toSounds(atlas) : undefined);
	const typical = $derived(atlas ? typicalPlays(atlas) : 0);
	const headline = $derived(soundList ? soundHeadline(soundList, typical) : undefined);
	const homes = $derived(atlas ? homeSounds(atlas) : new Map<string, string>());
	const change = $derived(overview?.previous_plays ? overview.plays / overview.previous_plays : undefined);
	const hours = $derived(overview?.bucket_hours ?? 24);
	const bars = $derived.by(() => {
		if (!overview) return [];
		const ticks = barTicks(overview.series.map(entry => entry.start), overview.bucket_hours);
		return overview.series.map((entry, index) => ({ value: entry.plays, detail: barDetail(entry.start, overview!.bucket_hours), tick: ticks[index] }));
	});
	const uploads = $derived(overview?.series.map(entry => ({ value: entry.uploads, detail: barDetail(entry.start, overview!.bucket_hours) })) ?? []);
	const days = $derived(overview ? Math.max(1, (Date.parse(overview.end) - Date.parse(overview.start)) / 86_400_000) : 1);
	const perDay = $derived(overview ? Math.round(overview.dated_plays / days) : 0);
	const figures = $derived(totals ? [
		[totals.plays.toLocaleString(), 'plays all time'],
		[totals.tracks.toLocaleString(), 'tracks'],
		[totals.artists.toLocaleString(), 'artists'],
		[catalogDuration(totals.duration_seconds), 'of audio'],
		...(overview ? [[overview.likes.toLocaleString(), 'likes']] : [])
	] : []);
</script>

{#if failed && !overview}
	<p role="alert" class="state">couldn’t load stats.</p>
	<button type="button" class="text-button" onclick={() => { retry += 1; }}>try again</button>
{:else if !overview}
	<Loading inline label="loading stats" />
{:else}
	<section class="hero" aria-label="plays">
		<p class="big" aria-live="polite">{overview.plays.toLocaleString()}</p>
		<div>
			<p class="what">plays {span.phrase}</p>
			<p class="sub">
				{#if change !== undefined}
					{#if change >= 1.05}{change.toFixed(1)}× {span.before}{:else if change > 0.95}about the same as {span.before}{:else}{Math.round((1 - change) * 100)}% fewer than {span.before}{/if}{#if perDay}, about {perDay.toLocaleString()} a day{/if}
				{:else if perDay && range !== 'all'}about {perDay.toLocaleString()} a day{/if}
			</p>
		</div>
	</section>
	{#if headline}
		<p class="insight">
			Most plays go to <b>{headline.top.label}</b>.
			{#if headline.standout}Tracks in <b>{headline.standout.label}</b> get played a lot for their number: about {Math.round(headline.standoutPerTrack).toLocaleString()} plays each, where a typical plyr.fm track gets {Math.round(typical).toLocaleString()}.{/if}
		</p>
	{/if}
	{#if figures.length}
		<dl class="figures" aria-label="totals">
			{#each figures as [value, label] (label)}<div><dd>{value}</dd><dt>{label}</dt></div>{/each}
		</dl>
	{/if}

	<section class="time" aria-label="plays over time">
		<BarChart {bars} average={averageBars(hours)} bind:selected={selectedDay} label={`plays ${span.phrase}, each bar ${barSpan(hours)}`} unit={['play', 'plays']} />
		<p class="legend"><span><i class="swatch"></i>each bar is {barSpan(hours)}</span><span><i class="stroke"></i>{averageSpan(hours)}</span></p>
		<div class="strip-head"><b>new tracks</b><span>{overview.uploads.toLocaleString()} {span.phrase}</span></div>
		<BarChart bars={uploads} height={48} quiet axis={false} label="new tracks over time" unit={['track', 'tracks']} />
		{#if range === 'all' && overview.dated_plays < overview.plays}
			<p class="note">{overview.dated_plays.toLocaleString()} of these plays have a date, so those are the ones charted.</p>
		{/if}
	</section>

	{#if soundList?.length}
		<section class="block" aria-labelledby="sounds-title">
			<div class="section-head"><h2 id="sounds-title">sounds on plyr.fm</h2><span>every track lands in one sound, by how it sounds · all time · <a href={resolve('/(app)/atlas')}>sound map</a></span></div>
			<SoundTable sounds={soundList} {typical} />
		</section>
	{/if}

	<div class="columns">
		<section aria-labelledby="top-title">
			<div class="section-head"><h2 id="top-title">most played</h2><span>{span.short}</span></div>
			{#if topTracks?.length}
				<ol class="list">{#each topTracks as entry, index (entry.track.id)}<RankedTrack track={entry.track} rank={index + 1} plays={entry.plays} max={topTracks[0].plays} collection={topTracks.map(item => item.track)} />{/each}</ol>
			{:else if topTracks}<p class="state">no plays {span.phrase}.</p>{/if}
		</section>
		<section aria-labelledby="artists-title">
			<div class="section-head"><h2 id="artists-title">artists</h2><span>pick one for their stats</span></div>
			{#if artists?.length}
				<ol class="list">
					{#each artists as entry, index (entry.artist.did)}
						<li><a class="artist" href={resolve(`/stats?${new URLSearchParams({ artist: entry.artist.handle })}`)}>
							<span class="rank" aria-hidden="true">{index + 1}</span>
							<span class="avatar"><Artwork src={entry.artist.avatar_url ?? undefined} size={40} fallbackIcon="user" /></span>
							<span class="name">
								<b class="truncate">{entry.artist.display_name || entry.artist.handle}</b>
								<span class="meta truncate">{entry.tracks.toLocaleString()} {entry.tracks === 1 ? 'track' : 'tracks'}{#if homes.get(entry.artist.handle)}{` · mostly ${homes.get(entry.artist.handle)}`}{/if}</span>
							</span>
							<span class="count"><b>{entry.plays.toLocaleString()}</b><small>plays</small></span>
							<Icon name="chevron" size={14} />
						</a></li>
					{/each}
				</ol>
			{:else if artists}<p class="state">no plays {span.phrase}.</p>{/if}
		</section>
		<section aria-labelledby="tags-title">
			<div class="section-head"><h2 id="tags-title">tags</h2><span>by plays · all time</span></div>
			{#if tags?.length}
				<ol class="list">
					{#each tags as tag (tag.name)}
						<li><a class="tag" href={resolve('/(app)/tag/[name]', { name: tag.name })}>
							<span class="tag-name"><b class="truncate">#{tag.name}</b><small>{tag.track_count.toLocaleString()} tracks</small><span class="count">{tag.total_plays.toLocaleString()}</span></span>
						</a></li>
					{/each}
				</ol>
			{/if}
		</section>
	</div>

	{#if latest?.length}
		<section class="block" aria-labelledby="latest-title">
			<div class="section-head"><h2 id="latest-title">just arrived</h2><a href={resolve('/')}>latest</a></div>
			<ul class="latest">
				{#each latest as track (track.id)}
					<li><a href={trackHref(track)}><Artwork src={trackArtwork(track)} size={160} /><b class="truncate">{track.metadata.title}</b><span class="truncate">{artistName(track)}</span></a></li>
				{/each}
			</ul>
		</section>
	{/if}
{/if}

<style>
	.hero { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem 1.4rem; }
	.big { margin: 0; font-size: clamp(4.25rem, 9vw, 6.9rem); font-weight: 800; line-height: 0.85; letter-spacing: -0.05em; font-variant-numeric: tabular-nums; }
	.what { margin: 0; font-size: clamp(1.25rem, 2.2vw, 1.65rem); font-weight: 700; }
	.sub { margin: 0.1rem 0 0; color: var(--muted); font-size: var(--t-16-8); }
	.insight { margin: 1.25rem 0 0; max-width: 45rem; font-size: clamp(1.2rem, 1.8vw, 1.35rem); line-height: 1.45; }
	.insight b { color: var(--accent); }
	.figures { display: flex; flex-wrap: wrap; gap: 0.4rem 2.1rem; margin: 1.6rem 0 0; }
	.figures div { display: flex; align-items: baseline; gap: 0.35rem; }
	.figures dd { margin: 0; font-size: 1.4rem; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
	.figures dt { color: var(--faint); font-size: var(--t-16); }
	.time { margin-top: 2.25rem; }
	.legend { display: flex; flex-wrap: wrap; gap: 0.3rem 1.2rem; margin: 0.4rem 0 0; color: var(--faint); font-size: var(--t-12-8); }
	.legend span { display: inline-flex; align-items: center; gap: 0.4rem; }
	.swatch { width: 0.6rem; height: 0.6rem; background: color-mix(in srgb, var(--accent) 55%, transparent); }
	.stroke { width: 1rem; height: 2px; background: var(--text); }
	.strip-head { display: flex; gap: 0.6rem; align-items: baseline; margin: 1rem 0 0.2rem; font-size: var(--t-14); }
	.strip-head span, .note { color: var(--faint); font-size: var(--t-13-6); }
	.note { margin: 0.5rem 0 0; }
	.block { margin-top: 3.5rem; }
	.section-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 0.25rem 1rem; padding-bottom: 0.6rem; border-bottom: 2px solid var(--text); }
	.section-head h2 { font-size: 1.45rem; letter-spacing: -0.02em; }
	.section-head span { color: var(--faint); font-size: var(--t-13-6); }
	.section-head a { color: var(--accent); }
	.columns { display: grid; grid-template-columns: 1.1fr 1fr 0.8fr; gap: 3rem; margin-top: 3.5rem; }
	.columns section { min-width: 0; }
	.list { list-style: none; margin: 0; padding: 0; }
	.list > :global(li) { border-bottom: 1px solid var(--line); }
	.artist { display: grid; grid-template-columns: 1.25rem 2.25rem minmax(0, 1fr) auto 0.9rem; align-items: center; gap: 0.7rem; padding: 0.45rem 0; color: var(--text); }
	.artist:hover b { color: var(--accent); }
	.artist > :global(svg) { color: var(--faint); }
	.rank { color: var(--faint); font-size: var(--t-13-6); text-align: right; font-variant-numeric: tabular-nums; }
	.avatar { width: 2.25rem; border-radius: 50%; overflow: hidden; display: block; }
	.name { display: grid; gap: 0.1rem; min-width: 0; }
	.name b { font-size: var(--t-15); }
	.meta { color: var(--faint); font-size: var(--t-13-6); }
	.count { display: grid; justify-items: end; font-variant-numeric: tabular-nums; }
	.count b { font-size: var(--t-15); }
	.count small { color: var(--faint); font-size: var(--t-12); }
	.tag { display: block; padding: 0.55rem 0; color: var(--text); }
	.tag-name { display: flex; align-items: baseline; gap: 0.5rem; min-width: 0; }
	.tag-name b { font-size: var(--t-15); }
	.tag-name small { color: var(--faint); font-size: var(--t-12-8); white-space: nowrap; }
	.tag-name .count { margin-left: auto; font-weight: 700; font-size: var(--t-15); }
	.tag:hover b { color: var(--accent); }
	.latest { list-style: none; margin: 0; padding: 0.9rem 0 0.25rem; display: grid; grid-auto-flow: column; grid-auto-columns: 8rem; gap: 0.85rem; overflow-x: auto; scrollbar-width: none; }
	.latest a { display: grid; gap: 0.15rem; color: var(--text); min-width: 0; }
	.latest a :global(img), .latest a :global(.artwork) { border-radius: 0.25rem; }
	.latest b { font-size: var(--t-14); margin-top: 0.35rem; }
	.latest span { color: var(--faint); font-size: var(--t-12-8); }
	@media (max-width: 1100px) {
		.columns { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
		.columns section:last-child { grid-column: 1 / -1; }
	}
	@media (max-width: 720px) {
		.figures { gap: 0.3rem 1.4rem; }
		.figures dd { font-size: 1.2rem; }
		.figures dt { font-size: var(--t-14); }
		.columns { grid-template-columns: minmax(0, 1fr); gap: 2.25rem; }
		.block, .columns { margin-top: 2.5rem; }
	}
</style>
