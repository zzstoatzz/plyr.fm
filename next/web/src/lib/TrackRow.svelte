<script lang="ts">
	import type { Track } from '$core/api';
	import { trackArtwork } from '$core/artwork';
	import { player } from './player.svelte';
	import { artistName, clock } from './tracks';
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';

	let { track, collection, label, testid }: {
		track: Track; collection?: Track[]; label?: string; testid?: string;
	} = $props();
	const playing = $derived(player.current?.id === track.id && player.playing);
	const title = $derived(track.metadata.title || 'untitled');
	function toggle() {
		if (player.current?.id === track.id) player.toggle();
		else player.play(track, collection, label);
	}
</script>

<div class="track" data-testid={testid}>
	<button class="cover" type="button" data-testid="track-play-control" aria-label={`${playing ? 'Pause' : 'Play'} ${title}`} onclick={toggle}>
		<Artwork src={trackArtwork(track)} />
		<span class="play"><Icon name={playing ? 'pause' : 'play'} size={20} /></span>
	</button>
	<div class="name">
		<a class="truncate title" href={`/track/${track.id}`}>{title}</a>
		<a class="truncate artist" href={`/u/${track.artist.did}`}>{artistName(track)}</a>
		<span class="metrics">{track.metrics.play_count} {track.metrics.play_count === 1 ? 'play' : 'plays'}</span>
	</div>
	<button class="icon-button add" type="button" aria-label={`Add ${title} to queue`} onclick={() => player.enqueue(track)}><Icon name="queue" size={20} /></button>
	<span class="duration">{clock(track.metadata.duration_seconds)}</span>
</div>

<style>
	.track { display: grid; grid-template-columns: 3.25rem minmax(0, 1fr) auto 3rem; align-items: center; gap: 0.75rem; min-height: 4.65rem; }
	.cover { position: relative; display: block; border: 0; border-radius: 0.42rem; padding: 0; background: var(--raised); overflow: hidden; }
	.play { position: absolute; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / 0.5); color: white; opacity: 0; }
	.cover:hover .play, .cover:focus-visible .play { opacity: 1; }
	.name { display: grid; min-width: 0; }
	.title { font-weight: 650; }
	.artist, .duration { color: var(--muted); font-size: 0.875rem; }
	.metrics { color: var(--faint); font-size: 0.75rem; }
	.duration { text-align: end; font-variant-numeric: tabular-nums; }
	.add { color: var(--muted); }
	@media (hover: hover) { .track:not(:hover, :focus-within) .add { opacity: 0; } }
	@media (max-width: 520px) { .track { grid-template-columns: 3.25rem minmax(0, 1fr) auto; } .duration { display: none; } }
</style>
