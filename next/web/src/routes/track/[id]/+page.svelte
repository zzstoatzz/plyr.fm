<script lang="ts">
	import { trackArtwork } from '$core/artwork';
	import { player } from '$lib/player.svelte';
	import { artistName } from '$lib/tracks';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const track = $derived(data.track);
	const active = $derived(player.current?.id === track.id);
	let shared = $state(false);

	function play() {
		if (active) player.toggle();
		else player.play(track);
	}
	async function share() {
		try {
			if (navigator.share) await navigator.share({ title: track.metadata.title, url: location.href });
			else { await navigator.clipboard.writeText(location.href); shared = true; }
		} catch {}
	}
</script>

<svelte:head><title>{track.metadata.title} · plyr.fm</title></svelte:head>

<header class="mobile-header"><a href="/" aria-label="plyr.fm home"><span aria-hidden="true">✻</span> plyr.fm</a><a class="icon-button" href="/search" aria-label="Search"><Icon name="search" /></a></header>

<article class="page-content detail">
	<div class="cover"><Artwork src={trackArtwork(track)} size={330} eager /></div>
	<h1>{track.metadata.title}</h1>
	<a class="artist" href={`/u/${track.artist.did}`}>{artistName(track)}</a>
	{#if track.metadata.album}<p class="subtle">{track.metadata.album}</p>{/if}
	<div class="actions">
		<button class="icon-button" type="button" aria-label="Share track" onclick={share}><Icon name="share" /></button>
		<button class="primary-button" type="button" aria-label={active && player.playing ? 'Pause' : 'Play'} onclick={play}><Icon name={active && player.playing ? 'pause' : 'play'} size={27} /></button>
		<button class="icon-button" type="button" aria-label="Add to queue" disabled={player.privateMode} title={player.privateMode ? "play a public track to change queues" : undefined} onclick={() => player.enqueue(track)}><Icon name="queue" /></button>
	</div>
	<p class="subtle">{track.metrics.play_count} {track.metrics.play_count === 1 ? 'listen' : 'listens'}</p>
	{#if shared}<p role="status">link copied</p>{/if}
	{#if active && player.error}<p class="state" role="status">{player.error}</p>{/if}
	{#if track.metadata.description}<p class="description">{track.metadata.description}</p>{/if}
</article>

<style>
	.mobile-header { display: none; }
	@media (max-width: 720px) { .mobile-header { padding: 0.35rem 0.85rem; display: flex; align-items: center; justify-content: space-between; font-weight: 700; border-bottom: 1px solid var(--line); background: var(--surface); } .mobile-header span { color: var(--accent); } }
	.detail { max-width: 49rem; display: grid; justify-items: center; text-align: center; gap: 0.6rem; padding-top: clamp(2rem, 6vw, 3.5rem); }
	.cover { width: min(15rem, 65vw); border-radius: 0.65rem; box-shadow: 0 0.45rem 1.65rem rgb(0 0 0 / 0.18); }
	h1 { font-size: clamp(1.7rem, 5vw, 2.8rem); line-height: 1.15; overflow-wrap: anywhere; margin-top: 0.7rem; }
	.artist { color: var(--muted); }
	.actions { display: flex; align-items: center; justify-content: center; gap: 1.7rem; margin: 0.45rem 0; }
	.actions .primary-button { width: 3.5rem; height: 3.5rem; }
	.description { width: 100%; padding-top: 1.1rem; margin: 1.2rem 0; border-top: 1px solid var(--line); color: var(--muted); white-space: pre-wrap; text-align: start; overflow-wrap: anywhere; }
</style>
