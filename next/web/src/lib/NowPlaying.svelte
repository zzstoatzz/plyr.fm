<script lang="ts">
	import { player } from './player.svelte';
	import { artistName, clock } from './tracks';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { parseChapters, currentChapter } from '@plyr/next-core/chapters';
	import { resolve } from '$app/paths';
	import Artwork from './ui/Artwork.svelte';
	import TrackCollections from './collections/TrackCollections.svelte';
	import Icon from './ui/Icon.svelte';
	import Scrub from './Scrub.svelte';
	import Transport from './Transport.svelte';
	import LiveProgress from './radio/LiveProgress.svelte';
	import { playerSheet } from './player-sheet';

	let { close }: { close?: () => void } = $props();
	const chapters = $derived(parseChapters(player.current?.metadata.description, player.current?.metadata.duration_seconds ?? undefined));
	const chapter = $derived(currentChapter(chapters.chapters, player.position));

	async function shareTrack() {
		if (!player.current) return;
		const url = new URL(resolve('/(app)/track/[id]', { id: player.current.id }), location.origin).href;
		try {
			if (navigator.share) await navigator.share({ title: player.current.metadata.title, url });
			else await navigator.clipboard.writeText(url);
		} catch {}
	}
</script>

{#snippet trackActions()}
	<button class="icon-button" type="button" aria-label="Share track" onclick={shareTrack}><Icon name="share" /></button>
	<a href={resolve('/(app)/queue')} class="icon-button" aria-label="Open queue" onclick={close}><Icon name="queue" /></a>
{/snippet}

{#if player.current}
	<div class="now" class:sheet={!!close} {@attach node => close && playerSheet(node, close)}>
		<header>
			{#if close}<button class="icon-button" type="button" aria-label="Close" onclick={close}><Icon name="down" /></button>{/if}
			<span>{player.liveStation ? `live · ${player.liveStation.label} radio` : 'now playing'}</span>
			{#if !player.liveStation}<a href="/queue" class="icon-button" aria-label="Queue" onclick={close}><Icon name="queue" /></a>{:else}<span></span>{/if}
		</header>
		<div class="cover" data-testid="now-playing-artwork"><Artwork src={trackArtwork(player.current)} size={460} eager /></div>
		<div class="copy">
			<h1 data-testid="now-playing-title">{player.current.metadata.title}</h1>
			<a class="subtle" href={`/u/${player.current.artist.did}`} onclick={close}>{artistName(player.current)}</a>
			{#if player.current.metadata.album}<p class="subtle">{player.current.metadata.album}</p>{/if}
			<div class="position">{#if player.liveStation}<LiveProgress />{:else}<Scrub stacked />{/if}</div>
			<div class="commands" class:live={!!player.liveStation}>
				<Transport />
			</div>
			{#if !player.liveStation}
				{#if !player.privateMode}
					{#key player.current.id}<TrackCollections track={player.current} transport={trackActions} onNavigate={close} compact />{/key}
				{/if}
				<div class="options">
					<button class="icon-button" type="button" aria-label="Shuffle queue" onclick={() => player.shuffle()}><Icon name="shuffle" size={20} /></button>
					<button class="icon-button" type="button" aria-label={`Repeat ${player.repeat}`} aria-pressed={player.repeat !== 'off'} onclick={() => player.cycleRepeat()}><Icon name="repeat" size={20} /></button>
				</div>
			{/if}
			{#if player.error}<p class="state" role="status">{player.error}</p>{/if}
			{#if player.liveStation}<button class="text-button stop" onclick={() => { player.stopRadio(); close?.(); }}>leave radio</button>{/if}
			{#if player.privateMode}<a class="track-link" href="/private" onclick={close}>private music <span aria-hidden="true">→</span></a>
			{:else if !player.liveStation || player.current.id.startsWith('trk_')}
				{#if !player.liveStation}<a class="artist-card" href={resolve('/(app)/u/[actor]', { actor: player.current.artist.did })} onclick={close}>
					<div class="avatar"><Artwork src={player.current.artist.profile.avatar_url ?? undefined} size={56} /></div>
					<span><strong>{player.current.artist.profile.display_name || artistName(player.current)}</strong><small>@{player.current.artist.profile.handle}</small></span><Icon name="chevron" size={19} />
				</a>{/if}
				<a class="track-link" href={resolve('/(app)/track/[id]', { id: player.current.id })} onclick={close}>about this track <span aria-hidden="true">→</span></a>
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
	<div class="page-content"><h1>now playing</h1><p class="state">play a track to see it here.</p><a href="/">browse tracks</a></div>
{/if}

<style>
	.now { max-width: 33rem; margin: auto; padding: 0 1rem 2rem; background: var(--bg); }
	header { display: flex; align-items: center; justify-content: space-between; height: 3.5rem; color: var(--muted); font-size: 0.875rem; }
	.cover { border-radius: 0.95rem; width: 100%; transform-origin: top left; }
	.copy { padding-top: 1.25rem; }
	h1 { font-size: clamp(1.35rem, 4vw, 2rem); line-height: 1.18; overflow-wrap: anywhere; margin-bottom: 0.35rem; }
	.position { margin-top: 1.65rem; }
	.commands, .options { display: flex; justify-content: space-between; gap: 0.4rem; align-items: center; margin-block: 0.85rem; }
	.commands :global(.transport) { width: 100%; justify-content: space-evenly; }
	.commands :global(.toggle) { width: 4.5rem; height: 4.5rem; box-shadow: 0 0.45rem 1.4rem color-mix(in srgb, var(--accent) 24%, transparent); }
	.commands.live { justify-content: center; }
	.stop { display: flex; margin-inline: auto; }
	.options { justify-content: center; }
	.artist-card { display: grid; grid-template-columns: 3.5rem minmax(0, 1fr) auto; align-items: center; gap: 0.7rem; padding: 0.65rem; border: 1px solid var(--line); border-radius: 0.85rem; background: var(--surface); overflow-wrap: anywhere; }
	.avatar { border-radius: 50%; overflow: hidden; }
	small { display: block; color: var(--muted); }
	.track-link { display: flex; justify-content: space-between; padding-block: 0.65rem; border-bottom: 1px solid var(--line); }
	.description { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); margin-top: 1rem; }
	.chapters { margin-top: 1.25rem; }
	h2 { font-size: 1rem; }
	.chapters button { display: flex; justify-content: start; text-align: start; width: 100%; gap: 0.8rem; }
	.chapters button span, .chapters [aria-current] { color: var(--accent); }
	@media (max-width: 720px) { .sheet { min-height: 100dvh; } }
</style>
