<script lang="ts">
	/** One artist's stats, built from the same pieces as everyone's: their plays against plyr.fm's,
	 *  where they sit in each sound, and every track ranked. All time: dated plays per artist come later. */
	import { resolve } from '$app/paths';
	import type { Artist, ArtistMetrics, Track } from '@plyr/next-core/api';
	import { api } from '$lib/api';
	import { loadAtlas } from '@plyr/next-core/atlas/load';
	import type { AtlasData } from '@plyr/next-core/atlas/types';
	import ImmersiveWash from '$lib/ui/ImmersiveWash.svelte';
	import LoadMore from '$lib/ui/LoadMore.svelte';
	import Loading from '$lib/ui/Loading.svelte';
	import RankedTrack from './RankedTrack.svelte';
	import { catalogDuration } from './duration';
	import { artistSounds } from './sounds';

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
		<div class="headline">
			<p class="big">{plays.toLocaleString()}</p>
			<div class="line">
				<span class="what">plays all time</span>
				{#if rank && totals}<span class="chip-strong">#{rank} of {totals.artists.toLocaleString()} artists</span>{/if}
				{#if everyone?.plays && plays}<span class="chip-strong">{pct(plays / everyone.plays)} of every play on plyr.fm</span>{/if}
			</div>
			<p class="insight">
				{#if mine?.sounds.length && plays}
					Most of {name}’s plays are <b>{mine.sounds[0].label}</b>, where they’re {pct(mine.sounds[0].share)} of everything played.
				{/if}
				{#if top && top.metrics.play_count}<b>{top.metadata.title}</b> is their most played track.{/if}
			</p>
		</div>
		<dl class="tiles">
			<div><dt>{metrics.totals.tracks === 1 ? 'track' : 'tracks'}</dt><dd>{metrics.totals.tracks.toLocaleString()}</dd></div>
			<div><dt>of audio</dt><dd>{catalogDuration(metrics.totals.duration_seconds)}</dd></div>
			<div><dt>likes</dt><dd>{(likes ?? 0).toLocaleString()}</dd></div>
			<div><dt>plays per track</dt><dd>{Math.round(perTrack).toLocaleString()}</dd>
				{#if average && perTrack >= average * 1.5}<small>{Math.round(perTrack / average)}× the plyr.fm average</small>{/if}</div>
		</dl>
	</section>

	{#if mine?.sounds.length}
		<section class="block" aria-labelledby="artist-sounds-title">
			<div class="section-head"><h2 id="artist-sounds-title">how {name} sounds</h2><span>their plays in each sound, against everyone’s</span></div>
			<ol class="shares">
				{#each mine.sounds as sound (sound.id)}
					<li>
						<div class="sound"><b class="truncate">{sound.label}</b><span>{sound.tracks} {sound.tracks === 1 ? 'track' : 'tracks'} · {sound.plays.toLocaleString()} plays</span></div>
						<span class="meter" role="img" aria-label={`${pct(sound.share)} of the sound’s plays`}><i style:width="{Math.max(1, sound.share * 100)}%"></i></span>
						<span class="share"><b>{pct(sound.share)}</b> of the sound’s {sound.soundPlays.toLocaleString()} plays</span>
					</li>
				{/each}
			</ol>
			{#if mine.mapped < tracks.length}
				<p class="note">{(tracks.length - mine.mapped).toLocaleString()} of {name}’s {tracks.length.toLocaleString()} tracks {tracks.length - mine.mapped === 1 ? 'isn’t' : 'aren’t'} on the sound map yet.</p>
			{/if}
		</section>
	{/if}

	<section class="block" aria-labelledby="artist-tracks-title">
		<div class="section-head"><h2 id="artist-tracks-title">tracks</h2><span>{tracks.length.toLocaleString()} {tracks.length === 1 ? 'track' : 'tracks'} · by plays</span></div>
		{#if tracks.length}
			<ol class="list">
				{#each tracks.slice(0, shown) as track, index (track.id)}
					<RankedTrack {track} rank={index + 1} plays={track.metrics.play_count} max={Math.max(1, tracks[0].metrics.play_count)} collection={tracks}
						showArtist={false} sound={track.legacy_id ? mine?.byLegacyId.get(track.legacy_id) : undefined} />
				{/each}
			</ol>
			<LoadMore cursor={shown < tracks.length} label="tracks" load={() => { shown += 25; }} />
		{:else}
			<p class="state">no tracks yet.</p>
		{/if}
	</section>
{/if}

<style>
	.hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 30rem); gap: 1.5rem 2.5rem; align-items: end; }
	.big { margin: 0; font-size: clamp(4.25rem, 9vw, 6.5rem); font-weight: 800; line-height: 0.9; letter-spacing: -0.045em; font-variant-numeric: tabular-nums; }
	.line { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.7rem; margin-top: 0.6rem; }
	.what { font-size: clamp(1.2rem, 2.2vw, 1.65rem); font-weight: 700; margin-right: 0.2rem; }
	.chip-strong { padding: 0.25rem 0.7rem; border-radius: 999px; font-size: var(--t-14); font-weight: 700; background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
	.insight { margin: 1.3rem 0 0; max-width: 40rem; font-size: clamp(1.2rem, 1.8vw, 1.35rem); line-height: 1.4; }
	.insight b { color: var(--accent); }
	.tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.6rem; margin: 0; }
	.tiles div { display: flex; flex-direction: column; padding: 0.8rem 1rem; border-radius: 1rem; border: 1px solid var(--line); background: color-mix(in srgb, var(--surface) 70%, transparent); min-width: 0; }
	.tiles dd { order: -1; margin: 0; font-size: 1.6rem; font-weight: 700; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
	.tiles dt { color: var(--faint); font-size: var(--t-13-6); }
	.tiles small { color: var(--accent); font-size: var(--t-12-8); margin-top: 0.2rem; }
	.block { margin-top: 3rem; }
	.section-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 0.25rem 1rem; margin-bottom: 0.75rem; }
	.section-head h2 { font-size: 1.35rem; }
	.section-head span { color: var(--faint); font-size: var(--t-13-6); }
	.shares { list-style: none; margin: 0; padding: 0; }
	.shares li { display: grid; grid-template-columns: minmax(12rem, 18rem) minmax(0, 1fr) 14rem; gap: 1.25rem; align-items: center; padding-block: 0.75rem; border-top: 1px solid var(--line); }
	.sound { display: grid; min-width: 0; }
	.sound b { font-size: var(--t-15-5); }
	.sound span { color: var(--faint); font-size: var(--t-13-6); }
	.meter { display: block; height: 12px; border-radius: 6px; background: color-mix(in srgb, var(--text) 8%, transparent); overflow: hidden; }
	.meter i { display: block; height: 100%; border-radius: 6px; background: var(--accent); }
	.share { color: var(--faint); font-size: var(--t-14); }
	.share b { color: var(--accent); font-size: var(--t-18); }
	.note { color: var(--faint); font-size: var(--t-13-6); margin: 0.6rem 0 0; padding-top: 0.6rem; border-top: 1px solid var(--line); }
	.list { list-style: none; margin: 0; padding: 0; }
	@media (max-width: 1100px) { .hero { grid-template-columns: minmax(0, 1fr); } }
	@media (max-width: 720px) {
		.shares li { grid-template-columns: minmax(0, 1fr); gap: 0.4rem; }
		.share { font-size: var(--t-13-6); }
		.share b { font-size: var(--t-15); }
		.tiles dd { font-size: 1.35rem; }
	}
</style>
