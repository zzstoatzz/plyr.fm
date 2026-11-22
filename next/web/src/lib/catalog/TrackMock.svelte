<script lang="ts">
	// MOCKUP ONLY (never merged): three layouts for a fuller track page, picked by localStorage plyr-mock:track.
	import { resolve } from '$app/paths';
	import type { Artist, ArtistMetrics, Track, TrackComment } from '@plyr/next-core/api';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { parseChapters, clock } from '@plyr/next-core/chapters';
	import { canToggleTrack } from '@plyr/next-core/track-revision';
	import { api } from '$lib/api';
	import { player } from '$lib/player.svelte';
	import { artistName } from '$lib/tracks';
	import { compactCount, postedAt } from '$lib/listening/format';
	import TrackCollections from '$lib/collections/TrackCollections.svelte';
	import TrackRow from '$lib/TrackRow.svelte';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import ImmersiveWash from '$lib/ui/ImmersiveWash.svelte';
	import LikeButton from '$lib/listening/LikeButton.svelte';

	let { track, variant }: { track: Track; variant: 'a' | 'b' | 'c' | 'd' } = $props();
	const active = $derived(!player.liveStation && canToggleTrack(player.current, track, !!player.jam));
	const chapterList = $derived(parseChapters(track.metadata.description ?? '', track.metadata.duration_seconds ?? undefined));
	let artist = $state.raw<Artist>();
	let metrics = $state.raw<ArtistMetrics>();
	let more = $state.raw<Track[]>([]);
	let similar = $state.raw<Track[]>([]);
	let likers = $state.raw<{ did: string; name: string; avatar: string | null }[]>([]);
	let comments = $state.raw<TrackComment[]>([]);
	let notesOpen = $state(false);
	$effect(() => {
		const did = track.artist.did;
		void api.artist(did).then(a => { artist = a; }, () => {});
		void api.artistMetrics(did).then(m => { metrics = m; }, () => {});
		void api.tracks({ artist_did: did, limit: 8 }).then(p => { more = p.data.filter(t => t.id !== track.id).slice(0, 5); }, () => {});
		void api.suggestions([track.record.uri], { limit: 5 }).then(p => { similar = p.data; }, () => {});
		void api.trackLikes(track.id).then(p => { likers = p.data.map(l => ({ did: l.actor.did, name: l.actor.profile?.display_name ?? '', avatar: l.actor.profile?.avatar_url ?? null })); }, () => {});
		void api.trackComments(track.id).then(p => { comments = p.comments_enabled ? p.data : []; }, () => {});
	});
	const posted = $derived(postedAt(track.metadata.created_at));
</script>

