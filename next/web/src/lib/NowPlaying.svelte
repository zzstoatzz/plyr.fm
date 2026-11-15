<script lang="ts">
	import { onMount } from 'svelte';
	import { player } from './player.svelte';
	import { auth } from './auth';
	import { artistName, clock, trackHref } from './tracks';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { parseChapters, currentChapter } from '@plyr/next-core/chapters';
	import { parseSeen, seenKey } from '@plyr/next-core/behaviors/hints';
	import { resolve } from '$app/paths';
	import Artwork from './ui/Artwork.svelte';
	import TrackCollections from './collections/TrackCollections.svelte';
	import Icon from './ui/Icon.svelte';
	import Scrub from './Scrub.svelte';
	import Transport from './Transport.svelte';
	import LiveProgress from './radio/LiveProgress.svelte';
	import { playerSheet } from './player-sheet';
	import type { DockPull } from './dock-pull';

	let { close, pull }: { close?: () => void; pull?: DockPull } = $props();
	let motion: ReturnType<typeof playerSheet>;
	let condensed = $state(false);
	let hintSeen = $state(true);
	const hint = 'now-playing.more-below';
	let hintKey: string | undefined;
	const chapters = $derived(parseChapters(player.current?.metadata.description, player.current?.metadata.duration_seconds ?? undefined));
	const chapter = $derived(currentChapter(chapters.chapters, player.position));
	const playing = $derived(player.liveStation ? player.liveListening : player.playing && !player.outputElsewhere);

	onMount(() => {
		if (!close) return;
		function readHint() {
			const account = auth.getAuth();
			if (!account.ready) return;
			const key = seenKey(account.did ?? null);
			if (key === hintKey) return;
			hintKey = key;
			try { hintSeen = parseSeen(localStorage.getItem(key)).has(hint); }
			catch { hintSeen = true; }
		}
		readHint();
		return auth.subscribe(readHint);
	});

	function dismissHint() {
		hintSeen = true;
		if (!hintKey) return;
		try {
			const seen = parseSeen(localStorage.getItem(hintKey));
			seen.add(hint);
			localStorage.setItem(hintKey, JSON.stringify([...seen]));
		} catch {}
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
			if (!hintSeen && details && details.getBoundingClientRect().top < dialog.getBoundingClientRect().bottom - 24) dismissHint();
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
				<div class="cover" data-testid="now-playing-artwork"><Artwork src={trackArtwork(player.current)} size={460} eager /></div>
			</div>
			<div class="copy">
				<h1 data-testid="now-playing-title">{player.current.metadata.title}</h1>
				<a class="subtle" href={resolve('/(app)/u/[actor]', { actor: player.current.artist.profile.handle || player.current.artist.did })}>{artistName(player.current)}</a>
				{#if player.current.metadata.album}<p class="subtle">{player.current.metadata.album}</p>{/if}
				<div class="position">{#if player.liveStation}<LiveProgress />{:else}<Scrub stacked chapter={chapters.chapters[chapter]?.title} />{/if}</div>
				<div class="commands" class:live={!!player.liveStation}>
					<Transport />
				</div>
				{#if !player.liveStation && !player.privateMode}
					{#key player.current.id}<TrackCollections track={player.current} transport={trackActions} compact />{/key}
				{/if}
				{#if !player.liveStation}
					<label class="volume">
						<Icon name={player.volume ? 'volume' : 'mute'} size={18} />
						<input type="range" aria-label="Volume" min="0" max="1" step="0.01" value={player.volume} oninput={event => player.setVolume(event.currentTarget.valueAsNumber)} />
					</label>
				{/if}
				{#if player.error}<p class="state" role="status">{player.error}</p>{/if}
				{#if player.liveStation}<button class="text-button stop" onclick={() => { player.stopRadio(); close?.(); }}>leave radio</button>{/if}
			</div>
			{#if close && !player.liveStation && !player.privateMode}
				<div class="hint-slot" class:seen={hintSeen} inert={hintSeen}>
					<div class="coachmark" data-testid={hintSeen ? undefined : 'coachmark'}><span>scroll down for the artist and track details</span><button type="button" class="text-button" onclick={dismissHint}>got it</button></div>
				</div>
			{/if}
		</div>
		<div class="details" data-testid="now-playing-details">
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
				<a class="track-link" href={trackHref(player.current)}>about this track <span aria-hidden="true">→</span></a>
			{/if}
			{#if chapters.prose}<p class="description">{chapters.prose}</p>{/if}
			{#if !player.liveStation && chapters.chapters.length}
				<section class="chapters" aria-label="Tracklist">
					<h2>tracklist</h2>
					{#each chapters.chapters as item, index (item.start)}
						<button type="button" class="text-button" aria-current={chapter === index ? 'true' : undefined} onclick={() => player.seek(item.start)}>
							<span>{clock(item.start)}</span>{item.label}
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
	header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; height: 3.5rem; color: var(--muted); font-size: 0.875rem; background: var(--bg); }
	.cover { border-radius: 0.95rem; width: 100%; transform-origin: top left; }
	.copy { padding-top: 1.25rem; }
	h1 { font-size: clamp(1.35rem, 4vw, 2rem); line-height: 1.18; overflow-wrap: anywhere; margin-bottom: 0.35rem; transform-origin: top left; }
	.phone-close { display: none; }
	.desktop-close { display: flex; }
	.condensed { display: grid; grid-template-columns: 2rem minmax(0, 1fr) auto; align-items: center; flex: 1; gap: 0.5rem; min-width: 0; }
	.mini { border-radius: 0.35rem; overflow: hidden; }
	.mini-copy { display: grid; min-width: 0; }
	.mini-copy strong { color: var(--text); }
	.hint-slot, .volume { display: none; }
	.position { margin-top: 1.65rem; }
	.commands, .options { display: flex; justify-content: space-between; gap: 0.4rem; align-items: center; margin-block: 0.85rem; }
	.commands :global(.transport) { width: 100%; justify-content: space-evenly; }
	.commands :global(.toggle) { width: 4.5rem; height: 4.5rem; box-shadow: 0 0.45rem 1.4rem color-mix(in srgb, var(--accent) 24%, transparent); }
	.commands.live { justify-content: center; }
	.stop { display: flex; margin-inline: auto; }
	.options { justify-content: center; }
	.details { padding-block: 0.5rem 1rem; }
	.artist-card { display: grid; grid-template-columns: 3.5rem minmax(0, 1fr) auto; align-items: center; gap: 0.7rem; padding: 0.65rem; border: 1px solid var(--line); border-radius: 0.85rem; background: var(--surface); overflow-wrap: anywhere; }
	.avatar { border-radius: 50%; overflow: hidden; }
	small { display: block; color: var(--muted); }
	.track-link { display: flex; justify-content: space-between; padding-block: 0.65rem; border-bottom: 1px solid var(--line); }
	.description { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); margin-top: 1rem; }
	.chapters { margin-top: 1.25rem; }
	h2 { font-size: 1rem; }
	.chapters button { display: flex; justify-content: start; text-align: start; width: 100%; gap: 0.8rem; }
	.chapters button span, .chapters [aria-current] { color: var(--accent); }
	@media (min-width: 800px) {
		.sheet { max-width: 64rem; padding-inline: 1.75rem; }
		.sheet .hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: clamp(1rem, 4vw, 3rem); align-items: center; }
		.sheet .copy { min-width: 0; padding-top: 0; }
		.sheet .volume { display: flex; gap: 0.5rem; justify-content: center; align-items: center; color: var(--muted); margin-top: 1rem; }
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
		.coachmark { display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; padding-inline: 0.6rem; color: var(--muted); background: var(--surface); border: 1px solid var(--line); border-radius: 0.7rem; font-size: 0.85rem; }
		.coachmark button { flex: none; color: var(--accent); }
		.phone-close { display: flex; }
		.desktop-close { display: none; }
	}
	@media (max-width: 720px) and (max-height: 820px) {
		.sheet h1 { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
	}
</style>
