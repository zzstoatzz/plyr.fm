<script lang="ts">
	import { isBroadcast } from '@plyr/next-core/radio';
	import { onMount } from 'svelte';
	import { player } from './player.svelte';
	import { api } from './api';
	import { auth } from './auth';
	import { artistName, clock, trackHref } from './tracks';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { parseChapters, currentChapter } from '@plyr/next-core/chapters';
	import { oneTimeHint } from './hints.svelte';
	import Coachmark from './Coachmark.svelte';
	import { resolve } from '$app/paths';
	import Artwork from './ui/Artwork.svelte';
	import TrackCollections from './collections/TrackCollections.svelte';
	import Icon from './ui/Icon.svelte';
	import PlayingWave from './ui/PlayingWave.svelte';
	import Scrub from './Scrub.svelte';
	import Transport from './Transport.svelte';
	import LiveProgress from './radio/LiveProgress.svelte';
	import { playerSheet } from './player-sheet';
	import type { DockPull } from './dock-pull';
	import CommentComposer from './listening/CommentComposer.svelte';
	import CoverComments from './listening/CoverComments.svelte';
	import CommentsView from './listening/CommentsView.svelte';
	import { comments } from './listening/comments';
	import TrackBuy from './selling/TrackBuy.svelte';
	import { compactCount } from './listening/format';

	let { close, pull }: { close?: () => void; pull?: DockPull } = $props();
	let motion: ReturnType<typeof playerSheet>;
	let condensed = $state(false);
	const moreBelow = oneTimeHint('now-playing.more-below');
	const chapters = $derived(parseChapters(player.current?.metadata.description, player.current?.metadata.duration_seconds ?? undefined));
	const chapter = $derived(currentChapter(chapters.chapters, player.position));
	// Lists carry no tags; the track read does.
	let fetchedTags = $state.raw<{ id: string; tags: string[] }>();
	$effect(() => {
		const current = player.current;
		if (!current || current.metadata.tags != null || player.privateMode || player.liveStation) return;
		const { id } = current;
		void api.track(id).then(track => { fetchedTags = { id, tags: track.metadata.tags ?? [] }; }, () => {});
	});
	const tags = $derived(player.current?.metadata.tags ?? (fetchedTags?.id === player.current?.id ? fetchedTags?.tags : undefined) ?? []);
	const playing = $derived(player.liveStation ? player.liveListening : player.playing && !player.outputElsewhere);
	const commentable = $derived(!!player.current && !player.privateMode && !player.liveStation);
	let commentState = $state.raw(comments.snapshot());
	let commentsOpen = $state(false);
	let composerBox = $state<HTMLElement>();
	let account = $state.raw(auth.getAuth());
	onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
	$effect(() => {
		const id = commentable ? player.current?.id : undefined;
		commentsOpen = false;
		if (!id) { commentState = comments.snapshot(); return; }
		const update = () => { commentState = comments.snapshot(id); };
		const stop = comments.subscribe(id, update);
		update();
		if (!comments.hasLoaded(id)) comments.loadComments(id);
		return stop;
	});
	const showComments = $derived(commentable && commentState.enabled);
	function compose() {
		const field = composerBox?.querySelector<HTMLElement>('textarea, a');
		field?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
		field?.focus({ preventScroll: true });
	}

	export function dismiss() {
		if (motion) motion.dismiss();
		else close?.();
	}

	function attachMotion(node: HTMLElement) {
		if (!close) return;
		const controller = playerSheet(node, close, pull);
		motion = controller;
		const dialog = node.closest('dialog');
		const title = node.querySelector('[data-testid="now-playing-title"]');
		const header = node.querySelector('[data-player-header]');
		const details = node.querySelector('[data-testid="now-playing-details"]');
		function scroll() {
			if (!dialog?.open || !title || !header) return;
			condensed = title.getBoundingClientRect().bottom <= header.getBoundingClientRect().bottom;
			if (!moreBelow.seen && details && details.getBoundingClientRect().top < dialog.getBoundingClientRect().bottom - 24) moreBelow.dismiss();
		}
		dialog?.addEventListener('scroll', scroll, { passive: true });
		scroll();
		return () => {
			dialog?.removeEventListener('scroll', scroll);
			controller?.destroy();
			motion = undefined;
		};
	}

	async function shareTrack() {
		if (!player.current) return;
		const url = new URL(trackHref(player.current), location.origin).href;
		try {
			if (navigator.share) await navigator.share({ title: player.current.metadata.title, url });
			else await navigator.clipboard.writeText(url);
		} catch {}
	}
