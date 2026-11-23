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
	import WaysIn from '$lib/access/WaysIn.svelte';
	import ReportSheet from '$lib/moderation/ReportSheet.svelte';
	import { auth } from '$lib/auth';
	import { onMount, tick } from 'svelte';
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
	let detailsOpen = $state(false);
	let account = $state.raw(auth.getAuth());
	onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
	const reportable = $derived(!!account.agent && account.did !== track.artist.did);
	let reporting = $state(false);
	let reporter = $state<ReportSheet>();
	let reportButton = $state<HTMLButtonElement>();
	let comments = $state<HTMLDialogElement>();
	let openedTrack = $state<string>();
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
		comments?.close();
	}

	function openComments() {
		openedTrack = track.id;
		comments?.showModal();
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
	<button class="primary-button" type="button" data-play-state={playState} aria-label={pause ? 'Pause' : 'Play'} onclick={play}><Icon name={pause ? 'pause' : 'play'} size={25} /></button>
	{#if offer && (!closedToMe || waysAdmitted)}<a class="buy" href={offer.url} target="_blank" rel="noopener noreferrer" aria-label={`Buy ${track.metadata.title}, ${offerLabel(offer)} (opens in a new tab)`}><Icon name="external" size={16} /> <span>buy · {offerLabel(offer)}</span></a>{/if}
	{#if canDiscuss}<button class="icon-button" type="button" aria-label="Add to queue" disabled={!player.canEditPublicQueue} title={!player.canEditPublicQueue ? "play a public track to change queues" : undefined} onclick={() => player.enqueue(track)}><Icon name="queue" /></button>{/if}
{/snippet}

{#key track.id}
	<article class="page-content detail">
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
		<div class="info">
			<p>{canDiscuss ? `${track.metrics.play_count} ${track.metrics.play_count === 1 ? 'listen' : 'listens'}` : accessLabel(track, authConfig.AUDIO_SPACE_TYPE)}</p>
			{#if track.metadata.description}
				<details bind:open={detailsOpen}>
					<summary aria-label={detailsOpen ? 'Hide details' : 'Show details'} title={detailsOpen ? 'hide details' : 'show details'}><span class="info-mark" aria-hidden="true">i</span></summary>
					{#if chapterList.prose}<p class="description">{chapterList.prose}</p>{/if}
					{#if chapterList.chapters.length}
						<ol class="chapters" aria-label="Tracklist">
							{#each chapterList.chapters as chapter (chapter.start)}
								{@const label = `${clock(chapter.start)} · ${chapter.artist ? chapter.artist + ' — ' : ''}${chapter.title}`}
								<li>
									{#if canDiscuss}<button type="button" class="text-button" onclick={() => playFrom(chapter.start)} disabled={!player.canPlayFrom(track)}>{label}</button>
									{:else}<span>{label}</span>{/if}
								</li>
							{/each}
						</ol>
					{/if}
				</details>
			{/if}
		</div>
		{#if canDiscuss}
			<div class="actions">
				<button class="icon-button" type="button" aria-label="Share track" onclick={() => share()}><Icon name="share" size={20} /></button>
				{#if active && player.position >= 1}<button class="text-button" type="button" onclick={() => share(player.position)}>share at {clock(player.position)}</button>{/if}
				{#if commentsEnabled}<button class="text-button" type="button" aria-haspopup="dialog" onclick={openComments}>comments</button>{/if}
				{#if reportable}<button bind:this={reportButton} class="icon-button" type="button" aria-label="Report this track" aria-haspopup="dialog" onclick={async () => { reporting = true; await tick(); reporter?.show(); }}><Icon name="ph_flag" size={19} /></button>{/if}
			</div>
			{#if reporting}<ReportSheet bind:this={reporter} subject={track.record.uri} name={track.metadata.title} owner={artistName(track)} returnTo={trackHref(track)} onclose={() => { reporting = false; reportButton?.focus(); }} />{/if}
		{:else if ownerActions}
			{@render ownerActions()}
		{/if}
		{#if sharedTrack === track.id}<p role="status">link copied</p>{/if}
		{#if active && player.error}<p class="state" role="status">{player.error}</p>{:else if active && player.preparing}<p class="state" role="status">preparing…</p>{/if}
	</article>

	{#if canDiscuss}
		<dialog class="comments-panel" bind:this={comments} aria-labelledby="track-comments">
			<header>
				<h2 id="track-comments">comments</h2>
				<button class="icon-button" type="button" aria-label="Close comments" onclick={() => comments?.close()}><Icon name="x" size={18} /></button>
			</header>
			{#if openedTrack === track.id}
				{#await import('$lib/catalog/TrackComments.svelte')}
					<Loading label="loading comments" />
				{:then component}
				<component.default {track} playFrom={player.canPlayFrom(track) ? playFrom : undefined} />
				{:catch}
					<p role="alert" class="state">could not open comments.</p>
				{/await}
			{/if}
		</dialog>
	{/if}
{/key}

<style>
	.mobile-header { display: none; }
	@media (max-width: 720px) { .mobile-header { padding: 0.35rem 0.85rem; display: flex; align-items: center; justify-content: space-between; font-weight: 700; border-bottom: 1px solid var(--line); background: var(--surface); } .mobile-header span { color: var(--accent); } }
	.detail { max-width: 50rem; display: grid; justify-items: center; text-align: center; gap: 0.5rem; padding-top: clamp(1rem, 6vw, 3rem); }
	.cover { width: min(24.5rem, 100%); border-radius: 0.65rem; }
	h1 { font-size: clamp(1.65rem, 5vw, 2.7rem); line-height: 1.12; overflow-wrap: anywhere; margin-top: 0.65rem; letter-spacing: -0.04em; }
	.credits { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.35rem; }
	.credits, .info { color: var(--muted); }
	.artist:hover { text-decoration: underline; }
	.actions, .tags { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0.4rem; }
	.tags { margin: 0.2rem 0 0.65rem; }
	.tags a { display: grid; align-items: center; min-height: 2.75rem; padding-inline: 0.65rem; max-width: 100%; overflow-wrap: anywhere; border-radius: 0.6rem; color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--surface)); font-size: var(--t-13-6); font-weight: 650; }
	@media (hover: hover) { .tags a:hover { background: color-mix(in srgb, var(--accent) 20%, var(--surface)); } }
	.primary-button { width: 3.5rem; height: 3.5rem; }
	.buy { display: inline-flex; align-items: center; gap: 0.45rem; height: 2.75rem; padding: 0 1.1rem; border: 1.5px solid var(--accent); border-radius: 999px; color: var(--accent); font-weight: 700; max-width: 100%; }
	.buy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.buy:hover { text-decoration: none; background: color-mix(in srgb, var(--accent) 10%, transparent); }
	.info { font-size: var(--t-14-4); width: 100%; }
	.info > p, details, summary { display: inline; }
	summary { display: inline-flex; align-items: center; justify-content: center; min-width: 2.75rem; min-height: 2.75rem; vertical-align: middle; cursor: pointer; list-style: none; }
	summary::-webkit-details-marker { display: none; }
	.info-mark { display: grid; place-items: center; width: 1.15rem; height: 1.15rem; border: 1px solid var(--faint); border-radius: 50%; color: var(--faint); font-weight: 600; font-size: var(--t-10-5); line-height: 1; }
	summary:hover .info-mark, details[open] .info-mark { color: var(--accent); border-color: var(--accent); }
	summary:focus-visible { outline: none; }
	summary:focus-visible .info-mark { outline: 2px solid var(--accent); outline-offset: 2px; }
	.description { max-width: 40rem; border-top: 1px solid var(--line); margin: 0 auto; padding: 0.85rem 0; white-space: pre-wrap; text-align: start; overflow-wrap: anywhere; }
	.chapters { list-style: none; margin: 0.5rem auto; max-width: 40rem; padding: 0; text-align: start; }
	.comments-panel { inset: auto 1rem 1rem auto; margin: 0; width: min(27rem, calc(100% - 2rem)); max-height: min(42rem, calc(100dvh - 2rem)); height: fit-content; padding: 1rem; background: var(--surface); border: 1px solid var(--line); border-radius: 0.9rem; color: var(--text); }
	.comments-panel::backdrop { background: rgb(0 0 0 / 0.48); }
	.comments-panel header { display: flex; align-items: center; justify-content: space-between; }
	h2 { font-size: var(--t-18-4); }
	@media (max-width: 720px) {
		.cover { width: min(11rem, 52vw); }
		.comments-panel { inset: auto 0 0; width: 100%; max-width: none; max-height: 80dvh; padding-bottom: max(1rem, env(safe-area-inset-bottom)); border-radius: 0.9rem 0.9rem 0 0; }
	}
</style>