{#snippet transport()}
	<button class="primary-button" type="button" aria-label={active && player.playing ? 'Pause' : 'Play'} onclick={() => active ? player.toggle() : player.play(track)}><Icon name={active && player.playing ? 'pause' : 'play'} size={25} /></button>
	<button class="icon-button" type="button" aria-label="Add to queue" onclick={() => player.enqueue(track)}><Icon name="queue" /></button>
{/snippet}

{#snippet stats(info: boolean)}
	<div class="stats">
		<span>{compactCount(track.metrics.play_count)} listens</span>
		<span aria-hidden="true">·</span>
		<span>{clock(track.metadata.duration_seconds ?? 0)}</span>
		<span aria-hidden="true">·</span>
		<time>{posted}</time>
		{#if info && track.metadata.description}
			<button class="info" class:open={notesOpen} type="button" aria-label="Show details" onclick={() => { notesOpen = !notesOpen; }}><span aria-hidden="true">i</span></button>
		{/if}
	</div>
{/snippet}

{#snippet tags()}
	{#if track.metadata.tags?.length}
		<nav class="tags" aria-label="Tags">{#each track.metadata.tags as tag (tag)}<a href={resolve(`/?${new URLSearchParams({ tag })}`)}>{tag}</a>{/each}</nav>
	{/if}
{/snippet}

{#snippet utility()}
	<div class="utility">
		<button class="icon-button" type="button" aria-label="Share track"><Icon name="share" size={20} /></button>
		<button class="icon-button" type="button" aria-label="Report this track"><Icon name="ph_flag" size={19} /></button>
	</div>
{/snippet}

{#snippet likedBy()}
	{#if likers.length}
		<div class="liked">
			<span class="faces">{#each likers.slice(0, 5) as l (l.did)}<img src={l.avatar} alt="" />{/each}</span>
			<span>liked by <b>{likers[0].name}</b>{#if likers.length > 1}{" "}and {likers.length - 1} {likers.length === 2 ? 'other' : 'others'}{/if}</span>
		</div>
	{/if}
{/snippet}

{#snippet notes()}
	{#if track.metadata.description}
		<section class="block notes">
			<header><h2>notes</h2></header>
			{#if chapterList.prose}<p class="prose">{chapterList.prose}</p>{/if}
			{#if chapterList.chapters.length}
				<ol class="chapters">{#each chapterList.chapters as c (c.start)}<li><button class="text-button" type="button"><span>{clock(c.start)}</span>{c.artist ? c.artist + ' — ' : ''}{c.title}</button></li>{/each}</ol>
			{/if}
		</section>
	{/if}
{/snippet}

{#snippet commentList()}
	{#if comments.length}
		<section class="block comments">
			<header><h2>comments</h2><span>{comments.length}</span></header>
			<ul>
				{#each comments as c (c.record.uri)}
					<li>
						<img src={c.author.avatar_url} alt="" />
						<div><p><b>{c.author.display_name}</b> <button class="at" type="button">{clock(c.timestamp_ms / 1000)}</button></p><p>{c.text}</p></div>
					</li>
				{/each}
			</ul>
			<div class="compose">add a comment at {clock(42)}…</div>
		</section>
	{/if}
{/snippet}

{#snippet artistCard()}
	<section class="artist-card">
		<a class="who" href={resolve('/(app)/u/[actor]', { actor: track.artist.did })}>
			<img src={artist?.avatar_url ?? track.artist.profile?.avatar_url} alt="" />
			<span><b>{artistName(track)}</b><small>@{track.artist.profile?.handle}</small></span>
		</a>
		{#if artist?.bio}<p>{artist.bio}</p>{/if}
		{#if metrics}<small class="totals">{metrics.totals.tracks} tracks · {compactCount(metrics.totals.plays)} plays</small>{/if}
		{#if artist?.support_url}<a class="support" href={artist.support_url}><Icon name="heart" size={16} /> support {artistName(track)}</a>{/if}
	</section>
{/snippet}

{#snippet rowList(title: string, list: Track[], aside?: string)}
	{#if list.length}
		<section class="block list">
			<header><h2>{title}</h2>{#if aside}<a href={resolve('/(app)/u/[actor]', { actor: track.artist.did })}>{aside}</a>{/if}</header>
			<div>{#each list as t (t.id)}<TrackRow track={t} />{/each}</div>
		</section>
	{/if}
{/snippet}

{#snippet shelf(title: string, list: Track[])}
	{#if list.length}
		<section class="block shelf">
			<header><h2>{title}</h2></header>
			<div class="cards">
				{#each list as t (t.id)}
					<a class="card" href="/track/{t.id}"><Artwork src={trackArtwork(t)} /><b class="truncate">{t.metadata.title}</b><small class="truncate">{artistName(t)}</small></a>
				{/each}
			</div>
		</section>
	{/if}
{/snippet}

<header class="mobile-header"><a href={resolve('/')}><span aria-hidden="true">✻</span> plyr.fm</a><span class="icon-button"><Icon name="search" /></span></header>

{#if variant === 'a'}
	<div class="page-content page a">
		<div class="main">
			<section class="head">
				<div class="cover"><Artwork src={trackArtwork(track)} size={392} eager /></div>
				<div class="meta">
					<h1>{track.metadata.title}</h1>
					<div class="credits"><a href={resolve('/(app)/u/[actor]', { actor: track.artist.did })}>{artistName(track)}</a></div>
					{@render stats(false)}
					<TrackCollections {track} {transport} />
					{@render tags()}
				</div>
			</section>
			{@render likedBy()}
			{@render notes()}
			{@render commentList()}
			{@render rowList('sounds like this', similar)}
		</div>
		<aside class="rail">
			{@render artistCard()}
			{@render rowList(`more from ${artistName(track)}`, more, 'all')}
			{@render utility()}
		</aside>
	</div>
{:else if variant === 'b'}
	<div class="page-content page b">
		<section class="band">
			<div class="glow" aria-hidden="true"><Artwork src={trackArtwork(track)} /></div>
			<div class="cover"><Artwork src={trackArtwork(track)} size={392} eager /></div>
			<div class="meta">
				<h1>{track.metadata.title}</h1>
				<div class="credits"><a href={resolve('/(app)/u/[actor]', { actor: track.artist.did })}>{artistName(track)}</a></div>
				{@render stats(false)}
				<TrackCollections {track} {transport} />
			</div>
		</section>
		<div class="split">
			<div class="col">
				{@render tags()}
				{@render likedBy()}
				{@render notes()}
				{@render commentList()}
			</div>
			<div class="col">
				{@render rowList(`more from ${artistName(track)}`, more, 'all')}
				{@render rowList('sounds like this', similar)}
				{@render utility()}
			</div>
		</div>
	</div>
{:else if variant === 'd'}
	<article class="page-content page d">
		<ImmersiveWash src={trackArtwork(track) ?? ''} />
		<header>
			<div class="cover"><Artwork src={trackArtwork(track)} size={392} eager /></div>
			<div class="copy">
				<p class="kind">track</p>
				<h1>{track.metadata.title}</h1>
				<div class="meta">
					<a class="owner" href={resolve('/(app)/u/[actor]', { actor: track.artist.did })}><img src={artist?.avatar_url ?? track.artist.profile?.avatar_url} alt="" />{artistName(track)}</a>
					<span class="hero-chip"><b>{compactCount(track.metrics.play_count)}</b> listens</span>
					<span class="hero-chip"><b>{clock(track.metadata.duration_seconds ?? 0)}</b></span>
					<span class="hero-chip">{posted}</span>
				</div>
				<div class="hero-actions">
					<button type="button" class="hero-pill primary" onclick={() => active ? player.toggle() : player.play(track)}><Icon name={active && player.playing ? 'pause' : 'play'} size={18} />{active && player.playing ? 'pause' : 'play'}</button>
					<button type="button" class="hero-round" aria-label="Add to queue" onclick={() => player.enqueue(track)}><Icon name="queue" /></button>
					<span class="hero-round like"><LikeButton {track} count={false} /></span>
					<button type="button" class="hero-round" aria-label="Add to playlist"><Icon name="playlist_add" /></button>
					<button type="button" class="hero-round" aria-label="Share track"><Icon name="share" /></button>
				</div>
				{@render tags()}
				{@render likedBy()}
			</div>
		</header>
		<div class="body">
			{@render notes()}
			{@render commentList()}
			{@render rowList(`more from ${artistName(track)}`, more, 'all')}
			{@render rowList('sounds like this', similar)}
			{@render artistCard()}
		</div>
	</article>
{:else}
	<div class="page-content page c">
		<article class="center">
			<div class="cover"><Artwork src={trackArtwork(track)} size={392} eager /></div>
			<h1>{track.metadata.title}</h1>
			<div class="credits"><a href={resolve('/(app)/u/[actor]', { actor: track.artist.did })}>{artistName(track)}</a></div>
			<TrackCollections {track} {transport} />
			{@render tags()}
			{@render stats(true)}
			{#if notesOpen}{@render notes()}{/if}
			{@render likedBy()}
			{@render utility()}
		</article>
		<div class="below">
			{@render shelf(`more from ${artistName(track)}`, more)}
			{@render shelf('sounds like this', similar)}
			{@render commentList()}
		</div>
	</div>
{/if}

<style>
	.mobile-header { display: none; }
	@media (max-width: 720px) { .mobile-header { padding: 0.35rem 0.85rem; display: flex; align-items: center; justify-content: space-between; font-weight: 700; border-bottom: 1px solid var(--line); background: var(--surface); } .mobile-header span { color: var(--accent); } }
	h1 { line-height: 1.1; letter-spacing: -0.035em; overflow-wrap: anywhere; }
	h2 { font-size: var(--t-16-8); }
	.credits { color: var(--muted); font-size: var(--t-16-8); }
	.credits a:hover { text-decoration: underline; }
	.stats { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; color: var(--faint); font-size: var(--t-14); font-variant-numeric: tabular-nums; }
	.info { display: inline-grid; place-items: center; width: 2.75rem; height: 2.75rem; margin: -0.8rem -0.6rem; padding: 0; border: 0; background: none; cursor: pointer; }
	.info span { display: grid; place-items: center; width: 1.15rem; height: 1.15rem; border: 1px solid var(--faint); border-radius: 50%; color: var(--faint); font-weight: 600; font-size: var(--t-10-5); line-height: 1; }
	.info:hover span, .info.open span { color: var(--accent); border-color: var(--accent); }
	.tags { display: flex; flex-wrap: wrap; gap: 0.4rem; }
	.tags a { display: grid; align-items: center; min-height: 2.25rem; padding-inline: 0.65rem; border-radius: 0.6rem; color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--surface)); font-size: var(--t-13-6); font-weight: 650; }
	.utility { display: flex; gap: 0.25rem; color: var(--muted); }
	.liked { display: flex; align-items: center; gap: 0.6rem; color: var(--muted); font-size: var(--t-14); }
	.liked b { color: var(--text); font-weight: 650; }
	.faces { display: flex; }
	.faces img { width: 1.75rem; height: 1.75rem; border-radius: 50%; border: 2px solid var(--bg, var(--surface)); object-fit: cover; margin-left: -0.45rem; }
	.faces img:first-child { margin-left: 0; }
	.block header { display: flex; justify-content: space-between; align-items: baseline; gap: 0.65rem; padding-bottom: 0.65rem; }
	.block header span, .block header a { color: var(--muted); font-size: var(--t-12-8); }
	.prose { margin: 0; white-space: pre-wrap; color: var(--muted); line-height: 1.6; max-width: 42rem; }
	.chapters { list-style: none; margin: 0.5rem 0 0; padding: 0; }
	.chapters button { display: flex; gap: 0.75rem; width: 100%; min-height: 2.5rem; padding-inline: 0.5rem; margin-inline: -0.5rem; text-align: start; border-radius: 0.5rem; }
	.chapters button span { color: var(--accent); font-variant-numeric: tabular-nums; min-width: 2.6rem; }
	.comments ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.9rem; }
	.comments li { display: grid; grid-template-columns: 2.25rem minmax(0, 1fr); gap: 0.7rem; }
	.comments li img { width: 2.25rem; height: 2.25rem; border-radius: 50%; object-fit: cover; }
	.comments p { margin: 0; line-height: 1.45; }
	.comments p:last-child { color: var(--muted); }
	.at { padding: 0.05rem 0.4rem; border: 0; border-radius: 0.4rem; background: color-mix(in srgb, var(--accent) 12%, var(--surface)); color: var(--accent); font-size: var(--t-12); font-variant-numeric: tabular-nums; font-weight: 650; }
	.compose { margin-top: 0.9rem; padding: 0.75rem 0.9rem; border: 1px solid var(--line); border-radius: 0.75rem; color: var(--faint); font-size: var(--t-14); }
	.artist-card { display: grid; gap: 0.7rem; padding: 1.1rem; border: 1px solid var(--line); border-radius: 1.15rem; background: var(--surface); }
	.who { display: flex; align-items: center; gap: 0.75rem; }
	.who img { width: 3.25rem; height: 3.25rem; border-radius: 50%; object-fit: cover; }
	.who span { display: grid; }
	.who small, .totals { color: var(--muted); font-size: var(--t-12-8); }
	.artist-card p { margin: 0; color: var(--muted); font-size: var(--t-14); line-height: 1.5; }
	.support { display: inline-flex; align-items: center; justify-content: center; gap: 0.45rem; height: 2.75rem; border: 1.5px solid var(--accent); border-radius: 999px; color: var(--accent); font-weight: 700; }
	@media (min-width: 521px) { .list :global(.track) { grid-template-columns: 2.75rem minmax(0, 1fr) auto 3rem; min-height: 3.9rem; } }
	.primary-button { width: 3.5rem; height: 3.5rem; }
	.cover { border-radius: 0.65rem; overflow: hidden; }

	/* A: one column beside a rail, like home */
	.a { max-width: 118rem; display: grid; grid-template-columns: minmax(0, 1fr) clamp(19rem, 25%, 25rem); column-gap: 2.75rem; align-items: start; }
	.a .main, .a .rail { display: grid; gap: 2rem; min-width: 0; }
	.a .head { display: grid; grid-template-columns: clamp(13rem, 22vw, 17.5rem) minmax(0, 1fr); gap: 2rem; align-items: end; }
	.a .meta { display: grid; justify-items: start; gap: 0.55rem; }
	.a .meta h1 { font-size: clamp(2rem, 3.6vw, 3.25rem); }
	.a .meta :global(.actions) { justify-content: flex-start; }
	.a .rail .list :global(.metrics), .a .rail .list :global(.row-actions) { display: none; }
	.a .rail .list :global(.track) { grid-template-columns: 2.5rem minmax(0, 1fr) 3rem; min-height: 3.6rem; }

	/* B: a cover-lit band across the top, two columns under it */
	.b { max-width: 118rem; display: grid; gap: 2rem; }
	.band { position: relative; isolation: isolate; overflow: hidden; display: grid; grid-template-columns: clamp(12rem, 20vw, 16rem) minmax(0, 1fr); gap: 2rem; align-items: end; padding: clamp(1.25rem, 2.5vw, 2rem); border: 1px solid var(--line); border-radius: 1.15rem; background: var(--surface); }
	.glow { position: absolute; inset: -30%; z-index: -1; filter: blur(60px) saturate(1.3); opacity: 0.45; }
	.glow :global(.artwork) { width: 100%; height: 100%; }
	.b .meta { display: grid; justify-items: start; gap: 0.55rem; }
	.b .meta h1 { font-size: clamp(2rem, 3.6vw, 3.25rem); }
	.b .meta :global(.actions) { justify-content: flex-start; }
	.split { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 2.75rem; align-items: start; }
	.col { display: grid; gap: 1.75rem; min-width: 0; }

	/* D: the album/artist page layout: art wash, sticky left column, rows on the right */
	.d { position: relative; isolation: isolate; max-width: none; display: grid; gap: 2rem; }
	.d > header { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 1.1rem; }
	.d .cover { width: min(13rem, 56vw); }
	.d .copy { display: grid; gap: 0.75rem; width: 100%; justify-items: center; }
	.d .kind { margin: 0; color: var(--muted); font-size: var(--t-12-8); font-weight: 650; display: none; }
	.d h1 { font-size: clamp(1.65rem, 3vw, 2.5rem); }
	.d .meta { display: flex; flex-wrap: wrap; gap: 0.45rem; align-items: center; justify-content: center; }
	.d .owner { display: inline-flex; align-items: center; gap: 0.45rem; font-weight: 650; flex-basis: 100%; justify-content: center; }
	.d .owner img { width: 1.4rem; height: 1.4rem; border-radius: 50%; object-fit: cover; }
	.d .hero-actions { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto auto; gap: 0.5rem; width: 100%; max-width: 24rem; }
	.d .like { padding: 0; }
	.d .like :global(button) { width: 100%; height: 100%; }
	.d .tags, .d .liked { justify-content: center; }
	.d .body { display: grid; gap: 2rem; min-width: 0; }
	@media (min-width: 1100px) {
		.d { grid-template-columns: clamp(19rem, 24%, 24rem) minmax(0, 1fr); column-gap: 3rem; align-items: start; }
		.d > header { align-items: start; text-align: start; gap: 1.5rem; padding-top: 1rem; }
		@media (min-height: 760px) { .d > header { position: sticky; top: clamp(1rem, 3vw, 2.25rem); } }
		.d .cover { width: 100%; max-width: 16rem; }
		.d .copy { justify-items: start; }
		.d .kind { display: block; }
		.d .meta, .d .tags, .d .liked { justify-content: flex-start; }
		.d .owner { flex-basis: auto; justify-content: flex-start; margin-right: 0.3rem; }
		.d .body { padding-top: 1rem; }
	}
	@media (min-width: 1240px) {
		.d .list :global(.track) { min-height: 4rem; }
		.d .list :global(.name) { grid-template-columns: minmax(0, 1fr) auto; column-gap: 2rem; align-items: center; }
		.d .list :global(.name > a) { grid-column: 1; }
		.d .list :global(.metrics) { grid-column: 2; grid-row: 1 / 3; display: grid; grid-template-columns: 3.25rem 3.25rem 4.5rem; gap: 0.5rem; font-size: var(--t-12-8); }
	}

	/* C: today's centred stack, filled out below with shelves */
	.c { display: grid; gap: 2.5rem; }
	.center { display: grid; justify-items: center; text-align: center; gap: 0.6rem; padding-top: clamp(1rem, 4vw, 2.5rem); }
	.center .cover { width: min(20rem, 100%); }
	.center h1 { font-size: clamp(1.65rem, 4vw, 2.7rem); margin-top: 0.5rem; }
	.center .stats, .center .tags { justify-content: center; }
	.center .notes { text-align: start; max-width: 40rem; width: 100%; border-top: 1px solid var(--line); padding-top: 0.85rem; }
	.center .notes header { display: none; }
	.below { display: grid; gap: 2rem; max-width: 64rem; width: 100%; margin: 0 auto; }
	.cards { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 1rem; }
	.card { display: grid; gap: 0.35rem; min-width: 0; }
	.card :global(.artwork) { border-radius: 0.6rem; margin-bottom: 0.25rem; }
	.card small { color: var(--muted); font-size: var(--t-12-8); }

	@media (max-width: 900px) {
		.a, .split { grid-template-columns: minmax(0, 1fr); row-gap: 2rem; }
		.a .head, .band { grid-template-columns: minmax(0, 1fr); justify-items: center; text-align: center; gap: 1rem; }
		.a .head .cover, .band .cover { width: min(13rem, 60vw); }
		.a .meta, .b .meta { justify-items: center; }
		.a .meta :global(.actions), .b .meta :global(.actions), .a .stats, .b .stats { justify-content: center; }
		.a .head .tags { justify-content: center; }
		.a .liked, .b .band + .split .liked { justify-content: center; }
		.cards { grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: 8.5rem; overflow-x: auto; scrollbar-width: none; }
		.center .cover { width: min(13rem, 60vw); }
	}
</style>
