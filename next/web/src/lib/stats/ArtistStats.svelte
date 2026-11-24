<script lang="ts">
	/** One artist's stats, built from the same pieces as everyone's: their plays against plyr.fm's,
	 *  where they sit in each sound, and every track ranked. All time: dated plays per artist come later. */
	import { resolve } from '$app/paths';
	import type { Artist, ArtistMetrics, Track } from '@plyr/next-core/api';
	import { api } from '$lib/api';
	import { loadAtlas } from '$lib/atlas/catalog';
	import type { AtlasData } from '@plyr/next-core/atlas/types';
	import ImmersiveWash from '$lib/ui/ImmersiveWash.svelte';
	import LoadMore from '$lib/ui/LoadMore.svelte';
	import Loading from '$lib/ui/Loading.svelte';
	import RankedTrack from './RankedTrack.svelte';
	import { catalogDuration } from './duration';
	import { artistSounds, typicalPlays } from './sounds';

	let { actor, onartist }: { actor: string; onartist?: (artist: Artist | undefined) => void } = $props();

	type Totals = Awaited<ReturnType<typeof api.stats>>;
	let artist = $state.raw<Artist>();
	let metrics = $state.raw<ArtistMetrics>();
	let tracks = $state.raw<Track[]>();
	let rank = $state<number>();
	let everyone = $state.raw<{ plays: number }>();
	let totals = $state.raw<Totals>();
	let atlas = $state.raw<AtlasData>();
	let missing = $state(false);
	let failed = $state(false);
	let retry = $state(0);
	let shown = $state(25);

	async function allTracks(did: string, signal: AbortSignal) {
		const found: Track[] = [];
		let cursor: string | undefined;
		for (let page = 0; page < 20; page += 1) {
			const next = await api.tracks({ artist_did: did, limit: 100, cursor }, signal);
			found.push(...next.data);
			if (!next.has_more || !next.next_cursor) break;
			cursor = next.next_cursor;
		}
		return found;
	}

	$effect(() => {
		retry;
		const chosen = actor;
		const request = new AbortController();
		artist = undefined; metrics = undefined; tracks = undefined; rank = undefined;
		missing = false; failed = false; shown = 25;
		onartist?.(undefined);
		void api.artist(chosen, request.signal).then(async found => {
			if (request.signal.aborted) return;
			artist = found;
			onartist?.(found);
			const [stats, list, overview] = await Promise.all([
				api.artistMetrics(found.did, request.signal),
				allTracks(found.did, request.signal),
				api.statsOverview('all', request.signal).catch(() => undefined)
			]);
			if (request.signal.aborted) return;
			metrics = stats;
			tracks = [...list].sort((a, b) => b.metrics.play_count - a.metrics.play_count);
			if (overview) {
				everyone = { plays: overview.plays };
				const at = overview.artists.findIndex(entry => entry.did === found.did);
				rank = at >= 0 ? at + 1 : undefined;
			}
		}, error => {
			if (request.signal.aborted) return;
			if (error?.status === 404 || error?.status === 400) missing = true; else failed = true;
		}).catch(() => { if (!request.signal.aborted) failed = true; });
		void api.stats(request.signal).then(value => { totals = value; }, () => {});
		void loadAtlas().then(value => { if (!request.signal.aborted) atlas = value; }, () => {});
		return () => request.abort();
	});

	const name = $derived(artist ? artist.display_name || artist.handle : '');
	const mine = $derived(atlas && artist ? artistSounds(atlas, artist.handle) : undefined);
	const plays = $derived(metrics?.totals.plays ?? 0);
	const likes = $derived(tracks?.reduce((sum, track) => sum + track.metrics.like_count, 0));
	const perTrack = $derived(metrics?.totals.tracks ? plays / metrics.totals.tracks : 0);
	const average = $derived(totals?.tracks ? totals.plays / totals.tracks : 0);
	const pct = (share: number) => `${Math.round(share * 100)}%`;
	const typical = $derived(atlas ? typicalPlays(atlas) : average);
	const leads = $derived(mine?.sounds.filter(sound => sound.rank === 1).slice(0, 2) ?? []);
	const top = $derived(tracks?.[0]);
