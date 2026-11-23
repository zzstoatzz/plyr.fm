<script lang="ts">
	/** Stats for everyone: the same page whoever is looking, signed in or not. The range drives the headline,
	 *  the bars, new tracks and most played; totals, sounds and tags are all time. */
	import { resolve } from '$app/paths';
	import type { NetworkArtist, StatsOverview, StatsRange, Track } from '@plyr/next-core/api';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { trackIdFromUri } from '@plyr/next-core/api';
	import { api } from '$lib/api';
	import { loadAtlas } from '$lib/atlas/catalog';
	import type { AtlasData } from '$lib/atlas/types';
	import { trackHref, artistName } from '$lib/tracks';
	import Artwork from '$lib/ui/Artwork.svelte';
	import ImmersiveWash from '$lib/ui/ImmersiveWash.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Loading from '$lib/ui/Loading.svelte';
	import BarChart from './BarChart.svelte';
	import RankedTrack from './RankedTrack.svelte';
	import SoundChart from './SoundChart.svelte';
	import { catalogDuration } from './duration';
	import { homeSounds, soundHeadline, sounds as toSounds } from './sounds';
	import { bucketDetail, bucketLabel, rangeSpan } from './ranges';

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
	const headline = $derived(soundList ? soundHeadline(soundList) : undefined);
	const homes = $derived(atlas ? homeSounds(atlas) : new Map<string, string>());
	const change = $derived(overview?.previous_plays ? overview.plays / overview.previous_plays : undefined);
	const bars = $derived(overview?.series.map(entry => ({ label: bucketLabel(entry.start, overview!.bucket), detail: bucketDetail(entry.start, overview!.bucket), value: entry.plays })) ?? []);
	const uploads = $derived(overview?.series.map(entry => ({ label: entry.start, value: entry.uploads })) ?? []);
	const wash = $derived(topTracks?.map(entry => trackArtwork(entry.track)).find(Boolean));
	const pct = (share: number) => `${Math.round(share * 100)}%`;
	const tiles = $derived(totals ? [
		[totals.plays.toLocaleString(), 'plays all time'],
		[totals.tracks.toLocaleString(), 'tracks'],
		[totals.artists.toLocaleString(), 'artists'],
		[catalogDuration(totals.duration_seconds), 'of audio'],
		...(overview ? [[overview.likes.toLocaleString(), 'likes']] : []),
		...(soundList ? [[String(soundList.length), 'sounds']] : [])
	] : []);
</script>

