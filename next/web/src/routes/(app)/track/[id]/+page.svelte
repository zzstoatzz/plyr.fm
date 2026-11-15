<script lang="ts">
	import { resolve } from '$app/paths';
	import TrackCollections from '$lib/collections/TrackCollections.svelte';
	import { isPrivateTrack } from '@plyr/next-core/track-access';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { player } from '$lib/player.svelte';
	import { artistName } from '$lib/tracks';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Loading from '$lib/ui/Loading.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const track = $derived(data.track);
	const active = $derived(!player.liveStation && player.current?.id === track.id);
	const canDiscuss = $derived(!isPrivateTrack(track));
	let sharedTrack = $state<string>();
	let comments = $state<HTMLDialogElement>();
	let openedTrack = $state<string>();
	let pendingSeek = $state.raw<{ id: string; seconds: number }>();

	$effect(() => {
		const seek = pendingSeek;
		if (!seek) return;
		if (seek.id !== track.id) pendingSeek = undefined;
		else if (active && player.playing && player.position > 0) {
			pendingSeek = undefined;
			player.seek(seek.seconds);
		}
	});

	function play() {
		pendingSeek = undefined;
		if (active) player.toggle();
		else player.play(track);
	}

	function playFrom(seconds: number) {
		if (active && player.duration) {
			player.seek(seconds);
			if (!player.playing) player.toggle();
		} else {
			pendingSeek = { id: track.id, seconds };
			if (active) player.toggle();
			else player.play(track);
		}
		comments?.close();
	}

	function openComments() {
		openedTrack = track.id;
		comments?.showModal();
	}

	async function share() {
		try {
			if (navigator.share) await navigator.share({ title: track.metadata.title, url: location.href });
			else {
				const id = track.id;
				await navigator.clipboard.writeText(location.href);
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
	<button class="primary-button" type="button" aria-label={active && player.playing ? 'Pause' : 'Play'} onclick={play}><Icon name={active && player.playing ? 'pause' : 'play'} size={25} /></button>
	<button class="icon-button" type="button" aria-label="Add to queue" disabled={player.localMode} title={player.localMode ? "play a public track to change queues" : undefined} onclick={() => player.enqueue(track)}><Icon name="queue" /></button>
{/snippet}

{#key track.id}
	<article class="page-content detail">
		<div class="cover"><Artwork src={trackArtwork(track)} size={392} eager /></div>
		<h1>{track.metadata.title}</h1>
		<a class="artist" href={resolve('/(app)/u/[actor]', { actor: track.artist.did })}>{artistName(track)}</a>
		{#if track.metadata.album}<p class="subtle">{track.metadata.album}</p>{/if}
		{#if track.metadata.tags?.length}
			<nav class="tags" aria-label="Tags">
				{#each track.metadata.tags as tag (tag)}
					<a href={resolve('/') + '?' + new URLSearchParams({ tag })}>{tag}</a>
				{/each}
			</nav>
		{/if}
		{#if canDiscuss}<TrackCollections {track} {transport} />{:else}<div class="actions">{@render transport()}</div>{/if}
		<div class="info">
			<p>{track.metrics.play_count} {track.metrics.play_count === 1 ? 'listen' : 'listens'}</p>
			{#if track.metadata.description}
				<details>
					<summary>details</summary>
					<p class="description">{track.metadata.description}</p>
				</details>
			{/if}
		</div>
		<div class="actions">
			<button class="icon-button" type="button" aria-label="Share track" onclick={share}><Icon name="share" size={20} /></button>
			{#if canDiscuss}<button class="text-button" type="button" aria-haspopup="dialog" onclick={openComments}>comments</button>{/if}
		</div>
		{#if sharedTrack === track.id}<p role="status">link copied</p>{/if}
		{#if active && player.error}<p class="state" role="status">{player.error}</p>{/if}
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
					<component.default {track} {playFrom} />
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
	.artist, .info { color: var(--muted); }
	.artist:hover { text-decoration: underline; }
	.actions, .tags { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0.4rem; }
	.tags { margin: 0.2rem 0 0.65rem; }
	.tags a { display: grid; align-items: center; min-height: 2.75rem; padding-inline: 0.65rem; max-width: 100%; overflow-wrap: anywhere; border-radius: 0.6rem; color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--surface)); font-size: 0.85rem; font-weight: 650; }
	.tags a:hover { text-decoration: underline; }
	.primary-button { width: 3.5rem; height: 3.5rem; }
	.info { font-size: 0.9rem; width: 100%; }
	.info > p, details, summary { display: inline; }
	summary { display: inline-flex; align-items: center; min-height: 2.75rem; padding-inline: 0.5rem; color: var(--accent); cursor: pointer; font-weight: 650; }
	.description { max-width: 40rem; border-top: 1px solid var(--line); margin: 0 auto; padding: 0.85rem 0; white-space: pre-wrap; text-align: start; overflow-wrap: anywhere; }
	.comments-panel { inset: auto 1rem 1rem auto; margin: 0; width: min(27rem, calc(100% - 2rem)); max-height: min(42rem, calc(100dvh - 2rem)); height: fit-content; padding: 1rem; background: var(--surface); border: 1px solid var(--line); border-radius: 0.9rem; color: var(--text); }
	.comments-panel::backdrop { background: rgb(0 0 0 / 0.48); }
	.comments-panel header { display: flex; align-items: center; justify-content: space-between; }
	h2 { font-size: 1.15rem; }
	@media (max-width: 720px) {
		.cover { width: min(22rem, 100%); }
		.comments-panel { inset: auto 0 0; width: 100%; max-width: none; max-height: 80dvh; padding-bottom: max(1rem, env(safe-area-inset-bottom)); border-radius: 0.9rem 0.9rem 0 0; }
	}
</style>