</script>

{#snippet trackActions()}
	<button class="icon-button" type="button" aria-label="Share track" onclick={shareTrack}><Icon name="share" /></button>
	{#if showComments}<button class="icon-button comment-toggle" type="button" data-testid="comments-toggle" aria-pressed={commentsOpen} aria-label={commentsOpen ? 'Show the cover' : `Show comments (${commentState.comments.length})`} onclick={() => { commentsOpen = !commentsOpen; }}><Icon name="chat" />{#if commentState.comments.length}<span>{commentState.comments.length}</span>{/if}</button>{/if}
	<a href={resolve('/(app)/queue')} class="icon-button" aria-label="Open queue"><Icon name="queue" /></a>
{/snippet}

{#if player.current}
	<div class="now" class:sheet={!!close} data-testid="now-playing-dismiss-region" {@attach attachMotion}>
		<header data-player-header data-testid="now-playing-header">
			{#if close}<button class="icon-button dismiss" type="button" aria-label="Close" onclick={dismiss}><span class="phone-close"><Icon name="down" /></span><span class="desktop-close"><Icon name="x" /></span></button>{/if}
			{#if close && condensed}
				<div class="condensed" data-testid="now-playing-condensed">
					<div class="mini"><Artwork src={trackArtwork(player.current)} size={52} /></div>
					<div class="mini-copy"><strong class="truncate">{player.current.metadata.title}</strong><span class="truncate">{artistName(player.current)}</span></div>
					<button type="button" class="icon-button" aria-label={playing ? 'Pause' : player.liveStation ? 'Listen live' : 'Play'} onclick={() => player.toggle()}><Icon name={playing ? 'pause' : 'play'} size={18} /></button>
				</div>
			{:else}<span>{player.liveStation ? `live · ${player.liveStation.label} radio` : 'now playing'}</span>{/if}
			{#if !player.liveStation}<a href={resolve('/(app)/queue')} class="icon-button" aria-label="Queue"><Icon name="queue" /></a>{:else}<span></span>{/if}
		</header>
		<div class="hero" data-testid="now-playing-hero">
			<div class="artwork-frame">
				<div class="cover" data-testid="now-playing-artwork"><Artwork src={trackArtwork(player.current)} size={460} eager />
					{#if showComments && commentsOpen}
						<CommentsView items={commentState.comments} cover={trackArtwork(player.current)} position={player.position} seek={player.canSeek ? seconds => player.seek(seconds) : undefined}
							close={() => { commentsOpen = false; }} compose={{ label: account.commenting ? `say something at ${clock(player.position)}` : `${account.did ? 'reconnect' : 'sign in'} to leave a comment`, run: compose }} />
					{:else if showComments && playing}
						<CoverComments items={commentState.comments} position={player.position} open={() => { commentsOpen = true; }} />
					{/if}
				</div>
			</div>
			<div class="copy">
				<h1 data-testid="now-playing-title">{player.current.metadata.title}</h1>
				{#if isBroadcast(player.current)}<p class="subtle">{artistName(player.current)}</p>
				{:else}<a class="subtle" href={resolve('/(app)/u/[actor]', { actor: player.current.artist.profile.handle || player.current.artist.did })}>{artistName(player.current)}</a>{/if}
				{#if player.current.metadata.album}<p class="subtle">{player.current.metadata.album}</p>{/if}
				{#if !player.privateMode && !player.liveStation}<p class="meta" data-testid="now-playing-meta">{compactCount(player.current.metrics.play_count)} {player.current.metrics.play_count === 1 ? 'play' : 'plays'} · added {new Date(player.current.metadata.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toLowerCase()}</p>{/if}
				<div class="position">{#if player.liveStation}<LiveProgress />{:else}<Scrub stacked chapters={chapters.chapters} {chapter} />{/if}</div>
				<div class="commands" class:live={!!player.liveStation}>
					{#if !player.liveStation}<button class="icon-button flank" type="button" aria-label="Shuffle queue" onclick={() => player.shuffle()}><Icon name="shuffle" size={20} /></button>{/if}
					<Transport />
					{#if !player.liveStation}<button class="icon-button flank" type="button" aria-label={`Repeat ${player.repeat}`} aria-pressed={player.repeat !== 'off'} onclick={() => player.cycleRepeat()}><Icon name="repeat" size={20} /></button>{/if}
				</div>
				<div class="utilities">
				{#if !player.liveStation && !player.privateMode}
					{#key player.current.id}<TrackCollections track={player.current} transport={trackActions} compact />{/key}
				{/if}
				{#if !player.liveStation}
					<label class="volume">
						<Icon name={player.volume ? 'volume' : 'mute'} size={18} />
						<input type="range" aria-label="Volume" min="0" max="1" step="0.01" value={player.volume} style:--fill={`${player.volume * 100}%`} oninput={event => player.setVolume(event.currentTarget.valueAsNumber)} />
					</label>
				{/if}
				</div>
				{#if player.error}<p class="state" role="status">{player.error}</p>{:else if player.preparing}<p class="state" role="status">preparing…</p>{/if}
				{#if player.liveStation}<button class="text-button stop" onclick={() => { player.stopRadio(); close?.(); }}>leave radio</button>{/if}
			</div>
			{#if close && !player.liveStation && !player.privateMode}
				<div class="hint-slot" class:seen={moreBelow.seen} inert={moreBelow.seen}>
					<Coachmark dismiss={moreBelow.dismiss} testid={moreBelow.seen ? undefined : 'coachmark'}>scroll down for the artist and track details</Coachmark>
				</div>
			{/if}
		</div>
		<div class="details" data-testid="now-playing-details">
				{#if !player.liveStation && !player.privateMode}
					{#key player.current.id}<div class="composer" bind:this={composerBox}><CommentComposer track={player.current} compact /></div>{/key}
				{/if}

			{#if !player.privateMode && !player.liveStation}
				<div class="facts" data-testid="now-playing-facts"><div><small>plays</small><strong>{compactCount(player.current.metrics.play_count)}</strong></div><div><small>added</small><strong>{new Date(player.current.metadata.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toLowerCase()}</strong></div><div><small>length</small><strong>{clock(player.current.metadata.duration_seconds ?? 0)}</strong></div></div>
			{/if}
			{#if !player.liveStation}
				<div class="options">
					<button class="icon-button" type="button" aria-label="Shuffle queue" onclick={() => player.shuffle()}><Icon name="shuffle" size={20} /></button>
					<button class="icon-button" type="button" aria-label={`Repeat ${player.repeat}`} aria-pressed={player.repeat !== 'off'} onclick={() => player.cycleRepeat()}><Icon name="repeat" size={20} /></button>
				</div>
			{/if}
			{#if player.privateMode}<a class="track-link" href={trackHref(player.current)}>about this track <span aria-hidden="true">→</span></a>
			{:else if !player.liveStation || player.current.id.startsWith('trk_')}
				{#if !player.liveStation}<a class="artist-card" data-testid="now-playing-artist" href={resolve('/(app)/u/[actor]', { actor: player.current.artist.profile.handle || player.current.artist.did })}>
					<div class="avatar"><Artwork src={player.current.artist.profile.avatar_url ?? undefined} size={56} /></div>
					<span><strong>{player.current.artist.profile.display_name || artistName(player.current)}</strong><small>@{player.current.artist.profile.handle}</small></span><Icon name="chevron" size={19} />
				</a>{/if}
				{#if !player.liveStation}
					{#if tags.length}
						<nav class="tags" aria-label="Tags" data-testid="now-playing-tags">
							{#each tags as tag (tag)}<a href={resolve(`/?${new URLSearchParams({ tag })}`)}>{tag}</a>{/each}
						</nav>
					{/if}
					{#key player.current.id}<TrackBuy track={player.current} />{/key}
				{/if}
			{/if}
			{#if chapters.prose}<p class="description">{chapters.prose}</p>{/if}
			{#if !player.liveStation && chapters.chapters.length}
				<section class="chapters" aria-label="Tracklist">
					<h2>tracklist</h2>
					{#each chapters.chapters as item, index (item.start)}
						<button type="button" class="text-button" aria-current={chapter === index ? 'true' : undefined} onclick={() => player.seek(item.start)}>
							<span>{clock(item.start)}</span>{item.label}
							{#if chapter === index && playing}<PlayingWave />{/if}
						</button>
					{/each}
				</section>
			{/if}
		</div>
	</div>
{:else}
	<div class="page-content"><h1>now playing</h1><p class="state">play a track to see it here.</p><a href={resolve('/(app)')}>browse tracks</a></div>
{/if}

<style>
	.now { max-width: 33rem; margin: auto; padding: 0 1rem 2rem; background: var(--bg); }
	header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; height: 3.5rem; color: var(--muted); font-size: var(--t-14); background: var(--bg); }
	.cover { position: relative; border-radius: 0.95rem; width: 100%; transform-origin: top left; }
	.comment-toggle { display: inline-flex; gap: 0.3rem; width: auto; padding-inline: 0.5rem; font-size: var(--t-13-6); font-variant-numeric: tabular-nums; }
	.comment-toggle[aria-pressed='true'] { color: var(--accent); }
	.copy { padding-top: 1.25rem; }
	h1 { font-size: clamp(1.35rem, 4vw, 2rem); line-height: 1.18; overflow-wrap: anywhere; margin-bottom: 0.35rem; transform-origin: top left; }
	.phone-close { display: none; }
	.desktop-close { display: flex; }
	.condensed { display: grid; grid-template-columns: 2rem minmax(0, 1fr) auto; align-items: center; flex: 1; gap: 0.5rem; min-width: 0; }
	.mini { border-radius: 0.35rem; overflow: hidden; }
	.mini-copy { display: grid; min-width: 0; }
	.mini-copy strong { color: var(--text); }
	.hint-slot, .volume, .meta, .flank { display: none; }
	.meta { color: var(--faint); font-size: var(--t-13-6); margin-top: 0.15rem; font-variant-numeric: tabular-nums; }
	.flank { color: var(--muted); }
	.flank[aria-pressed='true'] { color: var(--accent); }
	.position { position: relative; z-index: 2; margin-top: 1.65rem; }
	.commands, .options { display: flex; justify-content: space-between; gap: 0.4rem; align-items: center; margin-block: 0.85rem; }
	.commands :global(.transport) { width: 100%; justify-content: space-evenly; }
	.commands :global(.toggle) { width: 4.5rem; height: 4.5rem; box-shadow: 0 0.45rem 1.4rem color-mix(in srgb, var(--accent) 24%, transparent); }
	.commands.live { justify-content: center; }
	.stop { display: flex; margin-inline: auto; }
	.options { justify-content: center; }
	.composer { margin-block: 0.75rem; }
	.composer:not(:has(*)) { display: none; }
	.facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.5rem; padding-block: 1rem; border-block: 1px solid var(--line); font-size: var(--t-14); }
	.facts strong { font-weight: 650; }
	.facts small { font-size: var(--t-11-2); color: var(--faint); }
	.details { padding-block: 0.5rem 1rem; }
	.artist-card { display: grid; grid-template-columns: 3.5rem minmax(0, 1fr) auto; align-items: center; gap: 0.7rem; padding: 0.65rem; border: 1px solid var(--line); border-radius: 0.85rem; background: var(--surface); overflow-wrap: anywhere; }
	.avatar { border-radius: 50%; overflow: hidden; }
	small { display: block; color: var(--muted); }
	.track-link { display: flex; justify-content: space-between; padding-block: 0.65rem; border-bottom: 1px solid var(--line); }
	.tags { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-block: 0.85rem 0.5rem; }
	.tags a { display: grid; align-items: center; min-height: 2.75rem; padding-inline: 0.75rem; max-width: 100%; overflow-wrap: anywhere; border-radius: 0.6rem; color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--surface)); font-size: var(--t-13-6); font-weight: 650; }
	.tags a:hover { text-decoration: underline; }
	.description { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); margin-top: 1rem; }
	.chapters { margin-top: 1.25rem; }
	h2 { font-size: var(--t-16); }
	.chapters button { display: flex; justify-content: start; text-align: start; width: 100%; gap: 0.8rem; }
	.chapters button span, .chapters [aria-current] { color: var(--accent); }
	@media (min-width: 800px) {
		.sheet { max-width: 90rem; min-height: 100dvh; padding: 5.625rem 2.5rem 2.5rem; display: grid; grid-template-columns: max(10rem, min(41.25rem, calc(48vw - 3.5rem), calc(100dvh - 9rem))) minmax(0, 27.5rem); column-gap: 3.5rem; justify-content: center; align-content: center; }
		.sheet header { position: fixed; inset: 0 1.25rem auto; height: 3.125rem; }
		.sheet .dismiss { order: 1; }
		.sheet header > a { display: none; }
		.sheet .hero { display: contents; }
		.sheet .artwork-frame { grid-column: 1; grid-row: 1 / 3; align-self: start; }
		.sheet .cover { box-shadow: 0 0.25rem 0.625rem rgb(0 0 0 / 0.12); }
		.sheet .copy { grid-column: 2; min-width: 0; padding-top: 0; align-self: end; }
		.sheet h1 { font-size: 1.5625rem; line-height: 1.2; letter-spacing: -0.4px; font-weight: 800; }
		.sheet .artist-card { display: none; }
		.sheet .commands :global(.transport) { justify-content: center; gap: clamp(0.5rem, 3vw, 2.25rem); }
		.sheet .commands :global(.toggle) { width: 4.5rem; height: 4.5rem; }
		.sheet .details { grid-column: 2; padding-bottom: 0; align-self: start; }
		/* one quiet stack: shuffle/repeat beside the transport, plays + date under the artist, length lives on the scrubber */
		.sheet .meta { display: block; }
		.sheet .flank { display: inline-flex; }
		.sheet .commands :global(.transport) { width: auto; }
		.sheet .commands { justify-content: center; gap: clamp(0.5rem, 2vw, 1.5rem); }
		.sheet .facts, .sheet .options { display: none; }
		.sheet .composer { margin-block: 0.25rem 0.75rem; }
		.sheet .utilities { display: flex; gap: 0.5rem; align-items: center; }
		.utilities :global(.actions) { flex: 1; justify-content: flex-start; }
		.sheet .volume { display: flex; gap: 0.5rem; justify-content: center; align-items: center; color: var(--muted); margin-left: auto; }
		.volume input { width: 8rem; }
	}
	@media (max-width: 720px) {
		.sheet { min-height: 100dvh; }
		.sheet header { touch-action: none; }
		.sheet .hero { height: calc(100dvh - 3.5rem); min-height: min-content; display: grid; grid-template-rows: minmax(64px, 1fr) auto auto; }
		.sheet .artwork-frame { container-type: size; display: grid; place-items: center; }
		.sheet .cover { width: 100cqmin; }
		.sheet .copy { padding-top: 1rem; }
		.sheet .position { margin-top: 1rem; }
		.sheet .commands { margin-block: 0.65rem; }
		.hint-slot { display: grid; min-height: 3.5rem; padding-block: 0.25rem; }
		.hint-slot.seen { visibility: hidden; }
		.phone-close { display: flex; }
		.desktop-close { display: none; }
	}
	@media (max-width: 720px) and (max-height: 820px) {
		.sheet .position { margin-top: 0.5rem; }
		.sheet .commands { margin-block: 0.4rem; }
		.sheet .copy { padding-top: 0.5rem; }
		.sheet h1 { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
	}
</style>