{#if wash}<ImmersiveWash mode="image" src={wash} />{/if}

{#if failed && !overview}
	<p role="alert" class="state">couldn’t load stats.</p>
	<button type="button" class="text-button" onclick={() => { retry += 1; }}>try again</button>
{:else if !overview}
	<Loading inline label="loading stats" />
{:else}
	<section class="hero" aria-label="plays">
		<div class="headline">
			<p class="big" aria-live="polite">{overview.plays.toLocaleString()}</p>
			<div class="line">
				<span class="what">plays {span.phrase}</span>
				{#if change !== undefined}
					<span class="delta" class:down={change < 0.95}>
						{#if change >= 1.05}↑ {change.toFixed(1)}× {span.before}{:else if change > 0.95}about the same as {span.before}{:else}↓ {Math.round((1 - change) * 100)}% fewer than {span.before}{/if}
					</span>
				{/if}
			</div>
			{#if headline}
				<p class="insight">
					<b>{headline.top.label}</b> gets the most plays of any sound on plyr.fm.
					{#if headline.standout}<b>{headline.standout.label}</b> is only {pct(headline.standout.trackShare)} of the tracks but gets {pct(headline.standout.playShare)} of plays.{/if}
				</p>
			{/if}
		</div>
		{#if tiles.length}
			<dl class="tiles" aria-label="totals">
				{#each tiles as [value, label] (label)}<div><dt>{label}</dt><dd>{value}</dd></div>{/each}
			</dl>
		{/if}
	</section>

	<section class="time" aria-label="plays over time">
		<BarChart {bars} bind:selected={selectedDay} label={`plays ${span.phrase}, ${overview.bucket === 'day' ? 'by day' : 'by month'}`} unit={['play', 'plays']} />
		<div class="strip-head"><b>new tracks</b><span>{overview.uploads.toLocaleString()} {span.phrase}</span></div>
		<BarChart bars={uploads} height={48} quiet axis={false} label="new tracks over time" unit={['track', 'tracks']} />
		{#if range === 'all' && overview.dated_plays < overview.plays}
			<p class="note">{overview.dated_plays.toLocaleString()} of these plays have a date, so those are the ones charted.</p>
		{/if}
	</section>

	{#if soundList?.length}
		<section class="block" aria-labelledby="sounds-title">
			<div class="section-head"><h2 id="sounds-title">what plyr.fm sounds like</h2><span>{soundList.length} {soundList.length === 1 ? 'sound' : 'sounds'}, grouped by how tracks actually sound · all time</span></div>
			<SoundChart sounds={soundList} />
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
			<div class="section-head"><h2 id="artists-title">artists</h2><span>by plays · pick one for their stats</span></div>
			{#if artists?.length}
				<ol class="list">
					{#each artists as entry, index (entry.artist.did)}
						<li><a class="artist" href={resolve(`/stats?${new URLSearchParams({ artist: entry.artist.handle })}`)}>
							<span class="rank" aria-hidden="true">{index + 1}</span>
							<span class="avatar"><Artwork src={entry.artist.avatar_url ?? undefined} size={40} fallbackIcon="user" /></span>
							<span class="name">
								<b class="truncate">{entry.artist.display_name || entry.artist.handle}</b>
								<span class="meta"><span>{entry.tracks.toLocaleString()} {entry.tracks === 1 ? 'track' : 'tracks'}</span>{#if homes.get(entry.artist.handle)}<span class="chip">{homes.get(entry.artist.handle)}</span>{/if}</span>
								<span class="bar" aria-hidden="true"><i style:width="{(100 * entry.plays) / artists[0].plays}%"></i></span>
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
							<span class="tag-name"><b class="truncate"># {tag.name}</b><small>{tag.track_count.toLocaleString()} tracks</small><span class="count">{tag.total_plays.toLocaleString()}</span></span>
							<span class="bar" aria-hidden="true"><i style:width="{(100 * tag.total_plays) / Math.max(1, tags[0].total_plays)}%"></i></span>
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
	.hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 30rem); gap: 1.5rem 2.5rem; align-items: end; }
	.big { margin: 0; font-size: clamp(4.25rem, 9vw, 6.5rem); font-weight: 800; line-height: 0.9; letter-spacing: -0.045em; font-variant-numeric: tabular-nums; }
	.line { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.9rem; margin-top: 0.6rem; }
	.what { font-size: clamp(1.2rem, 2.2vw, 1.65rem); font-weight: 700; }
	.delta { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.25rem 0.7rem; border-radius: 999px; font-size: var(--t-14); font-weight: 700;
		background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
	.delta.down { background: color-mix(in srgb, var(--muted) 16%, transparent); color: var(--muted); }
	.insight { margin: 1.3rem 0 0; max-width: 38rem; font-size: clamp(1.2rem, 1.8vw, 1.35rem); line-height: 1.4; }
	.insight b { color: var(--accent); }
	.tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.6rem; margin: 0; }
	.tiles div { display: flex; flex-direction: column; padding: 0.8rem 1rem; border-radius: 1rem; border: 1px solid var(--line); background: color-mix(in srgb, var(--surface) 70%, transparent); min-width: 0; }
	.tiles dd { order: -1; margin: 0; font-size: 1.6rem; font-weight: 700; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
	.tiles dt { color: var(--faint); font-size: var(--t-13-6); }
	.time { margin-top: 2rem; }
	.strip-head { display: flex; gap: 0.6rem; align-items: baseline; margin: 0.75rem 0 0.2rem; font-size: var(--t-14); }
	.strip-head span, .note { color: var(--faint); font-size: var(--t-13-6); }
	.note { margin: 0.5rem 0 0; }
	.block { margin-top: 3rem; }
	.section-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 0.25rem 1rem; margin-bottom: 0.75rem; }
	.section-head h2 { font-size: 1.35rem; }
	.section-head span { color: var(--faint); font-size: var(--t-13-6); }
	.section-head a { color: var(--accent); font-size: var(--t-14); }
	.columns { display: grid; grid-template-columns: 1.1fr 1fr 0.8fr; gap: 2.25rem; margin-top: 3rem; }
	.columns section { min-width: 0; }
	.columns .section-head h2 { font-size: 1.2rem; }
	.list { list-style: none; margin: 0; padding: 0; }
	.artist { display: grid; grid-template-columns: 1.25rem 2.5rem minmax(0, 1fr) auto 0.9rem; align-items: center; gap: 0.7rem; padding: 0.35rem 0.5rem; margin-inline: -0.5rem; border-radius: 0.7rem; color: var(--text); }
	.artist:hover { background: var(--hover); }
	.artist > :global(svg) { color: var(--faint); }
	.rank { color: var(--faint); font-size: var(--t-13-6); text-align: right; font-variant-numeric: tabular-nums; }
	.avatar { width: 2.5rem; border-radius: 50%; overflow: hidden; display: block; }
	.name { display: grid; gap: 0.2rem; min-width: 0; }
	.name b { font-size: var(--t-15); }
	.meta { display: flex; gap: 0.4rem; align-items: center; min-width: 0; color: var(--faint); font-size: var(--t-13-6); }
	.chip { font-size: var(--t-12); padding: 0.05rem 0.5rem; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
	.bar { display: block; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--text) 8%, transparent); overflow: hidden; }
	.bar i { display: block; height: 100%; border-radius: 2px; background: var(--accent); }
	.count { display: grid; justify-items: end; font-variant-numeric: tabular-nums; }
	.count b { font-size: var(--t-15); }
	.count small { color: var(--faint); font-size: var(--t-12); }
	.tag { display: grid; gap: 0.3rem; padding: 0.45rem 0; color: var(--text); }
	.tag-name { display: flex; align-items: baseline; gap: 0.5rem; min-width: 0; }
	.tag-name b { font-size: var(--t-15); }
	.tag-name small { color: var(--faint); font-size: var(--t-12-8); white-space: nowrap; }
	.tag-name .count { margin-left: auto; font-weight: 700; font-size: var(--t-14); }
	.tag:hover b { color: var(--accent); }
	.latest { list-style: none; margin: 0; padding: 0 0 0.25rem; display: grid; grid-auto-flow: column; grid-auto-columns: 8rem; gap: 0.85rem; overflow-x: auto; scrollbar-width: none; }
	.latest a { display: grid; gap: 0.15rem; color: var(--text); min-width: 0; }
	.latest a :global(img), .latest a :global(.artwork) { border-radius: 0.5rem; }
	.latest b { font-size: var(--t-14); margin-top: 0.35rem; }
	.latest span { color: var(--faint); font-size: var(--t-12-8); }
	@media (max-width: 1100px) {
		.hero { grid-template-columns: minmax(0, 1fr); }
		.columns { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
		.columns section:last-child { grid-column: 1 / -1; }
	}
	@media (max-width: 720px) {
		.tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.tiles dd { font-size: 1.35rem; }
		.columns { grid-template-columns: minmax(0, 1fr); gap: 2rem; }
		.block, .columns { margin-top: 2.25rem; }
	}
</style>
