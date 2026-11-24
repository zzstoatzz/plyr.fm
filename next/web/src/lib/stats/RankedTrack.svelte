<script lang="ts">
	/** A numbered track in a stats list: cover (press to play), title, artist or sound, a bar of its plays against the top one. */
	import type { Track } from '@plyr/next-core/api';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { showsPause, tracksContext } from '@plyr/next-core/play-context';
	import { resolve } from '$app/paths';
	import { player } from '$lib/player.svelte';
	import { contextState, pressContext } from '$lib/play-control.svelte';
	import { artistName, trackHref } from '$lib/tracks';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import PlayingWave from '$lib/ui/PlayingWave.svelte';

	let { track, rank, plays, max, collection, sound, showArtist = true }: {
		track: Track; rank: number; plays: number; max: number; collection: Track[]; sound?: string; showArtist?: boolean;
	} = $props();
	const context = $derived(tracksContext([track]));
	const playing = $derived(showsPause(contextState(context)));
	const title = $derived(track.metadata.title || 'untitled');
</script>

<li class="ranked">
	<span class="rank" aria-hidden="true">{rank}</span>
	<button class="cover" type="button" aria-label={`${playing ? 'Pause' : 'Play'} ${title}`} onclick={() => pressContext(context, () => player.play(track, collection, 'stats'))}>
		<Artwork src={trackArtwork(track)} size={44} />
		<span class="play" class:playing>{#if playing}<PlayingWave />{:else}<Icon name="play" size={18} />{/if}</span>
	</button>
	<div class="name">
		<a class="truncate title" href={trackHref(track)}>{title}</a>
		{#if showArtist}<a class="truncate sub" href={resolve('/(app)/u/[actor]', { actor: track.artist.did })}>{artistName(track)}</a>{/if}
		{#if sound}<span class="truncate sub">{sound}</span>{/if}
		<span class="bar" aria-hidden="true"><i style:width="{max ? (100 * plays) / max : 0}%"></i></span>
	</div>
	<span class="count"><b>{plays.toLocaleString()}</b><small>{plays === 1 ? 'play' : 'plays'}</small></span>
</li>

<style>
	.ranked { display: grid; grid-template-columns: 1.25rem 2.75rem minmax(0, 1fr) auto; align-items: center; gap: 0.75rem; padding-block: 0.45rem; }
	.rank { color: var(--faint); font-size: var(--t-13-6); text-align: right; font-variant-numeric: tabular-nums; }
	.cover { position: relative; display: block; padding: 0; border: 0; border-radius: 0.25rem; overflow: hidden; background: transparent; }
	.play { position: absolute; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / 0.5); color: white; opacity: 0; }
	.play.playing, .cover:hover .play, .cover:focus-visible .play { opacity: 1; }
	.name { display: grid; gap: 0.2rem; min-width: 0; justify-items: start; }
	.title { font-weight: 700; font-size: var(--t-15); max-width: 100%; }
	.sub { color: var(--faint); font-size: var(--t-13-6); max-width: 100%; }
	.bar { justify-self: stretch; height: 4px; background: color-mix(in srgb, var(--text) 8%, transparent); overflow: hidden; }
	.bar i { display: block; height: 100%; background: var(--accent); }
	.count { display: grid; justify-items: end; font-variant-numeric: tabular-nums; }
	.count b { font-size: var(--t-15); }
	.count small { color: var(--faint); font-size: var(--t-12); }
</style>
