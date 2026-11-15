<script lang="ts">
	import type { Track } from '@plyr/next-core/api';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { resolve } from '$app/paths';
	import { player } from './player.svelte';
	import { artistName, clock } from './tracks';
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';

	let { track, collection, label, testid }: {
		track: Track; collection?: Track[]; label?: string; testid?: string;
	} = $props();
	const currentTrack = $derived(!player.liveStation && player.current?.id === track.id);
	const playing = $derived(currentTrack && player.playing);
	const title = $derived(track.metadata.title || 'untitled');
	function toggle() {
		if (currentTrack) player.toggle();
		else player.play(track, collection, label);
	}
</script>

<div class="track" data-testid={testid} data-track-id={track.id}>
	<button class="playback" type="button" data-testid="track-play-control" aria-label={`${playing ? 'Pause' : 'Play'} ${title}`} onclick={toggle}>
		<span class="cover">
			<Artwork src={trackArtwork(track)} />
			<span class="play"><Icon name={playing ? 'pause' : 'play'} size={20} /></span>
		</span>
	</button>
	<div class="name">
		<a class="truncate title" href={resolve('/(app)/track/[id]', { id: track.id })}>{title}</a>
		<a class="truncate artist" href={resolve('/(app)/u/[actor]', { actor: track.artist.did })}>{artistName(track)}</a>
		<span class="metrics">{track.metrics.play_count} {track.metrics.play_count === 1 ? 'play' : 'plays'}</span>
	</div>
	<button class="icon-button add" type="button" aria-label={`Add ${title} to queue`} disabled={!player.canEditPublicQueue} title={!player.canEditPublicQueue ? "play a public track to change queues" : undefined} onclick={() => player.enqueue(track)}><Icon name="queue" size={20} /></button>
	<span class="duration">{clock(track.metadata.duration_seconds)}</span>
</div>

<style>
	.track { position: relative; display: grid; grid-template-columns: 3.25rem minmax(0, 1fr) auto 3rem; align-items: center; gap: 0.75rem; min-height: 4.65rem; }
	.playback { display: block; border: 0; border-radius: 0.42rem; padding: 0; background: transparent; }
	.playback::after { content: ''; position: absolute; inset: 0; z-index: 1; }
	.cover { position: relative; display: block; border-radius: inherit; overflow: hidden; }
	.play { position: absolute; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / 0.5); color: white; opacity: 0; }
	.track:hover .play, .playback:focus-visible .play { opacity: 1; }
	.name { display: grid; justify-items: start; min-width: 0; }
	.name a { position: relative; z-index: 2; max-width: 100%; }
	.title { font-weight: 650; }
	.artist, .duration { color: var(--muted); font-size: 0.875rem; }
	.metrics { color: var(--faint); font-size: 0.75rem; }
	.duration { text-align: end; font-variant-numeric: tabular-nums; }
	.add { position: relative; z-index: 2; color: var(--muted); }
	@media (hover: hover) { .track:not(:hover, :focus-within) .add { opacity: 0; } }
	@media (max-width: 520px) { .track { grid-template-columns: 3.25rem minmax(0, 1fr) auto; } .duration { display: none; } }
</style>
