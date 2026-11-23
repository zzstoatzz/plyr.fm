<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import TrackCollections from '$lib/collections/TrackCollections.svelte';
	import type { Track } from '@plyr/next-core/api';
	import type { Snippet } from 'svelte';
	import { accessLabel } from '@plyr/next-core/access/label';
	import { authConfig } from '$lib/auth-config';
	import { isPrivateTrack } from '@plyr/next-core/track-access';
	import { showsPause, tracksContext } from '@plyr/next-core/play-context';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { albums, sellers } from '$lib/track-extras';
	import { comments as trackComments } from '$lib/listening/comments';
	import { parseChapters, clock } from '@plyr/next-core/chapters';
	import { player } from '$lib/player.svelte';
	import { contextState, pressContext } from '$lib/play-control.svelte';
	import { artistName, trackHref } from '$lib/tracks';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Loading from '$lib/ui/Loading.svelte';
	import TrackRow from '$lib/TrackRow.svelte';
	import { api } from '$lib/api';
	import { likes } from '$lib/listening/likes';
	import { compactCount, postedAt } from '$lib/listening/format';
	import WaysIn from '$lib/access/WaysIn.svelte';
	import ReportSheet from '$lib/moderation/ReportSheet.svelte';
	import { auth } from '$lib/auth';
	import { onMount, tick, untrack } from 'svelte';
	import { isOpen } from '@plyr/next-core/access/policy';
	import { offerFor, offerLabel, supportLink } from '@plyr/next-core/selling';
	import type { Artist } from '@plyr/next-core/api';
	let { track, ownerActions, playTrack = player.play.bind(player) }: { track: Track; ownerActions?: Snippet; playTrack?: (track: Track) => void } = $props();
	const context = $derived(tracksContext([track]));
	const playState = $derived(contextState(context));
	const active = $derived(playState !== 'idle');
	const pause = $derived(showsPause(playState));
	const canDiscuss = $derived(!isPrivateTrack(track));
	let sharedTrack = $state<string>();
	let account = $state.raw(auth.getAuth());
	onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
	const reportable = $derived(!!account.agent && account.did !== track.artist.did);
	let reporting = $state(false);
	let reporter = $state<ReportSheet>();
	let reportButton = $state<HTMLButtonElement>();
	let commentsEnabled = $state(false);
	// Only artists who turned comments on get a comments button. A failed read keeps it, so the panel can retry.
	$effect(() => {
		if (!canDiscuss) return;
		const id = track.id;
		const update = () => { const { enabled, error } = trackComments.snapshot(id); commentsEnabled = enabled || error; };
		const unsubscribe = trackComments.subscribe(id, update);
		update();
		if (!trackComments.hasLoaded(id)) trackComments.loadComments(id);
		return unsubscribe;
	});
	// the rest of the page: who liked it, more from the artist, and what sounds like it
	let related = $state.raw<{ id: string; more: Track[]; similar: Track[] }>();
	// who liked it comes from the shared like state, so liking here shows up at once
	let likedBy = $state.raw(untrack(() => likes.likers(track)));
	let likeCount = $state(untrack(() => likes.snapshot(track).count));
	$effect(() => {
		if (!canDiscuss) return;
		const current = track;
		const read = () => { likedBy = likes.likers(current); likeCount = likes.snapshot(current).count; };
		read();
		void likes.loadLikers(current);
		return likes.subscribe(read);
	});
	$effect(() => {
		if (!canDiscuss) return;
		const { id, artist, record } = track;
		const request = new AbortController();
		let live = true;
		const settle = <T,>(work: Promise<T>, fallback: T) => work.catch(() => fallback);
		void Promise.all([
			settle(api.tracks({ artist_did: artist.did, limit: 7 }, request.signal).then(page => page.data.filter(other => other.id !== id).slice(0, 5)), []),
			settle(api.suggestions([record.uri], { limit: 10, signal: request.signal }).then(page => page.data), [])
		]).then(([more, similar]) => {
			// "sounds like this" skips what "more from" already shows
			const shownAbove = new Set(more.map(other => other.id));
			if (live) related = { id, more, similar: similar.filter(other => other.id !== id && !shownAbove.has(other.id)).slice(0, 5) };
		});
		return () => { live = false; request.abort(); };
	});
	const shown = $derived(related?.id === track.id ? related : undefined);
	let openedAt: string | undefined;
	let album = $state.raw<{ trackId: string; id: string; uri: string }>();
	let seller = $state.raw<{ did: string; artist: Artist }>();
	$effect(() => {
		const did = track.artist.did;
		let live = true;
		void sellers.load(did).then(artist => { if (live) seller = { did, artist }; }, () => {});
		return () => { live = false; };
	});
	const sellerArtist = $derived(seller?.did === track.artist.did ? seller.artist : sellers.peek(track.artist.did));
	const offer = $derived(offerFor(sellerArtist, [track.record.uri, album?.trackId === track.id ? album.uri : undefined]));
	const support = $derived(supportLink(sellerArtist));
	let waysAdmitted = $state(false);
	const closedToMe = $derived(!isPrivateTrack(track) && !isOpen(track) && !!track.access.space_uri && auth.getAuth().did !== track.artist.did);
	const chapterList = $derived(parseChapters(track.metadata.description ?? '', track.metadata.duration_seconds ?? undefined));
	$effect(() => {
		const title = track.metadata.album;
		if (!title || !canDiscuss) return;
		const { id, artist } = track;
		let live = true;
		void albums.load(`${artist.did} ${title}`).then(found => { if (live) album = found ? { trackId: id, ...found } : undefined; }, () => {});
		return () => { live = false; };
	});

	function play() {
		const timestamp = page.url.searchParams.get('t');
		const address = page.url.href;
		if (canDiscuss && !pause && address !== openedAt && timestamp && /^\d{1,8}$/.test(timestamp) && player.canPlayFrom(track)) {
			openedAt = address;
			playFrom(Number(timestamp));
		} else pressContext(context, () => playTrack(track));
	}

	function playFrom(seconds: number) {
		player.playFrom(track, seconds);
	}

	async function share(seconds?: number) {
		const url = new URL(trackHref(track), location.origin);
		if (seconds !== undefined) url.searchParams.set('t', String(Math.floor(seconds)));
		try {
			if (navigator.share) await navigator.share({ title: track.metadata.title, url: url.href });
			else {
				const id = track.id;
				await navigator.clipboard.writeText(url.href);
				sharedTrack = id;
			}
		} catch {}
	}