</script>

{#if artist?.avatar_url}<ImmersiveWash src={artist.avatar_url} />{/if}

{#if missing}
	<p role="alert" class="state">couldn’t find that artist on plyr.fm.</p>
	<a class="text-button" href={resolve('/stats')}>back to stats for everyone</a>
{:else if failed}
	<p role="alert" class="state">couldn’t load this artist’s stats.</p>
	<button type="button" class="text-button" onclick={() => { retry += 1; }}>try again</button>
{:else if !artist || !metrics || !tracks}
	<Loading inline label="loading artist stats" />
{:else}
	<section class="hero" aria-label="artist totals">
		<p class="big">{plays.toLocaleString()}</p>
		<div>
			<p class="what">plays all time</p>
			{#if plays && (rank || everyone?.plays)}
				<p class="sub">
					{#if rank === 1}the most played artist on plyr.fm{:else if rank && totals}#{rank} of {totals.artists.toLocaleString()} artists by plays{/if}{#if rank && everyone?.plays}{', '}{/if}{#if everyone?.plays}{pct(plays / everyone.plays)} of every play{/if}
				</p>
			{/if}
		</div>
	</section>
	<p class="insight">
		{#if leads.length === 2}{name} is the most played artist in <b>{leads[0].label}</b> and <b>{leads[1].label}</b>.
		{:else if leads.length === 1}{name} is the most played artist in <b>{leads[0].label}</b>.
		{:else if mine?.sounds.length && plays}Most of {name}’s plays are in <b>{mine.sounds[0].label}</b>.{/if}
		{#if top && top.metrics.play_count}<b>{top.metadata.title}</b> is their most played track.{/if}
	</p>
	<dl class="figures" aria-label="totals">
		<div><dd>{metrics.totals.tracks.toLocaleString()}</dd><dt>{metrics.totals.tracks === 1 ? 'track' : 'tracks'}</dt></div>
		<div><dd>{catalogDuration(metrics.totals.duration_seconds)}</dd><dt>of audio</dt></div>
		<div><dd>{(likes ?? 0).toLocaleString()}</dd><dt>likes</dt></div>
		<div><dd>{Math.round(perTrack).toLocaleString()}</dd><dt>plays per track</dt></div>
		{#if typical && metrics.totals.tracks}<div class="aside"><dt>a typical plyr.fm track gets {Math.round(typical).toLocaleString()}</dt></div>{/if}
	</dl>

	{#if mine?.sounds.length}
		<section class="block" aria-labelledby="artist-sounds-title">
			<div class="section-head"><h2 id="artist-sounds-title">where {name} fits</h2><span>the sounds their tracks land in · <a href={resolve('/(app)/atlas')}>sound map</a></span></div>
			<ol class="fits">
				{#each mine.sounds as sound (sound.id)}
					<li>
						<div class="sound"><b class="truncate">{sound.label}</b><span>{sound.tracks} {sound.tracks === 1 ? 'track' : 'tracks'} · {sound.plays.toLocaleString()} {sound.plays === 1 ? 'play' : 'plays'}</span></div>
						<span class="meter" aria-hidden="true"><i style:width="{(100 * sound.plays) / Math.max(1, mine.sounds[0].plays)}%"></i></span>
						<span class="standing" class:lead={sound.rank === 1}>{sound.rank === 1 ? 'the most played artist here' : `#${sound.rank} most played artist here`}</span>
					</li>
				{/each}
			</ol>
			{#if mine.mapped < tracks.length}
				<p class="note">{(tracks.length - mine.mapped).toLocaleString()} of {name}’s {tracks.length.toLocaleString()} tracks {tracks.length - mine.mapped === 1 ? 'isn’t' : 'aren’t'} in a sound yet.</p>
			{/if}
		</section>
	{/if}

	<section class="block" aria-labelledby="artist-tracks-title">
		<div class="section-head"><h2 id="artist-tracks-title">tracks</h2><span>{tracks.length.toLocaleString()} {tracks.length === 1 ? 'track' : 'tracks'} · by plays</span></div>
		{#if tracks.length}
			<ol class="list">
				{#each tracks.slice(0, shown) as track, index (track.id)}
					<RankedTrack {track} rank={index + 1} plays={track.metrics.play_count} max={Math.max(1, tracks[0].metrics.play_count)} collection={tracks}
						showArtist={false} sound={mine?.byTrackId.get(track.id)} />
				{/each}
			</ol>
			<LoadMore cursor={shown < tracks.length} label="tracks" load={() => { shown += 25; }} />
		{:else}
			<p class="state">no tracks yet.</p>
		{/if}
	</section>
{/if}

<style>
	.hero { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem 1.4rem; }
	.big { margin: 0; font-size: clamp(4.25rem, 9vw, 6.9rem); font-weight: 800; line-height: 0.85; letter-spacing: -0.05em; font-variant-numeric: tabular-nums; }
	.what { margin: 0; font-size: clamp(1.25rem, 2.2vw, 1.65rem); font-weight: 700; }
	.sub { margin: 0.1rem 0 0; color: var(--muted); font-size: var(--t-16-8); }
	.insight { margin: 1.25rem 0 0; max-width: 45rem; font-size: clamp(1.2rem, 1.8vw, 1.35rem); line-height: 1.45; }
	.insight b { color: var(--accent); }
	.figures { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.4rem 2.1rem; margin: 1.6rem 0 0; }
	.figures div { display: flex; align-items: baseline; gap: 0.35rem; }
	.figures dd { margin: 0; font-size: 1.4rem; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
	.figures dt { color: var(--faint); font-size: var(--t-16); }
	.figures .aside dt { font-size: var(--t-14); }
	.block { margin-top: 3.5rem; }
	.section-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 0.25rem 1rem; padding-bottom: 0.6rem; border-bottom: 2px solid var(--text); }
	.section-head h2 { font-size: 1.45rem; letter-spacing: -0.02em; }
	.section-head span { color: var(--faint); font-size: var(--t-13-6); }
	.section-head a { color: var(--accent); }
	.fits { list-style: none; margin: 0; padding: 0; }
	.fits li { display: grid; grid-template-columns: minmax(12rem, 18rem) minmax(0, 1fr) 14rem; gap: 1.25rem; align-items: center; padding-block: 0.7rem; border-bottom: 1px solid var(--line); }
	.sound { display: grid; min-width: 0; }
	.sound b { font-size: var(--t-15-5); }
	.sound span { color: var(--faint); font-size: var(--t-13-6); }
	.meter { display: block; height: 6px; background: color-mix(in srgb, var(--text) 8%, transparent); }
	.meter i { display: block; height: 100%; background: var(--accent); }
	.standing { color: var(--muted); font-size: var(--t-14); }
	.standing.lead { color: var(--accent); font-weight: 700; }
	.note { color: var(--faint); font-size: var(--t-13-6); margin: 0.75rem 0 0; }
	.list { list-style: none; margin: 0; padding: 0; }
	.list > :global(li) { border-bottom: 1px solid var(--line); }
	@media (max-width: 720px) {
		.figures { gap: 0.3rem 1.4rem; }
		.figures dd { font-size: 1.2rem; }
		.figures dt { font-size: var(--t-14); }
		.fits li { grid-template-columns: minmax(0, 1fr); gap: 0.4rem; }
		.standing { font-size: var(--t-13-6); }
		.block { margin-top: 2.5rem; }
	}
</style>