</script>

<svelte:head><title>{track.metadata.title} · plyr.fm</title></svelte:head>

<header class="mobile-header">
	<a href={resolve('/')} aria-label="plyr.fm home"><span aria-hidden="true">✻</span> plyr.fm</a>
	<a class="icon-button" href={resolve('/(app)/search')} aria-label="Search"><Icon name="search" /></a>
</header>

{#snippet transport()}
	<button class="primary-button play" type="button" data-play-state={playState} aria-label={pause ? 'Pause' : 'Play'} onclick={play}><Icon name={pause ? 'pause' : 'play'} size={30} /></button>
	{#if offer && (!closedToMe || waysAdmitted)}<a class="buy" href={offer.url} target="_blank" rel="noopener noreferrer" aria-label={`Buy ${track.metadata.title}, ${offerLabel(offer)} (opens in a new tab)`}><Icon name="external" size={16} /> <span>buy · {offerLabel(offer)}</span></a>{/if}
	{#if canDiscuss}<button class="icon-button" type="button" aria-label="Add to queue" disabled={!player.canEditPublicQueue} title={!player.canEditPublicQueue ? "play a public track to change queues" : undefined} onclick={() => player.enqueue(track)}><Icon name="queue" /></button>{/if}
{/snippet}

{#key track.id}
	<article class="page-content detail">
		<section class="stage">
			<div class="cover"><Artwork src={trackArtwork(track)} size={392} eager /></div>
			<h1>{track.metadata.title}</h1>
			<div class="credits">
				<a class="artist" href={resolve('/(app)/u/[actor]', { actor: track.artist.did })}>{artistName(track)}</a>
				{#if track.metadata.album}
					<span aria-hidden="true">·</span>
					{#if album?.trackId === track.id}<a href={resolve('/(app)/album/[id]', { id: album.id })}>{track.metadata.album}</a>
					{:else}<span>{track.metadata.album}</span>{/if}
				{/if}
			</div>
			{#if canDiscuss}<TrackCollections {track} {transport} />{:else}<div class="actions">{@render transport()}</div>{/if}
			{#if closedToMe}<WaysIn {track} {offer} {support} bind:admitted={waysAdmitted} />{/if}
			{#if track.metadata.tags?.length}
				<nav class="tags" aria-label="Tags">
					{#each track.metadata.tags as tag (tag)}
						<a class="tag-pill" href={resolve(`/?${new URLSearchParams({ tag })}`)}>{tag}</a>
					{/each}
				</nav>
			{/if}
			<p class="stats">
				{#if canDiscuss}<span>{compactCount(track.metrics.play_count)} {track.metrics.play_count === 1 ? 'listen' : 'listens'}</span>{:else}<span>{accessLabel(track, authConfig.AUDIO_SPACE_TYPE)}</span>{/if}
				{#if track.metadata.duration_seconds}<span aria-hidden="true">·</span><span>{clock(track.metadata.duration_seconds)}</span>{/if}
				<span aria-hidden="true">·</span><time datetime={track.metadata.created_at}>{postedAt(track.metadata.created_at)}</time>
			</p>
			{#if canDiscuss}
				<div class="actions utilities">
					<button class="icon-button" type="button" aria-label="Share track" onclick={() => share()}><Icon name="share" size={20} /></button>
					{#if active && player.position >= 1}<button class="text-button" type="button" onclick={() => share(player.position)}>share at {clock(player.position)}</button>{/if}
					{#if reportable}<button bind:this={reportButton} class="icon-button" type="button" aria-label="Report this track" aria-haspopup="dialog" onclick={async () => { reporting = true; await tick(); reporter?.show(); }}><Icon name="ph_flag" size={19} /></button>{/if}
				</div>
				{#if reporting}<ReportSheet bind:this={reporter} subject={track.record.uri} name={track.metadata.title} owner={artistName(track)} returnTo={trackHref(track)} onclose={() => { reporting = false; reportButton?.focus(); }} />{/if}
			{:else if ownerActions}
				{@render ownerActions()}
			{/if}
			{#if sharedTrack === track.id}<p role="status">link copied</p>{/if}
			{#if active && player.error}<p class="state" role="status">{player.error}</p>{:else if active && player.preparing}<p class="state" role="status">preparing…</p>{/if}
		</section>

		{#if (canDiscuss && likedBy.people.length) || track.metadata.description || (canDiscuss && commentsEnabled)}
			<div class="column">
				{#if canDiscuss && likedBy.people.length}
					{@const first = likedBy.people[0]}
					{@const rest = Math.max(likeCount, likedBy.people.length) - 1}
					<p class="liked">
						<span class="faces" aria-hidden="true">{#each likedBy.people.slice(0, 5) as liker (liker.did)}<Artwork src={liker.profile?.avatar_url ?? undefined} size={28} />{/each}</span>
						<span>liked by <b>{first.profile?.display_name || first.profile?.handle || 'someone'}</b>{#if rest > 0}{` and ${rest} ${rest === 1 ? 'other' : 'others'}`}{/if}</span>
					</p>
				{/if}
				{#if track.metadata.description}
					<section class="block" aria-labelledby="track-notes">
						<h2 id="track-notes">notes</h2>
						{#if chapterList.prose}<p class="description">{chapterList.prose}</p>{/if}
						{#if chapterList.chapters.length}
							<ol class="chapters" aria-label="Tracklist">
								{#each chapterList.chapters as chapter (chapter.start)}
									<li>
										{#if canDiscuss}<button type="button" class="text-button" onclick={() => playFrom(chapter.start)} disabled={!player.canPlayFrom(track)}><span>{clock(chapter.start)}</span>{chapter.artist ? chapter.artist + ' — ' : ''}{chapter.title}</button>
										{:else}<span class="chapter"><span>{clock(chapter.start)}</span>{chapter.artist ? chapter.artist + ' — ' : ''}{chapter.title}</span>{/if}
									</li>
								{/each}
							</ol>
						{/if}
					</section>
				{/if}
				{#if canDiscuss && commentsEnabled}
					<section class="block comments" aria-labelledby="track-comments">
						<h2 id="track-comments">comments</h2>
						{#await import('$lib/catalog/TrackComments.svelte')}
							<Loading label="loading comments" />
						{:then component}
							<component.default {track} playFrom={player.canPlayFrom(track) ? playFrom : undefined} />
						{:catch}
							<p role="alert" class="state">could not open comments.</p>
						{/await}
					</section>
				{/if}
			</div>
		{/if}

		{#if shown && (shown.more.length || shown.similar.length)}
			<div class="related">
				{#if shown.more.length}
					<section class="block" aria-labelledby="track-more">
						<header><h2 id="track-more">more from {artistName(track)}</h2><a href={resolve('/(app)/u/[actor]', { actor: track.artist.did })}>all</a></header>
						<div>{#each shown.more as other (other.id)}<TrackRow track={other} collection={shown.more} label={`more from ${artistName(track)}`} />{/each}</div>
					</section>
				{/if}
				{#if shown.similar.length}
					<section class="block" aria-labelledby="track-similar">
						<header><h2 id="track-similar">sounds like this</h2></header>
						<div>{#each shown.similar as other (other.id)}<TrackRow track={other} collection={shown.similar} label="sounds like this" />{/each}</div>
					</section>
				{/if}
			</div>
		{/if}
	</article>
{/key}

<style>
	.mobile-header { display: none; }
	@media (max-width: 720px) { .mobile-header { padding: 0.35rem 0.85rem; display: flex; align-items: center; justify-content: space-between; font-weight: 700; border-bottom: 1px solid var(--line); background: var(--surface); } .mobile-header span { color: var(--accent); } }
	/* the iOS track page, centred over the cover's blurred art; notes and comments in a column, related tracks side by side */
	.detail { max-width: none; display: grid; gap: 2.5rem; padding-top: clamp(1rem, 4vh, 3rem); }
	.stage { display: grid; justify-items: center; text-align: center; gap: 0.6rem; }
	.cover { width: min(24rem, 42vh, 100%); border-radius: 0.65rem; overflow: hidden; box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 0.3); margin-bottom: 0.6rem; }
	h1 { font-size: clamp(1.75rem, 3.4vw, 3.1rem); line-height: 1.1; overflow-wrap: anywhere; letter-spacing: -0.04em; }
	.credits { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.35rem; font-size: var(--t-16-8); }
	.credits, .stats { color: var(--muted); }
	.credits a:hover { text-decoration: underline; }
	.actions, .tags { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0.4rem; }
	.tags { margin: 0.2rem 0; }
	.tags a { display: grid; align-items: center; min-height: 2.75rem; padding-inline: 0.65rem; max-width: 100%; overflow-wrap: anywhere; border-radius: 0.6rem; color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--surface)); font-size: var(--t-13-6); font-weight: 650; }
	@media (hover: hover) { .tags a:hover { background: color-mix(in srgb, var(--accent) 20%, var(--surface)); } }
	.play { width: 4.5rem; height: 4.5rem; margin-inline: 0.6rem; box-shadow: 0 0 2.5rem color-mix(in srgb, var(--accent) 40%, transparent); }
	.buy { display: inline-flex; align-items: center; gap: 0.45rem; height: 2.75rem; padding: 0 1.1rem; border: 1.5px solid var(--accent); border-radius: 999px; color: var(--accent); font-weight: 700; max-width: 100%; }
	.buy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.buy:hover { text-decoration: none; background: color-mix(in srgb, var(--accent) 10%, transparent); }
	.stats { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.4rem; margin: 0; font-size: var(--t-14); font-variant-numeric: tabular-nums; }
	.utilities { color: var(--muted); }
	.column { display: grid; gap: 2rem; width: min(40rem, 100%); margin: 0 auto; }
	.related { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(22rem, 100%), 1fr)); gap: 2.5rem; width: min(72rem, 100%); margin: 0 auto; align-items: start; }
	.block { display: grid; gap: 0.65rem; min-width: 0; }
	.block header { display: flex; justify-content: space-between; align-items: baseline; gap: 0.65rem; }
	.block header a { color: var(--muted); font-size: var(--t-12-8); }
	h2 { font-size: var(--t-16-8); }
	.liked { display: flex; align-items: center; justify-content: center; gap: 0.6rem; margin: 0; color: var(--muted); font-size: var(--t-14); }
	.liked b { color: var(--text); font-weight: 650; }
	.faces { display: flex; }
	.faces > :global(*) { width: 1.75rem; border-radius: 50%; overflow: hidden; margin-left: -0.45rem; box-shadow: 0 0 0 2px var(--bg, var(--surface)); }
	.faces > :global(*:first-child) { margin-left: 0; }
	.description { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); line-height: 1.6; }
	.chapters { list-style: none; margin: 0; padding: 0; }
	.chapters button, .chapter { display: flex; gap: 0.75rem; width: 100%; min-height: 2.5rem; align-items: center; padding-inline: 0.5rem; margin-inline: -0.5rem; text-align: start; border-radius: 0.5rem; }
	.chapters button span, .chapter span { color: var(--accent); font-variant-numeric: tabular-nums; min-width: 2.6rem; }
	@media (max-width: 720px) {
		.detail { gap: 2rem; padding-top: 1rem; }
		.cover { width: min(16rem, 64vw); }
	}
</style>
